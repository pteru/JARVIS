# JARVIS Distribution — Strokmatic Edition

## Summary

Generate a non-personal, Strokmatic-branded JARVIS distribution for colleagues. Strip all personal data (teruel-specific paths, personal emails, personal session history) while preserving the full product context (DieMaster, SpotFusion, VisionKing), skills library, MCP servers, hooks, and orchestration infrastructure. Output to `releases/JARVIS-strokmatic/`.

## Problem Statement

The current JARVIS installation is deeply personalized:
- **50+ files** contain `/home/teruel/JARVIS` hardcoded paths
- **3 files** contain `pedro@lumesolutions.com` (personal impersonation email)
- **Credentials** are personal (GCP service account, SSH passwords, OAuth tokens)
- **Session memory** (`MEMORY.md`) contains personal workflow notes
- **Dispatch logs** contain personal task history
- **VK Health data** contains production deployment specifics

A colleague installing JARVIS needs the framework (skills, MCP servers, hooks, backlog system) but with their own identity, credentials, and workspace paths.

## Data Classification

### KEEP (Strokmatic-relevant)
- Product context files (`context.md` for VK, SF, DM)
- CLAUDE.md project instructions
- Skills library (all 25 skills)
- MCP servers (google-workspace, backlog-manager, changelog-writer, etc.)
- Hooks system (pre-dispatch validator, backlog preloader, etc.)
- Backlog structure and product task lists
- Implementation plans
- Orchestrator specs and architecture docs
- Script templates (vk-health, pr-review, etc.)
- Config templates (workspaces, project-codes)

### STRIP (Personal)
- `/home/teruel` → `${HOME}/JARVIS` (or `$ORCHESTRATOR_HOME`)
- `pedro@lumesolutions.com` → `${IMPERSONATION_EMAIL}`
- `config/credentials/` → empty dir with `.gitkeep` + setup instructions
- `~/.secrets/` references → `${HOME}/.secrets/` with placeholder files
- `data/vk-health/03002/` → empty (no raw monitoring data)
- `reports/vk-health/03002/*.md` → keep `latest.md` as example only
- `reports/pr-inbox.json`, `pr-reviews/` → empty
- `reports/github-access-matrix.md` → delete (contains usernames)
- `logs/dispatches.json` → empty JSON array
- `.claude/projects/*/memory/MEMORY.md` → template with section headers only
- `data/email-organizer/` → empty
- Session-specific reports (`daily-*.md`, `morning-*.txt`) → delete

### PARAMETERIZE (Config-driven)
- `config/orchestrator/workspaces.json` → auto-generated from workspace discovery
- `config/project-codes.json` → keep structure, clear personal Drive IDs
- `config/vk-deployments/03002.json` → keep as example, anonymize IPs
- MCP server impersonation email → config variable
- Service account key path → config variable

## Architecture

### Build Script

```bash
scripts/build-distribution.sh --target strokmatic --output releases/JARVIS-strokmatic/
```

Steps:
1. **Copy** — rsync JARVIS tree excluding `.git`, `node_modules`, `.venv`, `data/`, `logs/`
2. **Sanitize paths** — `sed -i` replace `/home/teruel/JARVIS` → `\${ORCHESTRATOR_HOME}`
3. **Sanitize credentials** — remove credential files, create placeholders
4. **Sanitize personal data** — remove email, usernames from config files
5. **Clear transient data** — empty dispatches, reports, health data
6. **Create setup wizard** — `scripts/setup.sh` that prompts for user identity, paths, credentials
7. **Validate** — grep for remaining personal data patterns (teruel, pedro@, specific IPs)
8. **Package** — create `.tar.gz` with version tag

### Setup Wizard (`scripts/setup.sh`)

First-run script for new installations:

```bash
#!/bin/bash
echo "=== JARVIS Setup Wizard ==="

read -p "Your name (for git commits): " USER_NAME
read -p "Your email: " USER_EMAIL
read -p "JARVIS home directory [$(pwd)]: " JARVIS_HOME
read -p "Google impersonation email (for GWorkspace): " IMPERSONATION_EMAIL
read -p "GCP service account JSON path: " GCP_KEY_PATH

# 1. Set ORCHESTRATOR_HOME in all configs
# 2. Register MCP servers in ~/.claude/settings.local.json
# 3. Copy/link credential files
# 4. Discover workspaces and generate workspaces.json
# 5. Initialize empty memory file
# 6. Run health check (verify MCP servers respond)
```

### Directory Structure (Distribution)

