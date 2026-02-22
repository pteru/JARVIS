/**
 * minutes-generator.ts
 *
 * Post-meeting structured minutes generator.
 * Called by stop_meeting after the live-notes cycle ends.
 *
 * Generates a formal Google Doc with:
 *   - Executive summary
 *   - Discussion topics with context
 *   - Decisions with rationale
 *   - Action items table (assignee, deadline, status)
 *   - Raw transcript in a collapsed <details> section
 *
 * Written in the same detected_language as the live notes.
 * Uses claude --print via spawnSync (same pattern as live-notes.ts).
 */

import { spawnSync } from 'child_process';
import type { GDocBridge } from './gdoc-bridge.js';
import type { TranscriptLine } from './transcript.js';

// Use a more capable model for post-meeting processing (quality > latency)
const MINUTES_MODEL = 'claude-sonnet-4-6';
// Use a faster model for quick extraction tasks (action items)
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

export interface MinutesResult {
  docId: string;
  url: string;
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  /** Language detected during the meeting. 'auto' means auto-detect from transcript. */
  detected_language: string;
}

export class MinutesGenerator {
  constructor(private readonly gdoc: GDocBridge) {}

  // ---------------------------------------------------------------------------
  // Main generation
  // ---------------------------------------------------------------------------

  /**
   * Generate structured meeting minutes and publish them to a new Google Doc.
   *
   * @param session           Session metadata (title, times, language)
   * @param liveNotesContent  Current content of the live notes doc (with participant edits)
   * @param transcriptLines   Full raw transcript lines
   * @param liveNotesUrl      URL of the live notes doc (for cross-linking)
   * @returns { docId, url } of the generated minutes doc
   */
  async generate(
    session: SessionInfo,
    liveNotesContent: string,
    transcriptLines: TranscriptLine[],
    liveNotesUrl?: string,
  ): Promise<MinutesResult> {
    const rawTranscript = transcriptLines
      .map((l) => `[${l.timestamp}] ${l.speaker}: ${l.text}`)
      .join('\n');

    const wordCount = rawTranscript.split(/\s+/).filter(Boolean).length;

    // Generate the main minutes body via Claude
    const prompt = buildMinutesPrompt(session, liveNotesContent, rawTranscript);
    const minutesBody = this.callClaude(prompt, MINUTES_MODEL);

    if (!minutesBody) {
      throw new Error('[minutes-generator] Claude returned empty output — cannot create minutes.');
    }

    // Assemble full doc content:
    //   1. Optional back-link to live notes (cross-link header)
    //   2. Claude-generated body (executive summary → action items)
    //   3. Raw transcript in a collapsible section
    let fullContent = '';

    if (liveNotesUrl) {
      fullContent += `*[← View live notes](${liveNotesUrl})*\n\n---\n\n`;
    }

    fullContent += minutesBody;
    fullContent += '\n\n' + buildRawTranscriptSection(rawTranscript, wordCount);

    // Create the Google Doc
    const minutesTitle = `Minutes — ${session.title}`;
    const { docId, url } = await this.gdoc.createDoc(minutesTitle, fullContent);

    return { docId, url };
  }

  // ---------------------------------------------------------------------------
  // Action items extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract action items from a minutes document using Claude.
   * Returns a JSON-formatted list of action items.
   *
   * @param minutesContent  Plain text of the minutes doc
   * @returns JSON string with array of action items
   */
  extractActionItems(minutesContent: string): string {
    const prompt = buildActionItemsPrompt(minutesContent);
    return this.callClaude(prompt, EXTRACT_MODEL);
  }

  // ---------------------------------------------------------------------------
  // Private: Claude invocation
  // ---------------------------------------------------------------------------

  /**
   * Calls `claude --print` with the prompt via stdin.
   * Per JARVIS lessons learned: pipe prompt via stdin (not CLI arg) to avoid escaping issues.
   */
  private callClaude(prompt: string, model: string): string {
    const result = spawnSync('claude', ['--print', '--model', model], {
      input: prompt,
      encoding: 'utf-8',
      timeout: 180_000, // 3 minutes for post-meeting processing
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      console.error('[minutes-generator] claude spawn error:', result.error.message);
      return '';
    }
    if (result.status !== 0) {
      console.error(
        '[minutes-generator] claude exited with status',
        result.status,
        result.stderr ?? '',
      );
      return '';
    }

    return (result.stdout ?? '').trim();
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildMinutesPrompt(
  session: SessionInfo,
  liveNotesContent: string,
  rawTranscript: string,
): string {
  const startedAt = new Date(session.startedAt);
  const endedAt = new Date(session.endedAt);
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const durationMin = Math.round(durationMs / 60_000);

  const dateStr = startedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const languageInstruction =
    session.detected_language && session.detected_language !== 'auto'
      ? `Write the minutes in ${session.detected_language}.`
      : 'Write the minutes in the same language as the transcript content.';

  return `You are a professional meeting minutes writer. ${languageInstruction}
Generate formal, structured meeting minutes using the live notes and raw transcript below.

MEETING METADATA:
- Title: ${session.title}
- Date: ${dateStr}
- Duration: ${durationMin} minutes
- Start: ${session.startedAt}
- End: ${session.endedAt}

LIVE NOTES (compiled by AI assistant during the meeting — may include participant corrections):
${liveNotesContent.trim() || '(No live notes available)'}

RAW TRANSCRIPT:
${rawTranscript.trim() || '(No transcript available)'}

Generate meeting minutes in this EXACT markdown format. Do NOT include a Raw Transcript section (it will be added separately as a collapsed section). Return ONLY the markdown, no preamble or explanation:

# Meeting Minutes — ${session.title}

**Date:** ${dateStr}
**Duration:** ${durationMin} minutes
**Attendees:** [list unique speakers found in transcript; if none found, write "Unknown"]

## Executive Summary
[Write one comprehensive paragraph summarizing what the meeting was about, the main outcomes, and the most important decisions or action items.]

## Discussion Topics

### [Topic 1 — infer meaningful topic name from content]
[Summarize the key points discussed, including context and background. Use bullet points for sub-points.]

### [Topic 2 — add more sections as needed]
[Key points, context, any follow-up questions raised.]

## Decisions

[List each formal decision made, with brief rationale. Format each as:
"**Decision:** [what was decided] — **Rationale:** [why this decision was made]"

If no formal decisions were recorded, write exactly: "No formal decisions recorded."]

## Action Items

| # | Action | Assignee | Deadline | Status |
|---|--------|----------|----------|--------|
[One row per action item extracted from the meeting. If no action items, include a single row with "No action items recorded" in the Action column and dashes in the remaining columns.]

## Key Takeaways

[2-5 bullet points capturing the most important insights, outcomes, or next steps from the meeting.]`;
}

function buildActionItemsPrompt(minutesContent: string): string {
  return `Extract all action items from the following meeting minutes document.

Return ONLY a valid JSON array. Each element must be an object with these fields:
- "action": string — the task or action to be done
- "assignee": string — the person responsible (use "Unassigned" if not specified)
- "deadline": string — the deadline (use "Not specified" if not mentioned)
- "status": string — always "Pending" for newly extracted items

If there are no action items, return an empty JSON array: []

MEETING MINUTES:
${minutesContent}

Return ONLY the JSON array, no explanation, no markdown fences:`;
}

function buildRawTranscriptSection(rawTranscript: string, wordCount: number): string {
  return `## Raw Transcript

<details>
<summary>Full transcript (${wordCount} words)</summary>

\`\`\`
${rawTranscript || '(No transcript recorded)'}
\`\`\`

</details>
`;
}
