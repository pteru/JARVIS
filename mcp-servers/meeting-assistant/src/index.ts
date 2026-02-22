#!/usr/bin/env node
/**
 * index.ts — Meeting Assistant MCP Server (Phase 3)
 *
 * Phase 1 tools:
 *   - start_meeting     Create a Google Doc and start the live-notes update cycle
 *   - stop_meeting      Halt the update cycle, generate minutes, return both doc URLs
 *   - inject_transcript Append a timestamped line to the transcript accumulator
 *
 * Phase 2 tools:
 *   - get_meeting_status       Current session info (duration, line count, etc.)
 *   - list_meetings            Past sessions from data/meetings/sessions.json
 *   - get_action_items         Extract action items from the latest minutes doc via Claude
 *   - create_tasks_from_meeting Write action items to a product backlog markdown file
 *
 * Phase 3 additions:
 *   - start_meeting now accepts `source: 'system_audio'` for PipeWire/PulseAudio capture
 *   - get_audio_status          Check audio capture pipeline status
 *   - Automatic audio → Deepgram STT → transcript pipeline
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
import { MinutesGenerator } from './minutes-generator.js';
import { SystemAudioCapture } from './audio/system-capture.js';
import { DeepgramSTT } from './stt/deepgram.js';
import { AudioPipeline } from './audio/audio-pipeline.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ?? path.join(process.env.HOME ?? '/root', 'JARVIS');

const CONFIG_PATH = path.join(ORCHESTRATOR_HOME, 'config', 'meeting-assistant.json');
const DATA_DIR = path.join(ORCHESTRATOR_HOME, 'data', 'meetings');
const BACKLOGS_DIR = path.join(ORCHESTRATOR_HOME, 'backlogs', 'products');

interface MeetingConfig {
  live_notes: {
    update_interval_ms: number;
    model: string;
    google_drive_id: string;
    folder_name: string;
  };
  stt?: {
    default_provider: string;
    deepgram: {
      api_key_env: string;
      model: string;
      language: string;
      diarize: boolean;
    };
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
      stt: {
        default_provider: 'deepgram',
        deepgram: {
          api_key_env: 'DEEPGRAM_API_KEY',
          model: 'nova-2',
          language: 'multi',
          diarize: true,
        },
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
  /** Language detected by STT. 'auto' when using manual source. */
  detected_language: string;
  /** Audio source for this session. */
  source: 'manual' | 'system_audio';
}

interface CompletedSession {
  sessionId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  detected_language: string;
  liveNotesDocId: string;
  liveNotesDocUrl: string;
  minutesDocId: string;
  minutesDocUrl: string;
  lineCount: number;
}

interface ActionItem {
  action: string;
  assignee: string;
  deadline: string;
  status: string;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

class MeetingAssistantServer {
  private server: Server;
  private gdoc: GDocBridge;
  private transcript: TranscriptAccumulator;
  private liveNotes: LiveNotesEngine;
  private minutesGenerator: MinutesGenerator;
  private session: MeetingSession | null = null;
  /** Most recently completed session — used by get_action_items without session_id. */
  private lastSession: CompletedSession | null = null;
  /** Audio pipeline — active when source is 'system_audio'. */
  private audioPipeline: AudioPipeline | null = null;
  /** Loaded config — set in run(). */
  private config: MeetingConfig | null = null;

