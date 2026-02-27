# Meeting Assistant — MCP Server + Skills

**Status:** Planned
**Priority:** High
**Estimated complexity:** Very Large

---

## Overview

A real-time meeting assistant that joins or listens to online calls (Google Meet, Microsoft Teams, Zoom, or any app producing audio on the local machine), transcribes speech, generates live summaries, produces structured meeting minutes, and takes proactive actions during and after meetings.

## Architecture

### Audio Source: Hybrid

Two independent audio capture backends, selectable per meeting:

1. **System audio capture (primary)** — Captures audio from PulseAudio/PipeWire monitor source. Works with any application producing audio on the local machine. Best for when the user is physically at the machine attending a call.
2. **Platform API + bot participant (fallback)** — Joins meetings as a bot via platform-specific APIs for remote/scheduled meetings when local audio is unavailable. Each platform requires its own integration module.

```
┌──────────────────────────────────────────────────────────┐
│                    Meeting Assistant                       │
│                                                           │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ System Audio │   │ Meet Bot API │   │ Zoom/Teams   │  │
│  │ (PipeWire)  │   │ (Companion)  │   │ Bot APIs     │  │
│  └──────┬──────┘   └──────┬───────┘   └──────┬───────┘  │
│         └─────────────────┼──────────────────┘           │
│                           ▼                               │
│                   ┌───────────────┐                       │
│                   │ Audio Router  │                       │
│                   └───────┬───────┘                       │
│                           ▼                               │
│                   ┌───────────────┐                       │
│                   │  STT Engine   │ ◄── Configurable      │
│                   │  (abstract)   │     (Whisper/Cloud)   │
│                   └───────┬───────┘                       │
│                           ▼                               │
│                   ┌───────────────┐                       │
│                   │  Transcript   │                       │
│                   │  Accumulator  │                       │
│                   └───────┬───────┘                       │
│                           ▼                               │
│              ┌────────────┼────────────┐                  │
│              ▼            ▼            ▼                   │
│     ┌──────────────┐ ┌────────┐ ┌───────────┐           │
│     │ Real-time    │ │ Post-  │ │ Proactive │           │
│     │ Summary      │ │ Meeting│ │ Actions   │           │
│     │ Stream       │ │ Report │ │ Engine    │           │
│     └──────────────┘ └────────┘ └───────────┘           │
└──────────────────────────────────────────────────────────┘
```

### STT Engine: Configurable

Abstracted behind a common interface (`STTProvider`):

| Provider | Implementation | When to use |
|----------|---------------|-------------|
| **Deepgram Nova-2** (cloud default) | WebSocket streaming API. Speaker diarization, punctuation, ~$0.0043/min. | Low-latency real-time, when internet is available |
| **Google Cloud STT** (cloud alt) | Streaming recognize API. Good diarization for Google Meet. | When already in GCP ecosystem |
| **faster-whisper** (local) | Python process via `faster-whisper` with CTranslate2. Runs on CPU or CUDA. | Offline, privacy-sensitive, or no cloud budget |

Config in `config/meeting-assistant.json`:

```json
{
  "stt": {
    "default_provider": "deepgram",
    "deepgram": {
      "api_key_env": "DEEPGRAM_API_KEY",
      "model": "nova-2",
      "language": "multi",
      "diarize": true
    },
    "whisper": {
      "model_size": "large-v3",
      "device": "auto",
      "compute_type": "float16",
      "language": "auto",
      "vad_filter": true
    }
  },
  "proactive_actions": {
    "mode": "both",
    "realtime_triggers": ["action_item", "decision", "deadline", "assigned_to_user"],
    "post_meeting": true
  }
}
```

### Proactive Actions: Configurable (Real-time + Post-meeting)

**Real-time actions** (during meeting, for high-priority triggers):
- Detect action items assigned to the user → Telegram notification
- Detect decisions or deadlines mentioned → queue for minutes
- Detect references to specific projects/backlogs → link context
- Detect questions directed at user → surface relevant data from workspace