```
releases/JARVIS-strokmatic/
├── README.md                          # Installation guide
├── scripts/
│   ├── setup.sh                       # First-run setup wizard
│   ├── build-distribution.sh          # Meta: build this distribution
│   └── ...                            # All operational scripts
├── .claude/
│   ├── CLAUDE.md                      # Sanitized project instructions
│   ├── skills/                        # All 25 skills (paths parameterized)
│   ├── hooks/                         # Hook system
│   └── settings.local.json.template   # Template for MCP server registration
├── config/
│   ├── orchestrator/
│   │   └── workspaces.json.template   # Auto-generated on setup
│   ├── project-codes.json             # Strokmatic projects (Drive IDs cleared)
│   ├── vk-deployments/
│   │   └── 03002.json.example         # Anonymized deployment example
│   └── credentials/
│       ├── .gitkeep
│       └── README.md                  # "Place your GCP key here"
├── mcp-servers/                       # All MCP servers
├── backlogs/                          # Full backlog structure
├── workspaces/                        # Strokmatic workspace tree (submodules)
├── tools/                             # PMO dashboard, email organizer, etc.
└── changelogs/
```

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium-Large | Touches 50+ files, need thorough sanitization verification |
| **Risk** | Medium | Incomplete sanitization could leak credentials or personal data |
| **Dependencies** | None | Can be built independently |
| **Testing** | High | Must verify on clean machine with new user account |
| **Maintenance** | Ongoing | Each new feature/skill needs distribution-awareness |

**Overall Complexity: Medium-High**

## Development Phases

### Phase 1 — Build Script Foundation
**Estimate: 4-5 hours**

1. Create `scripts/build-distribution.sh` with rsync + exclusion patterns
2. Implement path sanitization (`/home/teruel/JARVIS` → `${ORCHESTRATOR_HOME}`)
3. Implement credential stripping (delete files, create placeholders)
4. Implement personal data removal (emails, usernames)
5. Implement transient data clearing (logs, reports, health data)
6. Add validation step: grep for leak patterns, fail build if found

### Phase 2 — Setup Wizard
**Estimate: 4-5 hours**

1. Create `scripts/setup.sh` interactive wizard
2. Implement workspace discovery (scan for `.git` directories, generate `workspaces.json`)
3. Implement MCP server registration (write to `~/.claude/settings.local.json`)
4. Implement credential linking/copying
5. Implement first-run health check (verify MCP servers, test API call)
6. Create `README.md` installation guide with prerequisites

### Phase 3 — Skill & Config Parameterization
**Estimate: 4-5 hours**

1. Update all 25 SKILL.md files to use `${ORCHESTRATOR_HOME}` or relative paths
2. Create `.json.template` variants for all config files
3. Update `settings.local.json` to use config variables
4. Update hook scripts (`lib/utils.sh`) to resolve `ORCHESTRATOR_HOME` dynamically
5. Test: run full skill set with parameterized paths

### Phase 4 — Validation & Packaging
**Estimate: 3-5 hours**

1. Build distribution on main machine
2. Deploy to test machine (or Docker container) with fresh user
3. Run setup wizard end-to-end
4. Verify: all skills load, MCP servers respond, hooks execute
5. Fix any hardcoded paths missed by sanitization
6. Package as `.tar.gz` with version tag
7. Document known limitations

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Build script | 4-5h | None |
| Phase 2 — Setup wizard | 4-5h | Phase 1 |
| Phase 3 — Parameterization | 4-5h | Phase 1 |
| Phase 4 — Validation | 3-5h | Phases 2 + 3 |
| **Total** | **15-20h** | |

## Critical Considerations

1. **Credential rotation**: After first distribution, rotate the Strokmatic service account key (the old one was accessible to the personal installation)
2. **Submodule access**: Colleagues need GitHub access to `strokmatic/*` repos; distribution includes submodule references but not actual code
3. **MCP server dependencies**: `npm install` required in `mcp-servers/google-workspace/` — include in setup wizard
4. **Claude Code version**: Document minimum Claude Code version required for skills/hooks
5. **Distribution channel**: Git repo (`strokmatic/jarvis-strokmatic`) or shared drive `.tar.gz`?

## References

- Existing release directory: `releases/JARVIS-strokmatic/` (empty, ready)
- Sanitization audit: 50+ files with personal paths, 3 with emails, 4 credential files
- Skills inventory: 25 skills in `.claude/skills/`
- MCP servers: `mcp-servers/google-workspace/`, plus 5 in `tools/`