  constructor() {
    this.server = new Server(
      { name: 'meeting-assistant', version: '0.3.0' },
      { capabilities: { tools: {} } },
    );

    this.gdoc = new GDocBridge();
    this.transcript = new TranscriptAccumulator();
    this.liveNotes = new LiveNotesEngine(this.gdoc, this.transcript);
    this.minutesGenerator = new MinutesGenerator(this.gdoc);

    this.setupHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      if (this.audioPipeline?.isRunning()) {
        await this.audioPipeline.stop();
      }
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
      // ---- Phase 1 tools ----
      {
        name: 'start_meeting',
        description:
          'Create a new Google Doc in the Meeting Assistant folder and begin the live-notes update cycle. ' +
          'Optionally start real-time audio capture via PipeWire/PulseAudio + Deepgram STT. ' +
          'Returns the session ID, document ID, and document URL.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Meeting title (used as the Google Doc title). Defaults to a timestamped title.',
            },
            source: {
              type: 'string',
              enum: ['manual', 'system_audio'],
              description:
                'Audio source. "manual" = inject_transcript only (default). ' +
                '"system_audio" = capture system audio via PipeWire/PulseAudio + Deepgram STT.',
            },
          },
          required: [],
        },
      },
      {
        name: 'stop_meeting',
        description:
          'Stop the active meeting: halt the live-notes cycle (and audio pipeline if active), ' +
          'generate structured minutes in a new Google Doc, ' +
          'persist the full transcript to disk, and add cross-links between the two docs. ' +
          'Returns both the live notes URL and the minutes URL.',
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
          'Works both with manual source and alongside system_audio capture. ' +
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
      // ---- Phase 2 tools ----
      {
        name: 'get_meeting_status',
        description:
          'Return the current meeting session status. If a meeting is active, includes session ID, ' +
          'title, elapsed duration, live notes URL, transcript line count, and audio pipeline status. ' +
          'If no meeting is active, reports the last completed session.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'list_meetings',
        description:
          'List past meeting sessions from the sessions index. Returns session metadata including ' +
          'title, date, duration, and doc URLs.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of sessions to return (default: 10, most recent first).',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_action_items',
        description:
          'Extract action items from the minutes document of the most recently completed meeting ' +
          '(or a specific past session). Returns a JSON array of {action, assignee, deadline, status}.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description:
                'Session ID to extract from (e.g. "mtg-2026-02-22T10-00-00-000Z"). ' +
                'If omitted, uses the most recently completed session.',
            },
          },
          required: [],
        },
      },
      {
        name: 'create_tasks_from_meeting',
        description:
          'Write action items extracted from a meeting into a product backlog markdown file. ' +
          'Appends tasks under the specified priority section following the backlog format.',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: {
              type: 'string',
              description:
                'Backlog workspace name (e.g. "strokmatic.visionking"). ' +
                'The file backlogs/products/{workspace}.md must exist.',
            },
            action_items: {
              type: 'array',
              description: 'Action items to add. Each item needs at minimum an "action" field.',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string', description: 'Task description.' },
                  assignee: { type: 'string', description: 'Person responsible.' },
                  deadline: { type: 'string', description: 'Target deadline.' },
                },
                required: ['action'],
              },
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Priority level for all tasks (default: medium).',
            },
            complexity: {
              type: 'string',
              enum: ['simple', 'medium', 'complex'],
              description: 'Complexity tag for all tasks (default: medium).',
            },
          },
          required: ['workspace', 'action_items'],
        },
      },
      // ---- Phase 3 tools ----
      {
        name: 'get_audio_status',
        description:
          'Check the status of the audio capture pipeline. Returns whether audio is being captured, ' +
          'the STT provider, detected language, and audio device info.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // Tool implementations — Phase 1
  // ---------------------------------------------------------------------------

  private async startMeeting(args: { title?: string; source?: string }): Promise<ReturnType<typeof this.ok>> {
    if (this.session) {
      return this.err(
        `A meeting is already active (session: ${this.session.sessionId}). ` +
          'Call stop_meeting first.',
      ) as ReturnType<typeof this.ok>;
    }

    const now = new Date();
    const sessionId = `mtg-${now.toISOString().replace(/[:.]/g, '-')}`;
    const title = args.title?.trim() || `Meeting ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const source = (args.source === 'system_audio' ? 'system_audio' : 'manual') as 'manual' | 'system_audio';

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
      detected_language: 'auto',
      source,
    };

    // Start transcript accumulator for this session
    this.transcript.startSession(sessionId);

    // Persist session metadata for later reference
    await this.persistSessionMeta(this.session).catch((e) =>
      console.error('[meeting] Could not persist session meta:', e),
    );

    // Start the live-notes update cycle
    this.liveNotes.start(docId);

    // Phase 3: Start audio pipeline if source is system_audio
    let audioStatus = 'not started (manual mode)';
    if (source === 'system_audio') {
      try {
        await this.startAudioPipeline();
        audioStatus = 'capturing';
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[meeting] Audio pipeline failed to start: ${msg}`);
        audioStatus = `failed: ${msg}`;
        // Don't fail the meeting — it can still work via inject_transcript
      }
    }

    return this.ok(
      JSON.stringify(
        {
          sessionId,
          docId,
          docUrl,
          title,
          startedAt: now.toISOString(),
          detected_language: 'auto',
          source,
          audioStatus,
          message:
            source === 'system_audio'
              ? 'Meeting started with system audio capture. Transcript is being generated automatically.'
              : 'Meeting started. Use inject_transcript to add transcript lines.',
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

    // 0. Stop the audio pipeline if running (Phase 3)
    if (this.audioPipeline?.isRunning()) {
      // Capture detected language before stopping
      const detectedLang = this.audioPipeline.getDetectedLanguage();
      if (detectedLang && this.session.detected_language === 'auto') {
        this.session.detected_language = detectedLang;
      }
      await this.audioPipeline.stop().catch((e) =>
        console.error('[meeting] Error stopping audio pipeline:', e),
      );
      this.audioPipeline = null;
    }

    // 1. Stop the live-notes update cycle
    this.liveNotes.stop();

    // 2. Capture transcript before clearing state
    const allLines = this.transcript.getAll();
    const fullTranscript = this.transcript.format();
    const session = this.session;
    const endedAt = new Date().toISOString();

    // 3. Clear active session (so re-entry guard works correctly)
    this.session = null;
    this.transcript.endSession();

    // 4. Persist transcript to JSONL
    await this.persistTranscriptJsonl(session, endedAt, allLines).catch((e) =>
      console.error('[meeting] Could not persist transcript JSONL:', e),
    );

    // 5. Read current live notes content (for passing to minutes generator)
    let liveNotesContent = '';
    try {
      liveNotesContent = await this.gdoc.readDoc(session.docId);
    } catch (err) {
      console.error('[meeting] Failed to read live notes doc — minutes will be generated from transcript only:', err);
    }

    // 6. Generate structured minutes (new Google Doc)
    let minutesDocId = '';
    let minutesDocUrl = '';
    try {
      const result = await this.minutesGenerator.generate(
        {
          sessionId: session.sessionId,
          title: session.title,
          startedAt: session.startedAt,
          endedAt,
          detected_language: session.detected_language,
        },
        liveNotesContent,
        allLines,
        session.docUrl, // liveNotesUrl for cross-link header in minutes doc
      );
      minutesDocId = result.docId;
      minutesDocUrl = result.url;
      console.error(`[meeting] Minutes generated: ${minutesDocUrl}`);
    } catch (err) {
      console.error('[meeting] Failed to generate minutes:', err);
    }

    // 7. Add footer cross-link to live notes doc (→ minutes)
    if (minutesDocUrl && liveNotesContent) {
      const updatedLiveNotes =
        liveNotesContent +
        `\n\n---\n\n*[View structured meeting minutes →](${minutesDocUrl})*\n`;
      await this.gdoc.replaceContent(session.docId, updatedLiveNotes).catch((e) =>
        console.error('[meeting] Failed to add minutes cross-link to live notes:', e),
      );
    }

    // 8. Persist completed session to sessions.json index
    const completed: CompletedSession = {
      sessionId: session.sessionId,
      title: session.title,
      startedAt: session.startedAt,
      endedAt,
      detected_language: session.detected_language,
      liveNotesDocId: session.docId,
      liveNotesDocUrl: session.docUrl,
      minutesDocId,
      minutesDocUrl,
      lineCount: allLines.length,
    };
    await this.updateSessionsIndex(completed).catch((e) =>
      console.error('[meeting] Could not update sessions index:', e),
    );

    // 9. Store as last session for get_action_items / status queries
    this.lastSession = completed;

    // 10. Clear transcript lines
    this.transcript.clear();

    return this.ok(
      JSON.stringify(
        {
          sessionId: session.sessionId,
          liveNotesDocId: session.docId,
          liveNotesDocUrl: session.docUrl,
          minutesDocId,
          minutesDocUrl,
          title: session.title,
          startedAt: session.startedAt,
          endedAt,
          lineCount: allLines.length,
          transcript: fullTranscript,
          message:
            minutesDocUrl
              ? `Meeting stopped. Live notes: ${session.docUrl} | Minutes: ${minutesDocUrl}`
              : `Meeting stopped. Live notes: ${session.docUrl} (minutes generation failed — check logs).`,
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
  // Tool implementations — Phase 2
  // ---------------------------------------------------------------------------

  private getMeetingStatus(): ReturnType<typeof this.ok> {
    if (!this.session) {
      return this.ok(
        JSON.stringify(
          {
            active: false,
            message: 'No active meeting.',
            lastSession: this.lastSession
              ? {
                  sessionId: this.lastSession.sessionId,
                  title: this.lastSession.title,
                  endedAt: this.lastSession.endedAt,
                  liveNotesDocUrl: this.lastSession.liveNotesDocUrl,
                  minutesDocUrl: this.lastSession.minutesDocUrl,
                  lineCount: this.lastSession.lineCount,
                }
              : null,
          },
          null,
          2,
        ),
      );
    }

    const startedAt = new Date(this.session.startedAt);
    const now = new Date();
    const durationMs = now.getTime() - startedAt.getTime();
    const durationMinutes = Math.round(durationMs / 60_000);

    // Phase 3: Include audio pipeline status
    const audioPipelineStatus = this.audioPipeline?.isRunning()
      ? {
          capturing: true,
          sttProvider: this.audioPipeline.getProviderName(),
          detectedLanguage: this.audioPipeline.getDetectedLanguage(),
        }
      : { capturing: false };

    return this.ok(
      JSON.stringify(
        {
          active: true,
          sessionId: this.session.sessionId,
          title: this.session.title,
          startedAt: this.session.startedAt,
          durationMinutes,
          source: this.session.source,
          liveNotesDocUrl: this.session.docUrl,
          transcriptLineCount: this.transcript.getCount(),
          liveNotesRunning: this.liveNotes.isRunning(),
          detected_language: this.session.detected_language,
          audioPipeline: audioPipelineStatus,
        },
        null,
        2,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Tool implementations — Phase 3
  // ---------------------------------------------------------------------------

  private getAudioStatus(): ReturnType<typeof this.ok> {
    if (!this.session) {
      return this.ok(
        JSON.stringify(
          {
            active: false,
            message: 'No active meeting.',
          },
          null,
          2,
        ),
      );
    }

    if (!this.audioPipeline) {
      return this.ok(
        JSON.stringify(
          {
            active: true,
            source: this.session.source,
            audioPipeline: {
              running: false,
              message: this.session.source === 'manual'
                ? 'Audio capture not started (manual mode).'
                : 'Audio pipeline not initialized.',
            },
          },
          null,
          2,
        ),
      );
    }

    return this.ok(
      JSON.stringify(
        {
          active: true,
          source: this.session.source,
          audioPipeline: {
            running: this.audioPipeline.isRunning(),
            sttProvider: this.audioPipeline.getProviderName(),
            detectedLanguage: this.audioPipeline.getDetectedLanguage(),
          },
        },
        null,
        2,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Audio pipeline lifecycle (Phase 3)
  // ---------------------------------------------------------------------------

  /**
   * Start the audio capture → STT → transcript pipeline.
   * Uses config from meeting-assistant.json for STT provider settings.
   */
  private async startAudioPipeline(): Promise<void> {
    const sttConfig = this.config?.stt ?? {
      default_provider: 'deepgram',
      deepgram: {
        api_key_env: 'DEEPGRAM_API_KEY',
        model: 'nova-2',
        language: 'multi',
        diarize: true,
      },
    };

    const dgConfig = sttConfig.deepgram;

    const capture = new SystemAudioCapture();
    const stt = new DeepgramSTT();

    this.audioPipeline = new AudioPipeline(
      capture,
      stt,
      this.transcript,
      (lang: string) => {
        if (this.session && this.session.detected_language === 'auto') {
          this.session.detected_language = lang;
          console.error(`[meeting] Language detected by STT: ${lang}`);
        }
      },
    );

    await this.audioPipeline.start(
      { sampleRate: 16000, channels: 1, chunkDurationMs: 100 },
      {
        apiKeyEnv: dgConfig.api_key_env,
        model: dgConfig.model,
        language: dgConfig.language,
        diarize: dgConfig.diarize,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 2 tool implementations (continued)
  // ---------------------------------------------------------------------------

  private async listMeetings(args: { limit?: number }): Promise<ReturnType<typeof this.ok>> {
    const sessionsPath = path.join(DATA_DIR, 'sessions.json');
    try {
      const raw = await fs.readFile(sessionsPath, 'utf-8');
      const data = JSON.parse(raw) as { sessions: CompletedSession[] };
      const limit = args.limit ?? 10;
      // Most recent first
      const recent = [...data.sessions].reverse().slice(0, limit);
      return this.ok(
        JSON.stringify(
          {
            sessions: recent,
            total: data.sessions.length,
            showing: recent.length,
          },
          null,
          2,
        ),
      );
    } catch {
      return this.ok(
        JSON.stringify(
          { sessions: [], total: 0, message: 'No meeting history found.' },
          null,
          2,
        ),
      );
    }
  }

  private async getActionItems(args: { session_id?: string }): Promise<ReturnType<typeof this.ok>> {
    // Resolve which session to use
    let minutesDocId: string;

    if (args.session_id) {
      // Look up session from the index
      const session = await this.findSessionById(args.session_id);
      if (!session) {
        return this.err(`Session not found: ${args.session_id}`) as ReturnType<typeof this.ok>;
      }
      minutesDocId = session.minutesDocId;
    } else if (this.lastSession) {
      minutesDocId = this.lastSession.minutesDocId;
    } else {
      return this.err(
        'No completed session in memory. Provide a session_id or complete a meeting first.',
      ) as ReturnType<typeof this.ok>;
    }

    if (!minutesDocId) {
      return this.err(
        'No minutes document found for this session (minutes generation may have failed).',
      ) as ReturnType<typeof this.ok>;
    }

    // Read the minutes document
    let minutesContent: string;
    try {
      minutesContent = await this.gdoc.readDoc(minutesDocId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.err(`Failed to read minutes document: ${msg}`) as ReturnType<typeof this.ok>;
    }

    // Extract action items via Claude
    const jsonResult = this.minutesGenerator.extractActionItems(minutesContent);
    if (!jsonResult) {
      return this.err('Claude returned empty output when extracting action items.') as ReturnType<
        typeof this.ok
      >;
    }

    // Validate JSON before returning
    try {
      JSON.parse(jsonResult);
    } catch {
      // Return raw output even if not valid JSON — caller can inspect
      return this.ok(jsonResult);
    }

    return this.ok(jsonResult);
  }

  private async createTasksFromMeeting(args: {
    workspace: string;
    action_items: ActionItem[];
    priority?: string;
    complexity?: string;
  }): Promise<ReturnType<typeof this.ok>> {
    const { workspace, action_items } = args;
    const priority = args.priority ?? 'medium';
    const complexity = args.complexity ?? 'medium';

    if (!action_items || action_items.length === 0) {
      return this.err('No action items provided.') as ReturnType<typeof this.ok>;
    }

    const backlogPath = path.join(BACKLOGS_DIR, `${workspace}.md`);

    // Read existing backlog
    let content: string;
    try {
      content = await fs.readFile(backlogPath, 'utf-8');
    } catch {
      return this.err(
        `Backlog file not found: backlogs/products/${workspace}.md. ` +
          'Create the file first or use an existing workspace name.',
      ) as ReturnType<typeof this.ok>;
    }

    // Build task lines following the backlog format:
    // - [ ] [complexity] Task description — Assignee: X, Deadline: Y
    const taskLines = action_items.map((item) => {
      let line = `- [ ] [${complexity}] ${item.action.trim()}`;
      const meta: string[] = [];
      if (item.assignee && item.assignee !== 'Unassigned') {
        meta.push(`Assignee: ${item.assignee}`);
      }
      if (item.deadline && item.deadline !== 'Not specified') {
        meta.push(`Deadline: ${item.deadline}`);
      }
      if (meta.length > 0) {
        line += ` — ${meta.join(', ')}`;
      }
      return line;
    });

    // Find the priority section and insert tasks
    const priorityHeader = `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`;
    const sectionMarker = priorityHeader.replace('## ', '');

    const sections = content.split('\n## ');
    let inserted = false;

    for (let i = 0; i < sections.length; i++) {
      if (sections[i].startsWith(sectionMarker)) {
        const lines = sections[i].split('\n');
        // Insert after the section header line (index 0)
        lines.splice(1, 0, ...taskLines);
        sections[i] = lines.join('\n');
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      // Append a new section at the end
      content = content.trimEnd() + `\n\n${priorityHeader}\n` + taskLines.join('\n') + '\n';
    } else {
      content = sections.join('\n## ');
    }

    await fs.writeFile(backlogPath, content, 'utf-8');

    return this.ok(
      JSON.stringify(
        {
          ok: true,
          workspace,
          tasksAdded: taskLines.length,
          priority,
          complexity,
          tasks: taskLines,
          backlogPath: `backlogs/products/${workspace}.md`,
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

  /**
   * Persist all transcript lines to a JSONL file (one JSON object per line).
   * File: data/meetings/YYYY-MM-DD/{sessionId}.transcript.jsonl
   */
  private async persistTranscriptJsonl(
    session: MeetingSession,
    endedAt: string,
    lines: Array<{ timestamp: string; speaker: string; text: string }>,
  ): Promise<void> {
    const dir = path.join(DATA_DIR, session.startedAt.slice(0, 10));
    await fs.mkdir(dir, { recursive: true });
    const jsonlPath = path.join(dir, `${session.sessionId}.transcript.jsonl`);
    const content = lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length > 0 ? '\n' : '');
    await fs.writeFile(jsonlPath, content, 'utf-8');
    console.error(`[meeting] Transcript persisted: ${jsonlPath} (${lines.length} lines)`);

    // Also update the meta.json with endedAt and line count
    const metaPath = path.join(dir, `${session.sessionId}.meta.json`);
    try {
      const existingMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as Record<string, unknown>;
      existingMeta.endedAt = endedAt;
      existingMeta.lineCount = lines.length;
      await fs.writeFile(metaPath, JSON.stringify(existingMeta, null, 2), 'utf-8');
    } catch {
      // meta.json may not exist yet — create a minimal one
      await fs.writeFile(
        metaPath,
        JSON.stringify({ ...session, endedAt, lineCount: lines.length }, null, 2),
        'utf-8',
      );
    }
  }

  /**
   * Append a completed session to data/meetings/sessions.json.
   * Creates the file if it does not exist.
   */
  private async updateSessionsIndex(completed: CompletedSession): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const sessionsPath = path.join(DATA_DIR, 'sessions.json');

    let existing: CompletedSession[] = [];
    try {
      const raw = await fs.readFile(sessionsPath, 'utf-8');
      existing = (JSON.parse(raw) as { sessions: CompletedSession[] }).sessions;
    } catch {
      // First session — start fresh
    }

    existing.push(completed);
    await fs.writeFile(sessionsPath, JSON.stringify({ sessions: existing }, null, 2), 'utf-8');
  }

  /**
   * Find a session by ID in the sessions.json index.
   */
  private async findSessionById(sessionId: string): Promise<CompletedSession | null> {
    try {
      const sessionsPath = path.join(DATA_DIR, 'sessions.json');
      const raw = await fs.readFile(sessionsPath, 'utf-8');
      const { sessions } = JSON.parse(raw) as { sessions: CompletedSession[] };
      return sessions.find((s) => s.sessionId === sessionId) ?? null;
    } catch {
      return null;
    }
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
            return await this.startMeeting((args ?? {}) as { title?: string; source?: string });
          case 'stop_meeting':
            return await this.stopMeeting();
          case 'inject_transcript':
            return this.injectTranscript(
              (args ?? {}) as { text: string; speaker?: string },
            );
          case 'get_meeting_status':
            return this.getMeetingStatus();
          case 'get_audio_status':
            return this.getAudioStatus();
          case 'list_meetings':
            return await this.listMeetings((args ?? {}) as { limit?: number });
          case 'get_action_items':
            return await this.getActionItems((args ?? {}) as { session_id?: string });
          case 'create_tasks_from_meeting':
            return await this.createTasksFromMeeting(
              (args ?? {}) as {
                workspace: string;
                action_items: ActionItem[];
                priority?: string;
                complexity?: string;
              },
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
    this.config = await loadConfig();

    // Re-create LiveNotesEngine with config values
    this.liveNotes = new LiveNotesEngine(this.gdoc, this.transcript, {
      updateIntervalMs: this.config.live_notes.update_interval_ms,
      claudeModel: this.config.live_notes.model,
    });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Meeting Assistant MCP server running on stdio (Phase 3)');
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
