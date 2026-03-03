# JARVIS Voice Interface — Feature Roadmap

## Vision

A voice-controlled AI orchestration layer. Not just a Q&A assistant — a persistent, session-aware command center that manages concurrent Claude Code workstreams, provides ambient visual feedback, and can be directed entirely by voice.

**Reference UI**: See `interface-example.jpeg` — central energy orb surrounded by glass-panel session cards on a reflective dark surface.

---

## Phase 1 — Polish & UX (Quick Wins)

### 1.1 Orb Visual Adjustments
- [ ] Pull camera back (increase `camera.position.z`) so more of the halo, particle field, and dark background are visible
- [ ] Ensure the bloom glow has room to breathe — currently the orb fills the frame too tightly
- [ ] Make window draggable (fix `-webkit-app-region: drag` — currently set on `body` but may conflict with canvas)
- [ ] Add right-click context menu: resize presets (small/medium/large), always-on-top toggle, quit

### 1.2 Launch Script
- [ ] Single `./jarvis` script that starts both the pipeline and the orb
- [ ] Handle `ELECTRON_RUN_AS_NODE` unset automatically
- [ ] Clean shutdown on Ctrl+C (kill both processes)
- [ ] Optional: `--orb-only` and `--pipeline-only` flags for dev

---

## Phase 2 — Persistent Sessions

### 2.1 Conversational Continuity
**Current**: Each voice query spawns a new `claude --print` process (no memory between calls beyond our local history).
**Target**: Follow-up prompts interact with the same ongoing Claude Code session, enabling multi-turn work.

- [ ] Use `claude --session-id <uuid> --print` to maintain a persistent session
- [ ] Generate a session UUID at pipeline startup, reuse across queries
- [ ] Pass `--resume <session-id>` for subsequent queries within the same session
- [ ] Voice command: "JARVIS, new session" — starts a fresh session UUID
- [ ] Voice command: "JARVIS, clear history" — resets conversation context

### 2.2 Session-Aware Prompting
- [ ] Inject workspace context (CWD, git branch, recent files) into the session
- [ ] Allow the voice session to reference files: "JARVIS, read the main config file"
- [ ] Enable tool use within voice sessions (Bash, Read, Edit) via `--allowedTools`

---

## Phase 3 — Session Dispatcher

### 3.1 Named Sessions
- [ ] Voice-invoked session creation: "JARVIS, start a new session called DieMaster Debug"
- [ ] Each session gets: UUID, human name, creation timestamp, workspace context
- [ ] Sessions stored in `data/voice-sessions/sessions.json`
- [ ] Voice command: "JARVIS, switch to DieMaster Debug"
- [ ] Voice command: "JARVIS, list active sessions"

### 3.2 Session Lifecycle
- [ ] **Active**: Currently receiving voice commands, orb reflects this session's state
- [ ] **Background**: Running a long task (dispatched), no voice interaction needed
- [ ] **Idle**: Paused, context preserved, can be resumed
- [ ] **Complete**: Task finished, results available for review
- [ ] Voice command: "JARVIS, dispatch this to background" — detaches session and returns to orchestrator

### 3.3 Persistent Background Sessions
- [ ] Dispatch a voice request as a long-running Claude Code session (sandbox or worktree)
- [ ] Track progress via dispatch log / task-dispatcher MCP
- [ ] Notify when complete: orb flashes green + "Sir, the DieMaster task has completed"
- [ ] Voice command: "JARVIS, what's the status of DieMaster Debug?"

---

## Phase 4 — Session Dashboard

> **Design reference**: `interface-example.jpeg`
> Central energy orb surrounded by translucent glass-panel session cards arranged in a semi-circle.
> Cards float on a dark reflective surface, giving a holographic HUD feel.

### 4.1 Session Card Design
Each card is a dark translucent glass panel (~280×180px) with rounded corners, containing:

```
┌─────────────────────────────────┐
│ 🎯  SESSION NAME                │  ← Header: bold, caps, with icon
│                                 │
│  TOPIC: Current task summary    │  ← One-liner describing active work
│  ▰▰▰▰▰▰▰▱▱▱  CONTEXT: 72%     │  ← Progress bar, color-coded
│  ● STATUS: ACTIVE               │  ← Green=active, amber=idle, red=error
│                                 │
│  LOG: Last action completed     │  ← 1-2 lines of recent activity
│       Current operation...      │
└─────────────────────────────────┘
```

**Context bar colors**:
- Green (0–60%): healthy, plenty of room
- Amber (61–85%): getting heavy, consider new session
- Red (86–100%): near limit, auto-warn via voice

**Status states**:
- 🟢 ACTIVE — currently receiving commands or running a task
- 🟡 IDLE — paused, context preserved, awaiting resume
- 🔵 BACKGROUND — dispatched long-running task, no interaction needed
- ✅ COMPLETE — task finished, results ready for review
- 🔴 ERROR — session crashed or timed out

### 4.2 Layout & Interaction
- [ ] Cards arranged in a semi-circle around the central orb (perspective 3D)
- [ ] Cards reflect on the surface below (CSS/WebGL reflection)
- [ ] Active session card is larger/brighter, positioned closest to orb
- [ ] Idle/background cards are dimmer, recede further from center
- [ ] Clicking a card switches the voice channel to that session
- [ ] Voice command: "JARVIS, show sessions" — reveals/hides the dashboard
- [ ] Cards animate in/out with glass-slide transitions
- [ ] Responsive: 1–8 cards visible, scroll/rotate for more

