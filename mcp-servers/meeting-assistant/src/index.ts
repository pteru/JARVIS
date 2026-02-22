#!/usr/bin/env node
/**
 * index.ts — Meeting Assistant MCP Server (Phase 1)
 *
 * Exposes three MCP tools:
 *   - start_meeting     Create a Google Doc and start the live-notes update cycle
 *   - stop_meeting      Halt the update cycle, return full transcript
 *   - inject_transcript Append a timestamped line to the transcript accumulator
 *
 * Phase 1 scope: no audio capture, no STT.  inject_transcript is the only
 * input mechanism.  Language detection is a placeholder stored in session state.
 */

import path from 'path';
import fs from 'fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GDocBridge } from './gdoc-bridge.js';
import { TranscriptAccumulator } from './transcript.js';
import { LiveNotesEngine } from './live-notes.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ?? path.join(process.env.HOME ?? '/root', 'JARVIS');

const CONFIG_PATH = path.join(ORCHESTRATOR_HOME, 'config', 'meeting-assistant.json');
const DATA_DIR = path.join(ORCHESTRATOR_HOME, 'data', 'meetings');

interface MeetingConfig {
  live_notes: {
    update_interval_ms: number;
    model: string;
    google_drive_id: string;
    folder_name: string;
  };
}

async function loadConfig(): Promise<MeetingConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as MeetingConfig;
  } catch {
    // Return sensible defaults if config is missing
    return {
      live_notes: {
        update_interval_ms: 30_000,
        model: 'claude-haiku-4-5-20251001',
        google_drive_id: '0AC4RjZu6DAzcUk9PVA',
        folder_name: 'Meeting Assistant',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface MeetingSession {
  sessionId: string;
  docId: string;
  docUrl: string;
  title: string;
  startedAt: string;
  /** Language detection placeholder — default 'auto'. Future phases populate this. */
  detected_language: string;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

class MeetingAssistantServer {
  private server: Server;
  private gdoc: GDocBridge;
  private transcript: TranscriptAccumulator;
  private liveNotes: LiveNotesEngine;
  private session: MeetingSession | null = null;

  constructor() {
    this.server = new Server(
      { name: 'meeting-assistant', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    this.gdoc = new GDocBridge();
    this.transcript = new TranscriptAccumulator();
    // LiveNotesEngine is configured after loading config in run()
    this.liveNotes = new LiveNotesEngine(this.gdoc, this.transcript);

    this.setupHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      this.liveNotes.stop();
      await this.server.close();
      process.exit(0);
    });
  }

  // ---------------------------------------------------------------------------
  // Helper results
  // ---------------------------------------------------------------------------

  private ok(text: string) {
    return { content: [{ type: 'text' as const, text }] };
  }

  private err(message: string) {
    return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
  }

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  private getToolDefinitions() {
    return [
      {
        name: 'start_meeting',
        description:
          'Create a new Google Doc in the Meeting Assistant folder and begin the live-notes update cycle. ' +
          'Returns the session ID, document ID, and document URL.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Meeting title (used as the Google Doc title). Defaults to a timestamped title.',
            },
          },
          required: [],
        },
      },
      {
        name: 'stop_meeting',
        description:
          'Stop the active meeting: halt the live-notes update cycle and return the full transcript.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'inject_transcript',
        description:
          'Append a timestamped line to the transcript accumulator. ' +
          'This is the primary input mechanism for Phase 1 (no audio capture yet). ' +
          'A meeting must be active (start_meeting called first).',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Spoken text to inject into the transcript.',
            },
            speaker: {
              type: 'string',
              description: 'Speaker label (e.g. "Pedro", "Guest"). Defaults to "Speaker".',
            },
          },
          required: ['text'],
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  private async startMeeting(args: { title?: string }): Promise<ReturnType<typeof this.ok>> {
    if (this.session) {
      return this.err(
        `A meeting is already active (session: ${this.session.sessionId}). ` +
          'Call stop_meeting first.',
      ) as ReturnType<typeof this.ok>;
    }

    const now = new Date();
    const sessionId = `mtg-${now.toISOString().replace(/[:.]/g, '-')}`;
    const title = args.title?.trim() || `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

    let docId: string;
    let docUrl: string;

    try {
      const initialContent = buildInitialDocument(title, now);
      ({ docId, url: docUrl } = await this.gdoc.createDoc(title, initialContent));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.err(`Failed to create Google Doc: ${msg}`) as ReturnType<typeof this.ok>;
    }

    // Set up session state
    this.session = {
      sessionId,
      docId,
      docUrl,
      title,
      startedAt: now.toISOString(),
      detected_language: 'auto', // Phase 1 placeholder
    };

    // Start transcript accumulator for this session
    this.transcript.startSession(sessionId);

    // Persist session metadata for later reference
    await this.persistSessionMeta(this.session).catch((e) =>
      console.error('[meeting] Could not persist session meta:', e),
    );

    // Start the live-notes update cycle
    this.liveNotes.start(docId);

    return this.ok(
      JSON.stringify(
        {
          sessionId,
          docId,
          docUrl,
          title,
          startedAt: now.toISOString(),
          detected_language: 'auto',
          message: 'Meeting started. Use inject_transcript to add transcript lines.',
        },
        null,
        2,
      ),
    );
  }

  private async stopMeeting(): Promise<ReturnType<typeof this.ok>> {
    if (!this.session) {
      return this.err('No active meeting. Call start_meeting first.') as ReturnType<
        typeof this.ok
      >;
    }

    this.liveNotes.stop();

    const fullTranscript = this.transcript.format();
    const session = this.session;
    const endedAt = new Date().toISOString();

    this.session = null;
    this.transcript.endSession();
    this.transcript.clear();

    return this.ok(
      JSON.stringify(
        {
          sessionId: session.sessionId,
          docId: session.docId,
          docUrl: session.docUrl,
          title: session.title,
          startedAt: session.startedAt,
          endedAt,
          transcript: fullTranscript,
          message: 'Meeting stopped. See docUrl for live notes.',
        },
        null,
        2,
      ),
    );
  }

  private injectTranscript(args: { text: string; speaker?: string }): ReturnType<typeof this.ok> {
    if (!this.session) {
      return this.err('No active meeting. Call start_meeting first.') as ReturnType<typeof this.ok>;
    }

    const speaker = args.speaker?.trim() || 'Speaker';
    const line = this.transcript.append(speaker, args.text);

    return this.ok(
      JSON.stringify(
        {
          ok: true,
          line,
          totalLines: this.transcript.getCount(),
        },
        null,
        2,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private async persistSessionMeta(session: MeetingSession): Promise<void> {
    const dir = path.join(DATA_DIR, session.startedAt.slice(0, 10));
    await fs.mkdir(dir, { recursive: true });
    const metaPath = path.join(dir, `${session.sessionId}.meta.json`);
    await fs.writeFile(metaPath, JSON.stringify(session, null, 2), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Handler setup
  // ---------------------------------------------------------------------------

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'start_meeting':
            return await this.startMeeting((args ?? {}) as { title?: string });
          case 'stop_meeting':
            return await this.stopMeeting();
          case 'inject_transcript':
            return this.injectTranscript(
              (args ?? {}) as { text: string; speaker?: string },
            );
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return this.err(msg);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  async run(): Promise<void> {
    const config = await loadConfig();

    // Re-create LiveNotesEngine with config values
    this.liveNotes = new LiveNotesEngine(this.gdoc, this.transcript, {
      updateIntervalMs: config.live_notes.update_interval_ms,
      claudeModel: config.live_notes.model,
    });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Meeting Assistant MCP server running on stdio');
  }
}

// ---------------------------------------------------------------------------
// Initial document template
// ---------------------------------------------------------------------------

function buildInitialDocument(title: string, startedAt: Date): string {
  const dateStr = startedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startedAt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `# ${title}

**Date:** ${dateStr}
**Start time:** ${timeStr}
**Status:** In progress

---

## Summary

*(Will be updated automatically as the meeting progresses)*

## Discussion Points

## Decisions

## Action Items

## Notes
`;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = new MeetingAssistantServer();
server.run().catch(console.error);
