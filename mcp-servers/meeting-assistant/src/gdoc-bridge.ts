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
// Markdown → Google Docs converter
// Ported from mcp-servers/google-workspace/index.js MarkdownToDocsConverter
// Converts markdown to native Docs API batchUpdate requests (headings, bold,
// italic, links, bullets, numbered lists).
// ---------------------------------------------------------------------------

interface InlineRun {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}

interface ParsedLine {
  text: string | null;
  style: string | null;
  isBullet: boolean;
  isNumbered: boolean;
  runs: InlineRun[] | null;
}

class MarkdownToDocsConverter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  convert(markdown: string): any[] {
    if (!markdown) return [];
    const lines = markdown.split('\n');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requests: any[] = [];
    let index = 1; // Docs content starts at index 1

    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed.text === null) continue;

      const insertText = parsed.text + '\n';
      requests.push({
        insertText: { location: { index }, text: insertText },
      });

      if (parsed.style) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: index, endIndex: index + insertText.length },
            paragraphStyle: { namedStyleType: parsed.style },
            fields: 'namedStyleType',
          },
        });
      }

      if (parsed.isBullet || parsed.isNumbered) {
        requests.push({
          createParagraphBullets: {
            range: { startIndex: index, endIndex: index + insertText.length },
            bulletPreset: parsed.isNumbered
              ? 'NUMBERED_DECIMAL_NESTED'
              : 'BULLET_DISC_CIRCLE_SQUARE',
          },
        });
      }

      if (parsed.runs && parsed.runs.length > 0) {
        for (const run of parsed.runs) {
          const startIdx = index + run.start;
          const endIdx = index + run.end;
          if (run.bold) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { bold: true },
                fields: 'bold',
              },
            });
          }
          if (run.italic) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { italic: true },
                fields: 'italic',
              },
            });
          }
          if (run.link) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { link: { url: run.link } },
                fields: 'link',
              },
            });
          }
        }
      }

      index += insertText.length;
    }

    return requests;
  }

  parseLine(line: string): ParsedLine {
    // Horizontal rules — render as empty line
    if (line.match(/^---+\s*$/)) {
      return { text: '', style: 'NORMAL_TEXT', isBullet: false, isNumbered: false, runs: null };
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const { plainText, runs } = this.parseInlineFormatting(headingMatch[2]);
      return { text: plainText, style: `HEADING_${level}`, isBullet: false, isNumbered: false, runs };
    }

    // Checkbox items: - [ ] or - [x]
    const checkboxMatch = line.match(/^[\-\*]\s+\[([xX ])\]\s+(.+)/);
    if (checkboxMatch) {
      const checked = checkboxMatch[1].toLowerCase() === 'x';
      const prefix = checked ? '☑ ' : '☐ ';
      const { plainText, runs } = this.parseInlineFormatting(checkboxMatch[2]);
      return { text: prefix + plainText, style: null, isBullet: true, isNumbered: false, runs };
    }

    // Bullet lists
    const bulletMatch = line.match(/^[\-\*]\s+(.+)/);
    if (bulletMatch) {
      const { plainText, runs } = this.parseInlineFormatting(bulletMatch[1]);
      return { text: plainText, style: null, isBullet: true, isNumbered: false, runs };
    }

    // Numbered lists
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      const { plainText, runs } = this.parseInlineFormatting(numberedMatch[1]);
      return { text: plainText, style: null, isBullet: false, isNumbered: true, runs };
    }

    // Table rows — render as plain text (tables don't map to Docs natively)
    if (line.match(/^\|.*\|$/)) {
      // Skip separator rows like |---|---|
      if (line.match(/^\|[\s\-:]+\|$/)) {
        return { text: null, style: null, isBullet: false, isNumbered: false, runs: null };
      }
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      const { plainText, runs } = this.parseInlineFormatting(cells.join('  |  '));
      return { text: plainText, style: 'NORMAL_TEXT', isBullet: false, isNumbered: false, runs };
    }

    // Empty lines
    if (line.trim() === '') {
      return { text: '', style: 'NORMAL_TEXT', isBullet: false, isNumbered: false, runs: null };
    }

    // Normal paragraph
    const { plainText, runs } = this.parseInlineFormatting(line);
    return { text: plainText, style: 'NORMAL_TEXT', isBullet: false, isNumbered: false, runs };
  }

  parseInlineFormatting(text: string): { plainText: string; runs: InlineRun[] } {
    const runs: InlineRun[] = [];
    let plainText = '';
    let i = 0;

    while (i < text.length) {
      // Links: [text](url)
      const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const start = plainText.length;
        plainText += linkMatch[1];
        runs.push({ start, end: plainText.length, link: linkMatch[2] });
        i += linkMatch[0].length;
        continue;
      }

      // Bold+Italic: ***text***
      const boldItalicMatch = text.slice(i).match(/^(\*{3}|_{3})(.+?)\1/);
      if (boldItalicMatch) {
        const start = plainText.length;
        plainText += boldItalicMatch[2];
        runs.push({ start, end: plainText.length, bold: true, italic: true });
        i += boldItalicMatch[0].length;
        continue;
      }

      // Bold: **text**
      const boldMatch = text.slice(i).match(/^(\*{2}|_{2})(.+?)\1/);
      if (boldMatch) {
        const start = plainText.length;
        plainText += boldMatch[2];
        runs.push({ start, end: plainText.length, bold: true });
        i += boldMatch[0].length;
        continue;
      }

      // Italic: *text*
      const italicMatch = text.slice(i).match(/^(\*|_)(.+?)\1/);
      if (italicMatch) {
        const start = plainText.length;
        plainText += italicMatch[2];
        runs.push({ start, end: plainText.length, italic: true });
        i += italicMatch[0].length;
        continue;
      }

      plainText += text[i];
      i++;
    }

    return { plainText, runs };
  }
}

