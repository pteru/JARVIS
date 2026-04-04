# Google Workspace Tools — Distributable Package

## Summary

Package the Google Workspace MCP server, associated Claude Code skills (`/gdoc`, `/gsheet`, `/gslides`, `/gdrive`, `/gdrive-setup`), and configuration templates into a self-contained, distributable artifact. Enable other teams or users to install and configure the integration without access to the JARVIS orchestrator.

## Problem Statement

The current Google Workspace integration is tightly coupled to:
1. **JARVIS directory structure** — MCP server at `mcp-servers/google-workspace/`, skills at `.claude/skills/`
2. **Strokmatic credentials** — Service account for `strokmatic` GCP project, impersonating `pedro@lumesolutions.com`
3. **Hardcoded config** — `config/project-codes.json` with Strokmatic-specific Drive folder IDs
4. **Manual setup** — No install wizard; requires understanding of GCP service accounts, domain-wide delegation, MCP protocol

This makes it impossible for a colleague (or external user) to simply "install" the GDrive integration.

## Architecture

### Package Structure

```
@strokmatic/google-workspace-mcp/
├── package.json                     # npm package (scoped or unscoped)
├── README.md                        # Full setup guide with screenshots
├── LICENSE
├── index.js                         # MCP server (extracted from current, parameterized)
├── bin/
│   └── setup.js                     # Interactive setup wizard (Node.js CLI)
├── config/
│   ├── config.example.json          # Template config (no real credentials)
│   ├── project-codes.example.json   # Example project structure
│   └── drive-organize-rules.json    # Default classification rules
├── skills/
│   ├── gdoc/SKILL.md
│   ├── gsheet/SKILL.md
│   ├── gslides/SKILL.md
│   ├── gdrive/SKILL.md
│   └── gdrive-setup/SKILL.md
├── docker-compose.yml               # Optional: run as Docker container
├── Dockerfile
└── docs/
    ├── gcp-setup.md                 # Step-by-step GCP service account creation
    ├── admin-console-delegation.md  # Domain-wide delegation setup (with screenshots)
    └── claude-code-integration.md   # How to register as MCP server in Claude Code
```

### Setup Wizard (`bin/setup.js`)

Interactive CLI that:

1. **Checks prerequisites**: Node.js >= 18, npm, Claude Code installed
2. **Collects GCP config**: prompts for service account JSON path or OAuth client ID
3. **Validates credentials**: attempts a test API call (list root Drive)
4. **Configures impersonation**: asks for email to impersonate (for domain-wide delegation)
5. **Registers MCP server**: writes entry to `~/.claude/settings.local.json`
6. **Installs skills**: copies SKILL.md files to `~/.claude/skills/`
7. **Creates config**: writes `config.json` with validated settings
8. **Tests end-to-end**: creates a test Google Doc, reads it back, deletes it

```bash
# Installation flow
npm install -g @strokmatic/google-workspace-mcp
google-workspace-mcp setup
# → Interactive wizard runs
# → Claude Code MCP server registered
# → Skills installed
# → Ready to use /gdoc, /gsheet, /gslides, /gdrive
```

### Parameterization (Extract from JARVIS-specific)

Current hardcoded values → config-driven:

| Current (hardcoded) | Package (config) |
|---------------------|------------------|
| `jarvis-workspace@strokmatic.iam...` | `config.serviceAccount.email` |
| `pedro@lumesolutions.com` | `config.impersonateUser` |
| `config/credentials/gcp-service-account.json` | `config.serviceAccount.keyFile` |
| `config/project-codes.json` | `config.projectCodesPath` (optional) |
| Strokmatic Shared Drive IDs | User configures via `/gdrive-setup` wizard |

### Distribution Channels

1. **npm (private or public)**: `npm install @strokmatic/google-workspace-mcp`
2. **GitHub Release**: `.tar.gz` with pre-bundled `node_modules`
3. **Docker**: `docker run -v ./config:/app/config strokmatic/gworkspace-mcp`

**Recommendation**: npm (private scope `@strokmatic`) for internal distribution; GitHub release for broader sharing.

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium | Mostly refactoring existing code into config-driven form |
| **Risk** | Low | No new functionality — repackaging what works |
| **Dependencies** | None | Self-contained; depends only on googleapis + @modelcontextprotocol/sdk |
| **Testing** | Medium | Need to test setup wizard on clean machine |
| **Maintenance** | Low | Track upstream MCP SDK changes |

**Overall Complexity: Medium**

## Development Phases

### Phase 1 — Parameterize MCP Server
**Estimate: 3-4 hours**

1. Extract all hardcoded values from `index.js` into a config loader
2. Create `config.example.json` with documented fields
3. Add config validation on startup (fail-fast with clear error messages)
4. Support both service account and OAuth2 auth modes from config
5. Test: run parameterized server against Strokmatic credentials (backward compat)

### Phase 2 — Setup Wizard + Skills Packaging
**Estimate: 3-5 hours**

1. Create `bin/setup.js` interactive CLI (using `inquirer` or `readline`)
2. Implement credential validation (test API call)
3. Implement Claude Code MCP server registration (write to `settings.local.json`)
4. Implement skills installer (copy SKILL.md files, update paths)
5. Update all SKILL.md files to use dynamic paths (`${MCP_CONFIG_DIR}` or relative)
6. Write `README.md` with full setup guide
7. Write `docs/gcp-setup.md` with step-by-step GCP instructions

### Phase 3 — Packaging & Distribution
**Estimate: 2-3 hours**

1. Create `package.json` with proper metadata, bin entry, dependencies
2. Add `.npmignore` (exclude test files, dev config)
3. Create `Dockerfile` + `docker-compose.yml` for containerized deployment
4. Build and test npm package on clean environment
5. Publish to npm (private scope) or create GitHub release
6. Test installation from scratch on a second machine

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Parameterize | 3-4h | None |
| Phase 2 — Wizard + Skills | 3-5h | Phase 1 |
| Phase 3 — Packaging | 2-3h | Phase 2 |
| **Total** | **8-12h** | |

## References

- Current MCP server: `mcp-servers/google-workspace/index.js` (1,877 lines)
- MCP SDK: `@modelcontextprotocol/sdk`
- Skills: `.claude/skills/gdoc/`, `gsheet/`, `gslides/`, `gdrive/`, `gdrive-setup/`
- Claude Code MCP registration: `~/.claude/settings.local.json` → `mcpServers` section
