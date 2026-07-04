# Multi-User Network Interface for Claude Code / JARVIS

## Summary

A web-based gateway that allows multiple people on the local network to access and use Claude Code and JARVIS from their own computers, as if it were running locally. Provides user authentication, session isolation, per-user history and storage, and activity tracking.

## Problem Statement

Currently, Claude Code + JARVIS runs exclusively on a single developer workstation. This creates bottlenecks:
1. **Single point of access** — only one person can use JARVIS at a time, from one machine
2. **No collaboration** — colleagues can't see or benefit from JARVIS capabilities
3. **No audit trail** — no visibility into who asked what, when, or what was changed
4. **No resource sharing** — JARVIS skills, MCP servers, and orchestration are locked to one machine

The goal is a LAN-accessible web interface where authenticated users get their own isolated JARVIS sessions backed by the same infrastructure.

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│ User's Browser (any LAN machine)                                    │
│   ┌──────────────────────────────────────┐                          │
│   │  Web Terminal UI (xterm.js)          │                          │
│   │  + JARVIS Dashboard sidebar          │                          │
│   │  + Session history / file browser    │                          │
│   └──────────┬───────────────────────────┘                          │
└──────────────┼──────────────────────────────────────────────────────┘
               │ WebSocket (wss://)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ JARVIS Gateway Server (Node.js/Go, runs on host machine)            │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐ │
│  │ Auth Layer   │  │ Session Mgr  │  │ Activity Tracker            │ │
│  │ (JWT/local)  │  │ (per-user    │  │ (log queries, tool calls,   │ │
│  │              │  │  isolation)  │  │  file changes, timestamps)  │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬────────────────┘ │
│         │                │                        │                  │
│  ┌──────▼────────────────▼────────────────────────▼───────────────┐  │
│  │ Process Manager                                                │  │
│  │  - Spawns `claude` CLI process per session                     │  │
│  │  - PTY allocation (node-pty)                                   │  │
│  │  - Stdin/stdout/stderr proxying via WebSocket                  │  │
│  │  - Session timeout & cleanup                                   │  │
│  │  - Resource limits (max concurrent sessions, memory caps)      │  │
│  └──────┬────────────────────────────────────────────────────────┘  │
│         │                                                           │
│  ┌──────▼──────────────────────────────────────────────────────┐    │
│  │ Per-User Sandboxes                                          │    │
│  │  user-a/  ← HOME override, own .claude/, own session files  │    │
│  │  user-b/  ← Isolated environment, shared JARVIS skills      │    │
│  │  user-c/  ← Read-only access to shared workspaces           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Authentication Layer

```
POST /api/auth/login     { username, password } → JWT token
POST /api/auth/register  { username, password, display_name } → account (admin-approved)
GET  /api/auth/me        → user profile, permissions
POST /api/auth/logout    → invalidate token
```

- **Local accounts** stored in SQLite (bcrypt-hashed passwords)
- **Role-based access**: `admin` (full access, user management), `user` (own sessions only), `viewer` (read-only dashboard)
- **JWT tokens** with 24h expiry, refresh mechanism
- **Optional**: LDAP/OAuth integration for corporate environments (future)

#### 2. Session Manager

Each user gets an isolated Claude Code session:

```javascript
class SessionManager {
  // Create new session for user
  createSession(userId, options) {
    const sandbox = createUserSandbox(userId);
    const pty = spawn('claude', ['--json'], {
      cwd: sandbox.workDir,
      env: {
        HOME: sandbox.homeDir,           // Isolated home
        CLAUDE_CONFIG_DIR: sandbox.claudeDir,  // Shared skills, own settings
        ANTHROPIC_API_KEY: getApiKey(userId),   // Per-user or shared key
        ...sandbox.env
      }
    });
    return { sessionId, pty, sandbox };
  }

  // List active sessions for user
  listSessions(userId) { ... }

  // Resume existing session
  resumeSession(userId, sessionId) { ... }

  // Terminate session (with optional save)
  terminateSession(sessionId) { ... }
}
```

#### 3. User Sandbox

Each user gets an isolated environment:

```
data/users/{username}/
├── .claude/
│   ├── settings.local.json    # User-specific settings (inherits from shared)
│   ├── projects/              # User's project memory
│   └── sessions/              # Session transcripts
├── workdir/                   # User's working directory
├── history/                   # Command and conversation history
└── files/                     # User-uploaded files
```

**Shared resources** (read-only symlinks):
- `JARVIS/.claude/skills/` → all JARVIS skills available to every user
- `JARVIS/mcp-servers/` → shared MCP servers
- `JARVIS/workspaces/` → shared workspace access (configurable per user)

#### 4. Activity Tracker

```json
{
  "events": [
    {
      "timestamp": "2026-02-20T14:30:00Z",
      "user": "pedro",
      "session": "sess-abc123",
      "type": "query",
      "summary": "Asked about VK 03002 health status",
      "tokens_used": 1523,
      "tools_called": ["Bash", "Read"],
      "duration_ms": 4200
    }
  ]
}
```

Tracks:
- **Queries**: What each user asked (sanitized summary, not full prompt)
- **Tool calls**: Which tools were invoked, on which files
- **Token usage**: Per-user consumption for cost attribution
- **Session duration**: Active time, idle time, total time
- **File modifications**: What files were changed, by whom

**Dashboard view** (admin):
- Active sessions (who's online now)
- Usage per user (daily/weekly/monthly)
- Token consumption and estimated cost
- Most-used skills and tools
- Session replay (read-only transcript view)

#### 5. Web Frontend

**Tech stack**: Vue 3 + xterm.js (terminal emulator) + PrimeVue (dashboard)

**Views**:
- **Terminal** — Full Claude Code terminal emulated in browser (xterm.js + WebSocket PTY proxy)
- **Dashboard** — Activity overview, session history, quick actions
- **Sessions** — List of past sessions, resume or review transcripts
- **Admin** — User management, API key configuration, usage reports
- **Files** — Browse shared workspaces and user files

**Dark theme** (Strokmatic standard), responsive design for desktop use.

### API Key Management

Three models:

| Model | Description | Use Case |
|-------|-------------|----------|
| **Shared key** | Single Anthropic API key, all users share | Small team, trust-based |
| **Per-user keys** | Each user provides their own API key | Cost attribution, no shared billing |
| **Pool + quotas** | Shared key with per-user token quotas | Cost control, admin-managed |

**Recommendation**: Start with shared key + per-user quotas (simplest to implement, provides cost visibility).

### Security Considerations

1. **Process isolation**: Each `claude` process runs under a separate OS user or in a container (Docker per session for strong isolation, OS user for lightweight)
2. **Filesystem isolation**: Users cannot access each other's sandboxes; shared resources are read-only
3. **Network isolation**: Gateway binds to LAN interface only (not public); optional reverse proxy with TLS
4. **API key security**: Keys stored encrypted in SQLite, never sent to frontend
5. **Session timeout**: Auto-terminate idle sessions after configurable period (default: 30 min)
6. **Rate limiting**: Per-user request limits to prevent abuse
7. **Audit logging**: All actions logged for accountability

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Very Large | Full-stack web app + process management + security |
| **Risk** | High | Security (multi-user access to CLI), resource management, isolation |
| **Dependencies** | Claude Code CLI | Must support non-interactive usage or PTY spawning |
| **Testing** | Very High | Multi-user concurrency, isolation verification, security audit |
| **Maintenance** | High | Claude Code updates may break PTY integration |

**Overall Complexity: Very High — This is the most ambitious item in the backlog.**

## Development Phases

### Phase 1 — Core Gateway + PTY Proxy
**Estimate: 12-15 hours**

1. Set up Node.js server with Express + WebSocket (ws library)
2. Implement PTY spawning via `node-pty` for `claude` CLI processes
3. Implement WebSocket ↔ PTY bidirectional proxy
4. Create minimal xterm.js frontend that connects to PTY
5. Test: single user can use Claude Code from browser
6. Add basic session lifecycle (create, list, resume, terminate)
7. Add session persistence (save/restore working directory)

### Phase 2 — Authentication + User Isolation
**Estimate: 8-12 hours**

1. Implement SQLite user store with bcrypt password hashing
2. Implement JWT authentication (login, register, token refresh)
3. Create user sandbox structure (isolated home dirs)
4. Implement shared resource symlinks (skills, MCP servers)
5. Add role-based access control (admin, user, viewer)
6. Add API key management (shared key with per-user quotas)
7. Test: two users can run concurrent sessions without interference

### Phase 3 — Activity Tracking + Dashboard
**Estimate: 8-10 hours**

1. Implement activity event capture (intercept PTY I/O for metadata)
2. Create SQLite schema for events, sessions, usage metrics
3. Build Vue 3 dashboard with PrimeVue components
4. Implement views: active sessions, user usage, token consumption
5. Add session transcript viewer (read-only replay)
6. Add admin panel: user management, quotas, system health
7. Dark theme styling consistent with JARVIS aesthetic

### Phase 4 — Security Hardening + Resource Management
**Estimate: 6-8 hours**

1. Implement per-session resource limits (memory, CPU via cgroups or Docker)
2. Add session timeout with graceful cleanup
3. Add rate limiting per user
4. TLS termination (self-signed cert or Let's Encrypt for LAN)
5. Filesystem permission audit (verify sandbox isolation)
6. Input sanitization (prevent PTY escape sequences attacks)
7. Security testing: attempt cross-session access, privilege escalation

### Phase 5 — Polish + Deployment
**Estimate: 6-10 hours**

1. Docker Compose deployment (gateway + frontend + SQLite volume)
2. Nginx reverse proxy configuration
3. Health monitoring for gateway service
4. User onboarding flow (first login experience)
5. Mobile-responsive terminal (for tablet use)
6. Documentation: admin guide, user guide, security model
7. Load testing: 5-10 concurrent sessions on target hardware

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Core gateway | 12-15h | None |
| Phase 2 — Auth + isolation | 8-12h | Phase 1 |
| Phase 3 — Dashboard | 8-10h | Phase 2 |
| Phase 4 — Security | 6-8h | Phase 3 |
| Phase 5 — Deployment | 6-10h | Phase 4 |
| **Total** | **40-55h** | |

## Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Backend** | Node.js (Express) | node-pty integration, WebSocket native, same as MCP servers |
| **Terminal** | xterm.js | Industry standard web terminal, full VT100 compat |
| **PTY** | node-pty | Battle-tested PTY library, used by VS Code terminal |
| **Frontend** | Vue 3 + PrimeVue | Consistent with PMO Dashboard, dark theme ready |
| **Auth** | JWT + SQLite | Simple, no external auth server needed |
| **WebSocket** | ws library | Fast, lightweight, no Socket.IO overhead |
| **Deployment** | Docker Compose | Consistent with existing JARVIS infrastructure |

## Open Questions

1. **Anthropic API key sharing**: Is it permissible under Anthropic ToS to share a single API key across multiple users via a gateway?
2. **Claude Code licensing**: Does Claude Code's license allow running it as a shared service behind a web proxy?
3. **Process isolation level**: Docker containers per session (strong, heavy) vs OS user separation (lighter, weaker)?
4. **Workspace write access**: Should non-admin users be able to modify shared workspace files, or read-only with suggestions?
5. **Cost model**: Flat team subscription, per-user billing, or shared pool?

## Alternatives Considered

| Alternative | Pros | Cons |
|------------|------|------|
| **SSH access to host** | Zero development, works now | No web UI, no isolation, no tracking |
| **VS Code Remote + Claude extension** | Familiar IDE, good UX | Requires VS Code, no custom dashboard |
| **Coder (code-server)** | Open source, mature | Heavy (full IDE), no Claude-native integration |
| **Custom gateway (this spec)** | Purpose-built, JARVIS-native, full control | Most development effort |

**Recommendation**: Custom gateway — the others don't provide the JARVIS-specific integration (skills, MCP servers, activity tracking) that makes this valuable.

## References

- xterm.js: https://xtermjs.org/
- node-pty: https://github.com/nicktaf/node-pty (forked from microsoft/node-pty)
- PMO Dashboard (same tech stack): `tools/pmo-dashboard/`
- Claude Code CLI: `claude` command, `--json` output mode
