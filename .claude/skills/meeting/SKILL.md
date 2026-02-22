---
name: meeting
description: Start, stop, or query the meeting assistant
argument-hint: "start|stop|status|inject [options]"
---

# Meeting Assistant Skill

Control the real-time meeting assistant via the `meeting-assistant` MCP server.

## Available MCP Tools

- `start_meeting` — Create a Google Doc and begin the live-notes update cycle
- `stop_meeting` — Halt the cycle and return the full transcript
- `inject_transcript` — Append a speaker line to the transcript (Phase 1 input mechanism)

## Argument Parsing

### `start [title]`
Call `start_meeting` with an optional title.
- No title → use a timestamped default (e.g. "Meeting 2/22/2026 10:30 AM")
- Returns: `sessionId`, `docId`, `docUrl`, confirmation message

### `stop`
Call `stop_meeting`.
- Returns: full transcript text + link to the Google Doc

### `inject <speaker>: <text>`  or  `inject <text>`
Call `inject_transcript` with the given speaker and text.
- If no colon separator, use "Speaker" as the default label
- Returns: the appended line + running total line count

### `status`
Report current session state from in-process memory:
- If no meeting active: "No active meeting."
- If active: session ID, doc URL, transcript line count, elapsed time

## Examples

```
/meeting start
→ Starts a meeting with a default timestamped title.
→ Returns the Google Doc URL for live notes.

/meeting start "Sprint Review Q1 2026"
→ Starts a meeting with the given title.

/meeting inject Pedro: The CI pipeline needs to be fixed by Friday.
→ Appends a transcript line from speaker "Pedro".

/meeting inject Guest: We should also update the staging environment.
→ Appends a line from speaker "Guest".

/meeting stop
→ Stops the meeting, returns full transcript + doc link.

/meeting status
→ Shows current meeting session info.
```

## Notes

- Phase 1 only: no audio capture or STT. Use `inject` to feed transcript lines manually.
- The live-notes engine updates the Google Doc every ~30 seconds when new lines are present.
- The Google Doc is created in the **Meeting Assistant** folder inside the JARVIS Shared Drive.
- Language detection is a placeholder (`detected_language: "auto"`). Future phases will auto-detect.