**Post-meeting batch** (after call ends):
- Generate structured meeting minutes (Google Doc)
- Extract all action items → create backlog tasks or Telegram summary
- Generate executive summary (1-paragraph)
- Update relevant project docs if meeting referenced specific workspaces

The `proactive_actions.mode` config controls behavior:
- `"realtime"` — only real-time alerts
- `"post"` — only post-meeting processing
- `"both"` — real-time alerts for triggers + full post-meeting processing

## File Structure

```
mcp-servers/meeting-assistant/
├── package.json
├── src/
│   ├── index.ts                # MCP server entrypoint
│   ├── audio/
│   │   ├── system-capture.ts   # PipeWire/PulseAudio monitor source
│   │   ├── platform-bots/
│   │   │   ├── meet-bot.ts     # Google Meet companion API
│   │   │   ├── zoom-bot.ts     # Zoom Meeting SDK / REST API
│   │   │   └── teams-bot.ts    # Microsoft Teams Graph API bot
│   │   └── audio-router.ts     # Selects and manages audio source
│   ├── stt/
│   │   ├── provider.ts         # STTProvider interface
│   │   ├── deepgram.ts         # Deepgram Nova-2 WebSocket streaming
│   │   ├── google-stt.ts       # Google Cloud Speech-to-Text
│   │   └── whisper-local.ts    # faster-whisper subprocess bridge
│   ├── processing/
│   │   ├── transcript.ts       # Transcript accumulator with speaker labels
│   │   ├── summarizer.ts       # Rolling summary via Claude API
│   │   ├── action-detector.ts  # Real-time action item / decision detection
│   │   └── minutes-generator.ts# Post-meeting structured minutes
│   ├── actions/
│   │   ├── realtime.ts         # Real-time action dispatcher (Telegram, etc.)
│   │   └── post-meeting.ts     # Post-meeting batch processor
│   └── tools/
│       ├── meeting.ts          # MCP tools for meeting lifecycle
│       ├── transcript.ts       # MCP tools for transcript access
│       └── minutes.ts          # MCP tools for minutes/summary
├── python/
│   └── whisper_bridge.py       # Subprocess for local Whisper inference
└── tsconfig.json
```

## MCP Tools

### Meeting Lifecycle

| Tool | Description |
|------|-------------|
| `start_meeting` | Begin capturing audio. Params: `source` (system/meet/zoom/teams), `meeting_url` (optional), `stt_provider` (optional). Returns session ID. |
| `stop_meeting` | Stop capture, trigger post-meeting processing. Returns transcript + summary. |
| `get_meeting_status` | Check if a meeting is active, duration, word count, speakers detected. |
| `list_meetings` | List past meeting sessions with dates, durations, and summaries. |

### Transcript Access

| Tool | Description |
|------|-------------|
| `get_live_transcript` | Get the current rolling transcript (last N minutes or full). |
| `search_transcript` | Search current or past transcripts for keywords/topics. |
| `get_speakers` | List detected speakers with talk-time statistics. |

### Minutes & Actions

| Tool | Description |
|------|-------------|
| `generate_minutes` | Generate structured meeting minutes from a session (current or past). |
| `get_action_items` | Extract action items with assignees and deadlines. |
| `publish_minutes` | Publish minutes to Google Docs (requires google-workspace MCP). |
| `create_tasks_from_meeting` | Create backlog tasks from extracted action items. |

## Skills

### `/meeting` — Meeting assistant control

```yaml
name: meeting
description: Start, stop, or query the meeting assistant
argument-hint: "start|stop|status|minutes [options]"
```

Examples:
- `/meeting start` → starts system audio capture with default STT
- `/meeting start zoom https://zoom.us/j/...` → joins Zoom via bot
- `/meeting stop` → stops capture, generates minutes
- `/meeting minutes` → generates/retrieves minutes for last meeting
- `/meeting status` → shows active meeting info

### `/minutes` — Quick access to meeting minutes

```yaml
name: minutes
description: Generate or retrieve meeting minutes
argument-hint: "[meeting-id|latest]"
```

## Platform Bot Details

