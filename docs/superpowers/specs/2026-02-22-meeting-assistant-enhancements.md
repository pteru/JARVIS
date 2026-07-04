# Meeting Assistant Enhancements

**Status:** Planned
**Priority:** Medium
**Depends on:** Meeting Assistant v0.3.0 (Done)

---

## Overview

Future improvements to the Meeting Assistant MCP server beyond the core Phases 1-3.

## Enhancement List

### 1. Whisper Local STT
- Implement `src/stt/whisper.ts` using faster-whisper or whisper.cpp
- Add provider factory in `startAudioPipeline()` to select Deepgram vs Whisper from config
- Fully offline capability — no API key needed
- Config already has Whisper stub in `config/meeting-assistant.json`

### 2. Speaker-Name Mapping
- Add `participants` field to `start_meeting` tool (list of expected attendees)
- Map Deepgram's "Speaker 0/1/2" labels to actual names
- Allow mid-meeting reassignment via new `map_speaker` tool
- Store mapping in session metadata

### 3. Session Resumption
- Add `resume_meeting` tool to reconnect to an existing Google Doc and restart audio capture
- Recover from pipeline crashes without losing the transcript already in the doc
- Load transcript from JSONL file on resume

### 4. Batch Audio Import
- Add `transcribe_file` tool accepting WAV/MP3/OGG path
- Use Deepgram batch API (pre-recorded endpoint) instead of streaming
- Generate transcript + minutes from pre-recorded meetings

### 5. Proactive Actions / Webhooks
- Wire the existing `proactive_actions` config section
- Real-time triggers: detect action items, decisions, deadlines in transcript
- Post-meeting hooks: Slack notification, calendar event creation, Jira ticket creation
- Configurable webhook dispatcher

### 6. Meeting Search & Filtering
- Add `search_meetings` tool with date range, keyword, and speaker filters
- Full-text search across persisted JSONL transcripts
- Return matching sessions with relevance snippets

### 7. PDF Export
- After minutes generation, export markdown to PDF via `md-to-pdf`
- Store in `data/meetings/YYYY-MM-DD/{sessionId}-minutes.pdf`
- Add `export_meeting_pdf` tool for on-demand export

### 8. Language Pass-Through
- Pass detected language explicitly to live-notes and minutes Claude prompts
- Ensure consistent output language matches the spoken language

### 9. Interim Transcript Export
- Add `export_transcript` tool that works during active meetings (not just after stop)
- Return current transcript lines as formatted text or JSONL

### 10. Analytics & Insights
- Meeting duration tracking and reporting
- Action item completion tracking across sessions
- Speaker talk-time distribution
- Decision follow-up analysis
