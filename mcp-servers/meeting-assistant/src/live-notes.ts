/**
 * live-notes.ts
 *
 * Live Notes Update Engine for the Meeting Assistant.
 *
 * Every ~30 seconds (configurable):
 *  1. Reads all new transcript lines since the last cycle
 *  2. Reads the current Google Doc content
 *  3. Calls `claude --print` (piped via stdin) to generate updated notes
 *  4. Writes the result back to the Google Doc
 *
 * Audio capture and STT are out of scope for Phase 1 — transcript lines
 * are injected manually via the inject_transcript MCP tool.
 */

import { spawnSync } from 'child_process';
import type { GDocBridge } from './gdoc-bridge.js';
import type { TranscriptAccumulator } from './transcript.js';

const DEFAULT_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export interface LiveNotesConfig {
  updateIntervalMs?: number;
  claudeModel?: string;
}

export class LiveNotesEngine {
  private timer: NodeJS.Timeout | null = null;
  private lastProcessedIndex = 0;
  private docId: string | null = null;
  private readonly intervalMs: number;
  private readonly model: string;

  constructor(
    private readonly gdoc: GDocBridge,
    private readonly transcript: TranscriptAccumulator,
    config: LiveNotesConfig = {},
  ) {
    this.intervalMs = config.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
    this.model = config.claudeModel ?? DEFAULT_CLAUDE_MODEL;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Begin the periodic update cycle for the given document. */
  start(docId: string): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.docId = docId;
    this.lastProcessedIndex = 0;
    this.timer = setInterval(() => {
      this.runUpdateCycle().catch((err) =>
        console.error('[live-notes] Unhandled update error:', err),
      );
    }, this.intervalMs);
    console.error(`[live-notes] Started. Updating every ${this.intervalMs}ms. Doc: ${docId}`);
  }

  /** Stop the periodic update cycle. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.docId = null;
    console.error('[live-notes] Stopped.');
  }

  /** Returns true if the update cycle is currently running. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  // ---------------------------------------------------------------------------
  // Update cycle
  // ---------------------------------------------------------------------------

  /**
   * Single update pass:
   *  - Fetch new transcript lines since last cycle
   *  - Read current doc
   *  - Ask Claude to merge notes
   *  - Write back to doc
   */
  async runUpdateCycle(): Promise<void> {
    if (!this.docId) return;

    const newLines = this.transcript.getSince(this.lastProcessedIndex);
    if (newLines.length === 0) {
      // Nothing new — skip this cycle
      return;
    }

    const newLineCount = newLines.length;
    this.lastProcessedIndex = this.transcript.getCount();

    let currentContent: string;
    try {
      currentContent = await this.gdoc.readDoc(this.docId);
    } catch (err) {
      console.error('[live-notes] Failed to read doc:', err);
      return;
    }

    const newTranscript = this.transcript.format(newLines);

    const prompt = buildPrompt(currentContent, newTranscript);

    const updatedContent = this.callClaude(prompt);
    if (!updatedContent) {
      console.error('[live-notes] Claude returned empty output — skipping write.');
      return;
    }

    try {
      await this.gdoc.replaceContent(this.docId, updatedContent);
      console.error(
        `[live-notes] Notes updated. Processed ${newLineCount} new transcript line(s).`,
      );
    } catch (err) {
      console.error('[live-notes] Failed to write updated notes to doc:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Claude integration
  // ---------------------------------------------------------------------------

  /**
   * Calls `claude --print` with the given prompt via stdin.
   *
   * Per JARVIS lessons learned:
   *  - Pipe prompt via stdin (never pass as CLI argument) to avoid shell escaping issues
   *  - claude --print inside loops consumes stdin; using spawnSync with `input` avoids this
   */
  private callClaude(prompt: string): string {
    const result = spawnSync('claude', ['--print', '--model', this.model], {
      input: prompt,
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      console.error('[live-notes] claude spawn error:', result.error.message);
      return '';
    }
    if (result.status !== 0) {
      console.error(
        '[live-notes] claude exited with status',
        result.status,
        result.stderr ?? '',
      );
      return '';
    }

    return (result.stdout ?? '').trim();
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(currentNotes: string, newTranscript: string): string {
  const hasNotes = currentNotes.trim().length > 0;

  if (!hasNotes) {
    return `You are a meeting assistant. The following is a transcript excerpt from an ongoing meeting. Create structured meeting notes in markdown format based on this transcript.

TRANSCRIPT:
${newTranscript}

Return ONLY the meeting notes in markdown, no preamble. Use sections: Summary, Discussion Points, Decisions, Action Items.`;
  }

  return `You are a meeting assistant. Update the following meeting notes by integrating new transcript lines. Preserve all existing content and structure.

CURRENT NOTES:
${currentNotes}

NEW TRANSCRIPT LINES:
${newTranscript}

Return ONLY the complete updated meeting notes in markdown format, no preamble or explanation.`;
}
