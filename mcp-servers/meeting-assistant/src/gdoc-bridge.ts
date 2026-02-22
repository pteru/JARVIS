/**
 * gdoc-bridge.ts
 *
 * Google Docs bridge for the Meeting Assistant.
 * Uses the same service-account JWT auth pattern as mcp-servers/google-workspace/index.js,
 * impersonating pedro@lumesolutions.com via domain-wide delegation.
 *
 * Creates/reads/updates Google Docs in the 'Meeting Assistant' folder
 * inside the JARVIS Shared Drive (Drive ID: 0AC4RjZu6DAzcUk9PVA).
 */

import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ?? path.join(process.env.HOME ?? '/root', 'JARVIS');

const SERVICE_ACCOUNT_PATH = path.join(
  ORCHESTRATOR_HOME,
  'config',
  'credentials',
  'gcp-service-account.json',
);

const IMPERSONATED_USER = 'pedro@lumesolutions.com';
const JARVIS_DRIVE_ID = '0AC4RjZu6DAzcUk9PVA';
const MEETING_FOLDER_NAME = 'Meeting Assistant';

// ---------------------------------------------------------------------------
// Retry wrapper (mirrors google-workspace/index.js pattern)
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error as { response?: { status?: number }; code?: number };
      const status = err?.response?.status ?? err?.code;
      const isRateLimit = status === 429 || status === 503;
      if (isRateLimit && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
  // TypeScript requires a return here, but the loop always returns or throws
  throw new Error('withRetry: exhausted attempts');
}

// ---------------------------------------------------------------------------
// GDocBridge
// ---------------------------------------------------------------------------

export class GDocBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _auth: any = null;
  private _meetingFolderId: string | null = null;

  /** Returns a cached GoogleAuth client with domain-wide delegation. */
  async getAuth() {
    if (this._auth) return this._auth;

    const keyContent = await fs.readFile(SERVICE_ACCOUNT_PATH, 'utf-8');
    const key = JSON.parse(keyContent) as object;

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
      ],
      clientOptions: {
        subject: IMPERSONATED_USER,
      },
    });

    this._auth = auth;
    return auth;
  }

  /**
   * Returns the ID of the 'Meeting Assistant' folder inside the JARVIS Shared Drive.
   * Creates the folder if it does not yet exist.
   */
  async getMeetingFolderId(): Promise<string> {
    if (this._meetingFolderId) return this._meetingFolderId;

    const auth = await this.getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Search within the Shared Drive for an existing folder
    const res = await withRetry(() =>
      drive.files.list({
        q: `name='${MEETING_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        driveId: JARVIS_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      }),
    );

    if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
      this._meetingFolderId = res.data.files[0].id;
    } else {
      // Create the folder at the root of the Shared Drive
      const createRes = await withRetry(() =>
        drive.files.create({
          requestBody: {
            name: MEETING_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [JARVIS_DRIVE_ID],
          },
          supportsAllDrives: true,
          fields: 'id',
        }),
      );
      if (!createRes.data.id) throw new Error('Failed to create Meeting Assistant folder');
      this._meetingFolderId = createRes.data.id;
    }

    return this._meetingFolderId!;
  }

  /**
   * Creates a new Google Doc in the 'Meeting Assistant' folder.
   * Optionally writes initial plain-text content.
   */
  async createDoc(title: string, content?: string): Promise<{ docId: string; url: string }> {
    const auth = await this.getAuth();
    const docs = google.docs({ version: 'v1', auth });
    const drive = google.drive({ version: 'v3', auth });

    // Create the document (goes to user's My Drive first)
    const createRes = await withRetry(() =>
      docs.documents.create({ requestBody: { title } }),
    );
    const docId = createRes.data.documentId;
    if (!docId) throw new Error('Failed to create Google Doc');

    // Move to the Meeting Assistant folder inside the Shared Drive
    const folderId = await this.getMeetingFolderId();
    const fileRes = await withRetry(() =>
      drive.files.get({
        fileId: docId,
        fields: 'parents',
        supportsAllDrives: true,
      }),
    );
    const previousParents = (fileRes.data.parents ?? []).join(',');
    await withRetry(() =>
      drive.files.update({
        fileId: docId,
        addParents: folderId,
        removeParents: previousParents,
        supportsAllDrives: true,
        fields: 'id, parents',
      }),
    );

    // Write initial content if provided
    if (content) {
      await this.replaceContent(docId, content);
    }

    return {
      docId,
      url: `https://docs.google.com/document/d/${docId}/edit`,
    };
  }

  /**
   * Reads a Google Doc and returns its body as plain text.
   */
  async readDoc(docId: string): Promise<string> {
    const auth = await this.getAuth();
    const docs = google.docs({ version: 'v1', auth });

    const res = await withRetry(() =>
      docs.documents.get({ documentId: docId }),
    );

    return this.docToPlainText(res.data);
  }

  /**
   * Replaces the entire content of a Google Doc with new plain text.
   */
  async replaceContent(docId: string, content: string): Promise<void> {
    const auth = await this.getAuth();
    const docs = google.docs({ version: 'v1', auth });

    // Get current doc to find end index
    const currentDoc = await withRetry(() =>
      docs.documents.get({ documentId: docId }),
    );
    const body = currentDoc.data.body;
    const lastElem = body?.content?.[body.content.length - 1];
    const endIndex = lastElem?.endIndex ?? 1;

    // Build request list: delete existing body, then insert new content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requests: any[] = [];
    if (endIndex > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }
    requests.push({
      insertText: {
        location: { index: 1 },
        text: content,
      },
    });

    await withRetry(() =>
      docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Extracts plain text from a Google Docs API document object. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private docToPlainText(document: any): string {
    if (!document?.body?.content) return '';
    const lines: string[] = [];

    for (const element of document.body.content) {
      if (!element.paragraph) continue;
      let text = '';
      for (const elem of element.paragraph.elements ?? []) {
        if (elem.textRun?.content) {
          // The Docs API appends '\n' after each paragraph element — strip it here
          text += (elem.textRun.content as string).replace(/\n$/, '');
        }
      }
      lines.push(text);
    }

    return lines.join('\n').trim();
  }
}
