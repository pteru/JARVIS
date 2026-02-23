# Changelog - meeting-assistant

All notable changes to the meeting-assistant workspace.

## 2026-02-23

### Fixed
- Replace blocking `spawnSync` with async `spawn` in live-notes and minutes-generator to prevent Node.js event loop freezing; add concurrency guard and circuit breaker to live-notes update cycle

Format: [Keep a Changelog](https://keepachangelog.com/)
