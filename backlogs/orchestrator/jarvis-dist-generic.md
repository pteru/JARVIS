# JARVIS Distribution — Generic Edition

## Summary

Generate a fully sanitized JARVIS distribution that removes all Strokmatic-specific details, suitable for public or community distribution. Provides the orchestration framework, skill templates, MCP server patterns, and hook system as a reusable starting point for any team adopting Claude Code at scale.

## Problem Statement

The Strokmatic JARVIS distribution (see `jarvis-dist-strokmatic.md`) strips personal data but retains product-specific context (DieMaster, SpotFusion, VisionKing). For broader distribution:

1. **Product names and contexts** must be replaced with generic examples
2. **Project codes** (01xxx, 02xxx, 03xxx) need generic equivalents
3. **Deployment-specific scripts** (vk-health) need generic monitoring templates
4. **Industry-specific skills** (/visionking, /spotfusion, /diemaster) need removal or generalization
5. **PMO project structure** should use example projects, not real ones

The generic edition should work as a "JARVIS starter kit" — clone, run setup, and start orchestrating any codebase.

## Dependency

**Requires Strokmatic distribution first.** The generic edition is built by applying a second sanitization pass on top of the Strokmatic distribution:

```
Personal JARVIS → [strip personal] → Strokmatic JARVIS → [strip company] → Generic JARVIS
```

This avoids maintaining two independent build pipelines.

## Architecture

### What Changes from Strokmatic → Generic

| Component | Strokmatic Edition | Generic Edition |
|-----------|-------------------|-----------------|
| Product contexts | VK, SF, DM full context files | Removed; replaced with `example-product/context.md` template |
| Skills | 25 skills (product-specific + generic) | ~12 skills (generic only: /gdoc, /gsheet, /gdrive, /md-to-pdf, /mechanical, /pr-review, /xlsx, /mermaid, /pmo, /email-analyze, /email-organizer, /help-strokmatic→/help) |
| Product skills | /visionking, /spotfusion, /diemaster, /vk-health, /vk-pipeline, etc. | Removed; replaced with template skill (`/my-product`) |
| Backlogs | Strokmatic product backlogs + plans | Removed; empty backlog structure with example entries |
| Project codes | 22 Strokmatic projects | 3 example projects (EX-001, EX-002, EX-003) |
| Workspaces config | Strokmatic workspace tree | Example workspace config (2-3 example repos) |
| Health monitoring | vk-health scripts for deployment 03002 | Generic health monitoring template (parameterized) |
| MCP servers | google-workspace (Strokmatic SA) | google-workspace (parameterized, no credentials) |
| CLAUDE.md | Strokmatic lessons learned | Cleaned: keep generic lessons, remove product-specific |
| Company references | "Strokmatic", "Lume Solutions" | Removed entirely |

### Directory Structure (Distribution)

```
releases/JARVIS-generic/
├── README.md                          # "Getting Started with JARVIS"
├── ARCHITECTURE.md                    # System overview, data flow, extension guide
├── LICENSE                            # Choose: MIT, Apache 2.0, or proprietary
├── scripts/
│   ├── setup.sh                       # First-run setup wizard
│   ├── build-distribution.sh          # Meta: how this was built
│   ├── health/                        # Generic health monitoring template
│   │   ├── collect.sh.template
│   │   ├── analyze.sh.template
│   │   └── alert.sh.template
│   └── helpers/
│       ├── log-dispatch.sh
│       └── clean-review-for-github.sh
├── .claude/
│   ├── CLAUDE.md                      # Generic orchestrator guidelines
│   ├── skills/
│   │   ├── gdoc/SKILL.md
│   │   ├── gsheet/SKILL.md
│   │   ├── gslides/SKILL.md
│   │   ├── gdrive/SKILL.md
│   │   ├── gdrive-setup/SKILL.md
│   │   ├── md-to-pdf/SKILL.md
│   │   ├── mechanical/SKILL.md
│   │   ├── pr-review/SKILL.md
│   │   ├── xlsx/SKILL.md
│   │   ├── mermaid/SKILL.md
│   │   ├── pmo/SKILL.md
│   │   ├── email-organizer/SKILL.md
│   │   ├── help/SKILL.md             # Generic help (was /help-strokmatic)
│   │   └── my-product/SKILL.md       # Template: "How to create a product skill"
│   ├── hooks/
│   │   ├── lib/utils.sh
│   │   └── ...                        # Hook system (generic)
│   └── settings.local.json.template
├── config/
│   ├── orchestrator/
│   │   ├── workspaces.json.example
│   │   └── drive-organize-rules.json
│   ├── project-codes.json.example     # 3 example projects
│   └── credentials/
│       └── README.md
├── mcp-servers/
│   └── google-workspace/              # Parameterized MCP server
├── backlogs/
│   ├── orchestrator/
│   │   └── README.md                  # Empty backlog template
│   ├── products/
│   │   └── example.product.md         # Example backlog format
│   └── plans/
│       └── example.product.md         # Example plan format
├── workspaces/
│   └── example/
│       └── .claude/
│           ├── context.md.template    # Template workspace context
│           ├── CLAUDE.md.template     # Template project instructions
│           └── backlog.md.template    # Template backlog
├── tools/
│   ├── pmo-dashboard/                 # Generic PMO dashboard (no Strokmatic data)
│   └── email-organizer/               # Email organizer tool
├── changelogs/
│   └── example.product.md            # Example changelog
├── docs/
│   ├── getting-started.md
│   ├── creating-skills.md
│   ├── creating-mcp-servers.md
│   ├── hook-system.md
│   └── workspace-management.md
└── templates/
    ├── skill/SKILL.md                 # Blank skill template
    ├── mcp-server/                    # Blank MCP server scaffold
    ├── hook/                          # Blank hook template
    └── workspace-context.md           # Blank workspace context template
```