### Google Meet
- No official bot API. Two approaches:
  - **Companion mode:** Use Puppeteer/Playwright to join as a participant with a service account, capture audio via virtual audio device.
  - **Google Meet REST API (if available):** Check for enterprise APIs that provide transcripts directly.
- Fallback: System audio capture is the pragmatic default for Meet.

### Zoom
- **Zoom Meeting SDK** allows a bot to join meetings programmatically.
- **Zoom REST API** provides post-meeting transcripts and recordings.
- Real-time: Use Meeting SDK with raw audio callback.
- Post-meeting: Use REST API to fetch cloud recordings/transcripts.

### Microsoft Teams
- **Microsoft Graph API** with application permissions.
- **Communications API** for joining calls as a bot.
- Requires Azure AD app registration with `Calls.JoinGroupCall.All` permission.
- Can receive audio streams via the Communications platform media API.

## Processing Pipeline

### During Meeting (Real-time)

```
Audio chunks (10s segments)
    → STT provider (streaming)
    → Transcript accumulator (append with timestamp + speaker)
    → Every 60s: action-detector scans new text
        → If trigger detected:
            → Telegram notification (via existing push-notifications MCP)
            → Log to meeting session
    → Every 5min: rolling summary update via Claude API
```

### After Meeting (Post-processing)

```
Full transcript
    → Claude API: generate structured minutes
        → Attendees, agenda topics, discussion points
        → Decisions made
        → Action items (assignee, deadline, description)
        → Key takeaways / executive summary
    → Publish to Google Docs (via google-workspace MCP)
    → Create backlog tasks (via backlog-manager MCP)
    → Send Telegram summary (via push-notifications MCP)
    → Archive transcript to reports/meetings/YYYY-MM-DD-<title>.md
```

## Meeting Minutes Format

```markdown
# Meeting Minutes — {title}

**Date:** {date}
**Duration:** {duration}
**Attendees:** {speakers/participants}

## Executive Summary
{1-paragraph summary}

## Discussion Topics
### {Topic 1}
- {key points}

### {Topic 2}
- {key points}

## Decisions
- {decision 1}
- {decision 2}

## Action Items
| # | Action | Assignee | Deadline | Status |
|---|--------|----------|----------|--------|
| 1 | {description} | {person} | {date} | Pending |

## Raw Transcript
<details>
<summary>Full transcript ({word_count} words)</summary>

{timestamped transcript}
</details>
```

## Data Storage

```
data/meetings/
├── sessions.json              # Index of all meeting sessions
└── YYYY-MM-DD/
    ├── {session-id}.transcript.jsonl  # Timestamped transcript lines
    ├── {session-id}.minutes.md        # Generated minutes
    └── {session-id}.meta.json         # Duration, speakers, STT provider, etc.
```

## Dependencies

- `@deepgram/sdk` — Deepgram streaming STT
- `@google-cloud/speech` — Google Cloud STT (optional)
- `@modelcontextprotocol/sdk` — MCP server framework
- `anthropic` — Claude API for summarization and action detection
- System: `pactl` / `pw-record` for PipeWire/PulseAudio capture
- Python: `faster-whisper` (optional, for local STT)

## Integration Points

- **google-workspace MCP** — Publish minutes to Google Docs, action items to Sheets
- **push-notifications MCP** — Real-time Telegram alerts during meetings
- **backlog-manager MCP** — Create tasks from action items
- **report-generator MCP** — Include meeting summaries in daily/weekly reports

## Implementation Phases

1. **Phase 1: System audio + Deepgram + post-meeting minutes** — Core pipeline with system audio capture, Deepgram streaming, and Claude-powered post-meeting minutes generation. Minimum viable assistant.
2. **Phase 2: Real-time action detection** — Add live action-item/decision detection with Telegram notifications during meetings.
3. **Phase 3: Local Whisper backend** — Add faster-whisper subprocess bridge as offline STT alternative.
4. **Phase 4: Platform bots** — Add Zoom Meeting SDK bot, then Teams Graph API bot, then Meet workaround. Each platform is an independent module.
5. **Phase 5: Google Workspace publishing** — Integrate with google-workspace MCP to auto-publish minutes and action items.