const mdConverter = new MarkdownToDocsConverter();

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
   * Replaces the entire content of a Google Doc with formatted markdown.
   * Converts markdown to native Google Docs formatting (headings, bold,
   * italic, links, bullets) via the MarkdownToDocsConverter.
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

    // Delete existing body first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteRequests: any[] = [];
    if (endIndex > 2) {
      deleteRequests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: endIndex - 1 },
        },
      });
    }

    if (deleteRequests.length > 0) {
      await withRetry(() =>
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests: deleteRequests },
        }),
      );
    }

    // Convert markdown to Docs API requests and apply formatting
    const formatRequests = mdConverter.convert(content);
    if (formatRequests.length > 0) {
      await withRetry(() =>
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests: formatRequests },
        }),
      );
    }
  }

  /**
   * Appends formatted markdown content to the end of a Google Doc.
   */
  async appendContent(docId: string, content: string): Promise<void> {
    const auth = await this.getAuth();
    const docs = google.docs({ version: 'v1', auth });

    // Get current doc end index
    const currentDoc = await withRetry(() =>
      docs.documents.get({ documentId: docId }),
    );
    const body = currentDoc.data.body;
    const lastElem = body?.content?.[body.content.length - 1];
    const endIndex = lastElem?.endIndex ?? 1;

    // Convert markdown, but we need to offset all indices to the end of the doc
    const baseRequests = mdConverter.convert(content);

    // Shift all indices by (endIndex - 1) since the converter assumes starting at index 1
    const offset = endIndex - 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shiftedRequests = baseRequests.map((req: any) => {
      const shifted = JSON.parse(JSON.stringify(req));
      if (shifted.insertText?.location?.index != null) {
        shifted.insertText.location.index += offset;
      }
      if (shifted.updateParagraphStyle?.range) {
        shifted.updateParagraphStyle.range.startIndex += offset;
        shifted.updateParagraphStyle.range.endIndex += offset;
      }
      if (shifted.createParagraphBullets?.range) {
        shifted.createParagraphBullets.range.startIndex += offset;
        shifted.createParagraphBullets.range.endIndex += offset;
      }
      if (shifted.updateTextStyle?.range) {
        shifted.updateTextStyle.range.startIndex += offset;
        shifted.updateTextStyle.range.endIndex += offset;
      }
      return shifted;
    });

    if (shiftedRequests.length > 0) {
      await withRetry(() =>
        docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests: shiftedRequests },
        }),
      );
    }
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