### 4.3 Orb-Session Integration
- [ ] Orb particle color subtly tints to match the active session's theme
- [ ] Badge count ring around orb for background sessions with pending results
- [ ] Orb pulses green when a background session completes
- [ ] Session cards glow on their edges when they have unread notifications

### 4.4 Implementation Approach
- [ ] Extend the existing Electron app (single window, Three.js scene)
- [ ] Session cards as HTML overlay panels (CSS Glass Morphism) on top of the Three.js canvas
- [ ] Or: render cards as Three.js plane meshes with canvas textures for full 3D perspective
- [ ] WebSocket protocol extension: `{"sessions": [...]}` broadcast for dashboard state
- [ ] Pipeline broadcasts session list updates whenever state changes

---

## Phase 5 — Orchestrator Session

### 5.1 The Meta-Session
- [ ] Always-active "JARVIS Core" session — the orchestrator's own persistent session
- [ ] Maintains awareness of all other sessions: names, states, recent activity
- [ ] Default session when no specific session is active
- [ ] Voice command: "JARVIS, status report" — summary of all sessions and pending work
- [ ] Voice command: "JARVIS, what did I work on today?" — daily activity digest

### 5.2 Session Routing
- [ ] JARVIS Core decides whether a voice command should go to:
  - The current active session (contextual follow-up)
  - A named session ("in the VisionKing session, run the tests")
  - A new session (novel request with no existing context)
  - The orchestrator itself (meta-commands: status, list, switch)
- [ ] Intent classification via lightweight prompt or keyword matching

---

## Phase 6 — Suggested Features

### 6.1 Ambient Awareness
- [ ] Orb reacts to system events without voice interaction:
  - PR merged → green pulse
  - CI/CD failure → red alert flash
  - VK health warning → amber shimmer
  - Telegram notification → subtle blue ripple
- [ ] Wire existing MCP servers (notifier, vk-health, changelog-reviewer) as event sources
- [ ] Voice: "JARVIS, what was that alert?" — explains the most recent event

### 6.2 Voice-Driven Code Operations
- [ ] "JARVIS, review the latest PR on DieMaster" — triggers pr-review skill
- [ ] "JARVIS, run the E2E tests on SpotFusion" — dispatches test run
- [ ] "JARVIS, deploy VisionKing to staging" — triggers deployment plan
- [ ] "JARVIS, commit and push" — stages, commits, pushes current work
- [ ] Map voice intents to existing skills and MCP tools

### 6.3 Proactive Notifications
- [ ] JARVIS speaks unprompted when something needs attention:
  - "Sir, the VisionKing health check shows disk usage at 92%"
  - "Sir, there are 3 new PRs awaiting review"
  - "The DieMaster background session has completed successfully"
- [ ] Configurable notification priority levels (critical = interrupt, info = queue for next idle)
- [ ] Notification queue: non-urgent items delivered at natural pauses

### 6.4 Multi-Workspace Context Switching
- [ ] Voice command: "JARVIS, I'm working on SpotFusion now"
- [ ] Automatically sets CWD, git context, and relevant backlog for voice sessions
- [ ] Remembers per-workspace preferences and recent history

### 6.5 Voice Macros
- [ ] Define reusable voice commands: "JARVIS, morning routine" →
  1. Generate daily report
  2. Check PR inbox
  3. VK health status
  4. Read top 3 backlog items
- [ ] Stored in `config/voice-macros.json`
- [ ] "JARVIS, define a new macro called deploy check" — voice-defined macros

### 6.6 Conversation Export
- [ ] "JARVIS, save this conversation" — exports voice session to markdown
- [ ] "JARVIS, create a meeting note from this" — formats as action items
- [ ] Integration with meeting-assistant MCP for structured notes

### 6.7 Audio Presence Detection
- [ ] Detect when user is at the desk (ambient noise patterns, keyboard sounds)
- [ ] Orb dims to sleep mode when desk is idle for N minutes
- [ ] Wakes up with subtle animation when presence detected
- [ ] Reduces false wake-word triggers when user is away

### 6.8 Multi-Voice Support
- [ ] Different ElevenLabs voices for different session types
- [ ] JARVIS Core: deep British male (current George voice)
- [ ] Alert notifications: distinct tone/voice for urgency
- [ ] Configurable per-session voice assignment

---

## Architecture Notes

### Session Storage
```
data/voice-sessions/
├── sessions.json          # Index of all sessions
├── <uuid>/
│   ├── meta.json          # Name, state, workspace, timestamps
│   ├── history.jsonl      # Conversation turns
│   └── context.json       # Injected workspace context
```

### Key Technical Decisions
- `claude --print --session-id` for session persistence (no API billing)
- `claude --print` does NOT support incremental token streaming — full response buffered
- WebSocket protocol between pipeline and orb is stable: `{state, amplitude, alert}`
- Electron `ELECTRON_RUN_AS_NODE` must be unset when launching orb from Claude Code
- STT thread-safety: Deepgram callbacks must use `call_soon_threadsafe` for asyncio events
