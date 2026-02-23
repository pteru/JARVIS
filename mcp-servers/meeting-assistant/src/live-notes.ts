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

import { spawn } from 'child_process';
import type { GDocBridge } from './gdoc-bridge.js';
import type { TranscriptAccumulator } from './transcript.js';

const DEFAULT_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CONSECUTIVE_FAILURES = 3;

export interface LiveNotesConfig {
  updateIntervalMs?: number;
  claudeModel?: string;
}

export class LiveNotesEngine {
  private timer: NodeJS.Timeout | null = null;
  private lastProcessedIndex = 0;
  private docId: string | null = null;
  private updating = false;
  private consecutiveFailures = 0;
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
    this.updating = false;
    this.consecutiveFailures = 0;
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
    this.updating = false;
    this.consecutiveFailures = 0;
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

    // Concurrency guard — skip if a previous cycle is still running
    if (this.updating) {
      console.error('[live-notes] Previous cycle still running — skipping.');
      return;
    }

    // Circuit breaker — pause after repeated failures
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `[live-notes] Circuit breaker open (${this.consecutiveFailures} consecutive failures) — skipping cycle.`,
      );
      return;
    }

    const newLines = this.transcript.getSince(this.lastProcessedIndex);
    if (newLines.length === 0) {
      // Nothing new — skip this cycle
      return;
    }

    this.updating = true;
    try {
      const newLineCount = newLines.length;
      this.lastProcessedIndex = this.transcript.getCount();

      let currentContent: string;
      try {
        currentContent = await this.gdoc.readDoc(this.docId);
      } catch (err) {
        console.error('[live-notes] Failed to read doc:', err);
        this.consecutiveFailures++;
        return;
      }

      const newTranscript = this.transcript.format(newLines);

      const prompt = buildPrompt(currentContent, newTranscript);

      const updatedContent = await this.callClaude(prompt);
      if (!updatedContent) {
        console.error('[live-notes] Claude returned empty output — skipping write.');
        this.consecutiveFailures++;
        return;
      }

      try {
        await this.gdoc.replaceContent(this.docId, updatedContent);
        console.error(
          `[live-notes] Notes updated. Processed ${newLineCount} new transcript line(s).`,
        );
        this.consecutiveFailures = 0;
      } catch (err) {
        console.error('[live-notes] Failed to write updated notes to doc:', err);
        this.consecutiveFailures++;
      }
    } finally {
      this.updating = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Claude integration
  // ---------------------------------------------------------------------------

  /**
   * Calls `claude --print` with the given prompt via stdin (async).
   *
   * Per JARVIS lessons learned:
   *  - Pipe prompt via stdin (never pass as CLI argument) to avoid shell escaping issues
   *  - Uses async spawn to avoid blocking the Node.js event loop
   */
  private callClaude(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--print', '--model', this.model], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let collectedBytes = 0;
      let killed = false;

      // Timeout: kill the process after 60s
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, 60_000);

      child.stdout.on('data', (chunk: Buffer) => {
        collectedBytes += chunk.length;
        if (collectedBytes > MAX_BUFFER_BYTES) {
          killed = true;
          child.kill('SIGTERM');
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        console.error('[live-notes] claude spawn error:', err.message);
        resolve('');
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) {
          const reason = collectedBytes > MAX_BUFFER_BYTES ? 'output exceeded 10MB' : 'timeout (60s)';
          console.error(`[live-notes] claude killed: ${reason}`);
          resolve('');
          return;
        }

        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8');
          console.error('[live-notes] claude exited with status', code, stderr);
          resolve('');
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        resolve(stdout.trim());
      });

      // Write prompt to stdin and close
      child.stdin.write(prompt);
      child.stdin.end();
    });
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