### Documentation Suite (New)

The generic edition needs proper documentation since users won't have institutional knowledge:

1. **Getting Started** — Install, setup, first skill invocation
2. **Creating Skills** — SKILL.md format, argument handling, file paths
3. **Creating MCP Servers** — MCP protocol, tool registration, Claude Code integration
4. **Hook System** — Available hooks, writing custom hooks, fail-open design
5. **Workspace Management** — Adding repos, context files, backlog sync

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium | Second-pass sanitization on top of Strokmatic edition |
| **Risk** | Low | Can't leak data that was already stripped |
| **Dependencies** | Strokmatic edition | Must be built first (Phase 4 of jarvis-dist-strokmatic) |
| **Testing** | High | Must work on completely fresh machine with no prior context |
| **Maintenance** | Ongoing | Keep in sync with new features added to JARVIS |

**Overall Complexity: Medium**

## Development Phases

### Phase 1 — Second-Pass Sanitization Script
**Estimate: 3-4 hours**

1. Extend `build-distribution.sh` with `--target generic` mode
2. Remove all product-specific skills (/visionking, /spotfusion, /diemaster, etc.)
3. Replace product backlogs with example templates
4. Strip company names ("Strokmatic", "Lume Solutions", "strokmatic.iam")
5. Replace project codes with generic examples (EX-001, EX-002, EX-003)
6. Create generic health monitoring templates from vk-health scripts
7. Validate: grep for product names, company names, deployment codes

### Phase 2 — Documentation & Templates
**Estimate: 4-6 hours**

1. Write `README.md` — elevator pitch, features list, quick start
2. Write `ARCHITECTURE.md` — system diagram, data flow, extension points
3. Write 5 documentation guides (getting-started, skills, MCP, hooks, workspaces)
4. Create template files (blank skill, blank MCP server, blank hook, blank context)
5. Create example workspace with annotated template files
6. Write `/my-product` example skill showing how to add product context

### Phase 3 — Packaging & Distribution
**Estimate: 3-5 hours**

1. Build and test on clean Docker container (Ubuntu 22.04, fresh user)
2. Run setup wizard, verify all skills and hooks work
3. Test creating a new workspace from templates
4. Choose license (MIT for maximum adoption, Apache 2.0 for patent protection)
5. Create GitHub repo `jarvis-orchestrator` (or similar)
6. Write GitHub README with badges, screenshots, feature list
7. Package as `.tar.gz` release + Docker image

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Sanitization | 3-4h | Strokmatic edition complete |
| Phase 2 — Documentation | 4-6h | Phase 1 |
| Phase 3 — Packaging | 3-5h | Phase 2 |
| **Total** | **10-15h** | |

## Open Questions

1. **License**: MIT (maximum adoption) vs Apache 2.0 (patent protection) vs proprietary?
2. **Name**: "JARVIS Orchestrator"? "Claude Orchestrator"? (trademark considerations — "JARVIS" is Marvel IP)
3. **Distribution channel**: Public GitHub? Private npm? Both?
4. **Anthropic relationship**: Should this reference Claude Code explicitly, or be "AI assistant agnostic"?

## References

- Depends on: `jarvis-dist-strokmatic.md` (must complete first)
- Existing release dir: `releases/` (has `JARVIS-strokmatic/` placeholder)
- Sanitization audit: 100+ company references, 50+ personal paths, 25 skills to review
