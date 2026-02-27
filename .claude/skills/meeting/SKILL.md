---
name: meeting
description: Start, stop, or query the meeting assistant
argument-hint: "start|stop|status|inject|minutes|actions|tasks|list [options]"
---

# Meeting Assistant Skill

Control the real-time meeting assistant via the `meeting-assistant` MCP server.

## Available MCP Tools

### Meeting Lifecycle
- `start_meeting` — Create a Google Doc and begin the live-notes update cycle
- `stop_meeting` — Halt the cycle, generate structured minutes, return both doc URLs
- `get_meeting_status` — Show current session info (duration, line count, doc links)
- `list_meetings` — List past meeting sessions with dates and doc URLs

### Transcript Input
- `inject_transcript` — Append a speaker line to the transcript (Phase 1 input mechanism)

### Minutes & Action Items
- `get_action_items` — Extract action items from the latest minutes doc via Claude
- `create_tasks_from_meeting` — Write action items to a product backlog markdown file

## Argument Parsing

### `start [--manual] [--language <code>] [title]`
Call `start_meeting` with an optional title.
- **Default: `source: "system_audio"`** — activates PipeWire audio capture + Deepgram STT
- Use `--manual` flag to disable audio capture and use inject-only mode
- Use `--language <code>` to set STT language (e.g., `pt-br`, `en`, `es`, `multi`). Defaults to config value (`multi` = auto-detect). Set explicitly for better accuracy in single-language meetings.
- No title → use a timestamped default (e.g. "Meeting 2/22/2026 10:30 AM")
- Returns: `sessionId`, `docId`, `docUrl`, `audioStatus`, confirmation message

### `stop`
Call `stop_meeting`.
- Stops live-notes cycle
- Generates structured minutes in a second Google Doc
- Persists transcript to `data/meetings/YYYY-MM-DD/{sessionId}.transcript.jsonl`
- Adds cross-links between live notes and minutes docs
- Returns: `liveNotesDocUrl`, `minutesDocUrl`, full transcript text

### `inject <speaker>: <text>`  or  `inject <text>`
Call `inject_transcript` with the given speaker and text.
- If no colon separator, use "Speaker" as the default label
- Returns: the appended line + running total line count

### `status`
Call `get_meeting_status`.
- If meeting active: session ID, doc URL, transcript line count, elapsed time, live-notes running
- If no meeting: "No active meeting" + last completed session summary

### `list [N]`
Call `list_meetings` with optional limit.
- Returns the N most recent sessions (default 10), most recent first
- Includes title, date, duration, live notes URL, minutes URL

### `minutes` or `actions`
Call `get_action_items`.
- Extracts action items from the most recently completed meeting's minutes doc
- Returns a JSON array of `{action, assignee, deadline, status}`

### `tasks <workspace> [priority] [complexity]`
Call `create_tasks_from_meeting` after getting action items.
- Writes extracted action items into `backlogs/products/<workspace>.md`
- Default priority: medium, default complexity: medium

## Examples

```
/meeting start
→ Starts a meeting with audio capture (PipeWire + Deepgram STT).
→ Returns the Google Doc URL for live notes + audio status.

/meeting start "Sprint Review Q1 2026"
→ Starts a meeting with audio capture and the given title.

/meeting start --manual
→ Starts a meeting in manual-only mode (no audio capture).
→ Use inject_transcript to add transcript lines manually.

/meeting start --language pt-br "Reuniao de Projeto"
→ Starts with audio capture, PT-BR language for better STT accuracy.

/meeting start --language en --manual
→ Manual mode with English language hint (for future audio toggle).

/meeting inject Pedro: The CI pipeline needs to be fixed by Friday.
→ Appends a transcript line from speaker "Pedro".

/meeting inject Guest: We should also update the staging environment.
→ Appends a line from speaker "Guest".

/meeting status
→ Shows current meeting session info (or last completed session).

/meeting stop
→ Stops the meeting, generates structured minutes in a new Google Doc.
→ Returns both doc URLs and the full transcript.

/meeting list
→ Lists last 10 meetings with titles, dates, and doc links.

/meeting list 5
→ Lists last 5 meetings.

/meeting actions
→ Extracts action items from the last meeting's minutes as JSON.

/meeting tasks strokmatic.visionking
→ After running "actions", writes action items to the VisionKing backlog.

/meeting tasks strokmatic.visionking high complex
→ Writes action items at high priority, complex complexity.
```

## Two-Doc Output from stop_meeting

When `stop_meeting` completes, it creates two Google Docs in the **Meeting Assistant** folder:

1. **Live Notes** (created at `start_meeting`) — continuously updated during the meeting.
   Contains a footer link: *[View structured meeting minutes →](minutesUrl)*

2. **Structured Minutes** (created at `stop_meeting`) — formal post-meeting document.
   Contains a header link: *[← View live notes](liveNotesUrl)*
   Sections: Executive Summary, Discussion Topics, Decisions, Action Items table, Raw Transcript (collapsed).

## Data Persistence

After `stop_meeting`:
- `data/meetings/YYYY-MM-DD/{sessionId}.transcript.jsonl` — full timestamped transcript (one JSON object per line)
- `data/meetings/YYYY-MM-DD/{sessionId}.meta.json` — session metadata (updated with endedAt)
- `data/meetings/sessions.json` — index of all completed sessions

## Backlog Task Format

`create_tasks_from_meeting` appends tasks to the target backlog file in the standard format:
```
- [ ] [complexity] Action description — Assignee: Person, Deadline: YYYY-MM-DD
```

## Notes

- **Default mode is `system_audio`** — PipeWire captures system audio (Google Meet, etc.) + microphone via Deepgram Nova-2 STT.
- Use `--manual` only when audio capture is not needed or not available.
- Audio capture requires PipeWire (`pw-record`) and the `DEEPGRAM_API_KEY` env var (configured in `.claude.json`).
- Diarization is enabled — Deepgram identifies different speakers automatically.
- Language detection is automatic (`language: "multi"`) — supports multilingual meetings (EN/PT-BR).
- If audio pipeline fails to start, the meeting gracefully falls back to manual mode.
- The live-notes engine updates the Google Doc every ~30 seconds when new lines are present.
- Both Google Docs are created in the **Meeting Assistant** folder inside the JARVIS Shared Drive.
- Minutes generation uses `claude-sonnet-4-6` for quality; action item extraction uses `claude-haiku-4-5-20251001` for speed.
- `inject_transcript` still works alongside audio capture — useful for adding context or corrections.
