/**
 * transcript.ts
 *
 * Transcript accumulator for the Meeting Assistant.
 * Stores timestamped lines with speaker labels in memory.
 * In Phase 1, lines are injected via the inject_transcript MCP tool.
 * Future phases will feed lines from STT providers.
 */

export interface TranscriptLine {
  timestamp: string; // ISO 8601
  speaker: string;
  text: string;
}

export class TranscriptAccumulator {
  private lines: TranscriptLine[] = [];
  private sessionId: string | null = null;

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  /** Start a new session, clearing any previous transcript. */
  startSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.lines = [];
  }

  /** Clear the active session reference (does not erase transcript lines). */
  endSession(): void {
    this.sessionId = null;
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  /**
   * Append a new line to the transcript.
   * @param speaker  Speaker label (e.g. "Pedro", "Speaker 1")
   * @param text     Spoken text
   * @returns The newly created TranscriptLine
   */
  append(speaker: string, text: string): TranscriptLine {
    const line: TranscriptLine = {
      timestamp: new Date().toISOString(),
      speaker: speaker.trim() || 'Unknown',
      text: text.trim(),
    };
    this.lines.push(line);
    return line;
  }

  /** Return a copy of all lines. */
  getAll(): TranscriptLine[] {
    return [...this.lines];
  }

  /**
   * Return lines starting at the given index (0-based, inclusive).
   * Useful for the live-notes engine to fetch only new lines since the last update.
   */
  getSince(fromIndex: number): TranscriptLine[] {
    return this.lines.slice(fromIndex);
  }

  /** Total number of lines accumulated so far. */
  getCount(): number {
    return this.lines.length;
  }

  /** Current session ID, or null if no session is active. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  /**
   * Format a set of transcript lines (or all lines) as a human-readable string.
   * Format: [ISO timestamp] Speaker: text
   */
  format(lines?: TranscriptLine[]): string {
    const target = lines ?? this.lines;
    return target
      .map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
      .join('\n');
  }

  /** Reset all accumulated lines (e.g. after stop_meeting). */
  clear(): void {
    this.lines = [];
  }
}
