# `/cleanup` Skill — Post-Task Cleanup Ritual

## Summary

A Claude Code skill invoked as `/cleanup` after completing a task. It performs a standardized end-of-task ritual: checks the git worktree and branch state, prepares and stages changes for commit, updates relevant context files and changelogs, reruns checks (lint, tests), and presents a clean commit-ready summary.

## Problem Statement

After completing a task, several cleanup steps are frequently forgotten or done inconsistently:
1. **Unstaged files** — new files created during the task aren't `git add`ed
2. **Branch hygiene** — work done on wrong branch, or branch not pushed
3. **Context drift** — `.claude/context.md` and `.claude/backlog.md` not updated to reflect completed work
4. **Missing changelog** — changelog entry not added via changelog-writer MCP
5. **Broken checks** — lint errors or test failures introduced but not caught
6. **Backlog not updated** — completed task not marked done in backlog-manager MCP

The `/cleanup` skill codifies this into a single command.

## Workflow

```
User: /cleanup

JARVIS:
  1. GIT STATUS CHECK
     ├─ Show current branch name
     ├─ Show remote tracking status (ahead/behind)
     ├─ List modified files (staged + unstaged)
     ├─ List untracked files
     └─ Flag if on wrong branch (main/master/develop)

  2. BRANCH ANALYSIS
     ├─ Suggest branch name if on default branch
     ├─ Check if feature branch exists for this work
     └─ Offer to create/switch branch if needed

  3. CHANGE REVIEW
     ├─ Show diff summary (files changed, insertions, deletions)
     ├─ Identify likely commit groups (if changes span multiple concerns)
     ├─ Flag potentially dangerous changes (.env, credentials, large binaries)
     └─ Flag files that should NOT be committed (.pyc, __pycache__, node_modules)

  4. CONTEXT & DOCUMENTATION UPDATE
     ├─ Check if workspace context.md needs updating (new services, changed architecture)
     ├─ Check if backlog.md has tasks that match this work → mark complete
     ├─ Check if CLAUDE.md needs new constraints or lessons learned
     ├─ Prompt for changelog entry if not already added
     └─ Use changelog-writer MCP tool to record the change

  5. CHECKS
     ├─ Detect project type (Python → pytest/ruff, Node → npm test/eslint, etc.)
     ├─ Run linter if available
     ├─ Run tests if available
     ├─ Report pass/fail summary
     └─ If failures: show errors, offer to fix before committing

  6. COMMIT PREPARATION
     ├─ Stage appropriate files (excluding .env, credentials, binaries)
     ├─ Draft commit message based on changes
     ├─ Present summary for user approval
     └─ On approval: commit (with Co-Authored-By)

  7. POST-COMMIT
     ├─ Show final git status (clean worktree)
     ├─ Remind about pushing if branch has unpushed commits
     └─ Suggest PR creation if feature branch
```

## Skill Definition

```yaml
# .claude/skills/cleanup/SKILL.md
name: cleanup
description: Post-task cleanup — check worktree, stage changes, update docs, run checks, commit
argument-hint: "[workspace-name] (optional — defaults to current directory)"
```

### Argument Handling

- **No argument**: Operates on current working directory, auto-detects workspace
- **With workspace name**: e.g., `/cleanup strokmatic.visionking.services.backend` — navigates to that workspace path from `workspaces.json`

### Configuration

The skill reads project type from existing indicators:

| Indicator | Type | Linter | Tests |
|-----------|------|--------|-------|
| `pyproject.toml` or `setup.py` | Python | `ruff check .` | `pytest` |
| `package.json` | Node.js | `npm run lint` (if script exists) | `npm test` (if script exists) |
| `Cargo.toml` | Rust | `cargo clippy` | `cargo test` |
| `go.mod` | Go | `golangci-lint run` | `go test ./...` |
| `platformio.ini` | Firmware | `pio check` | `pio test` |

If no indicator is found, skip linting/testing and note it.

### Integration with MCP Tools

The skill uses these MCP tools when available:
- **backlog-manager** `complete_task` — mark matching backlog task as done
- **changelog-writer** `add_changelog_entry` — record the change
- **workspace-analyzer** `generate_workspace_context` — refresh context.md if stale

If MCP tools aren't available, the skill falls back to direct file editing.

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Small-Medium | Single SKILL.md file, mostly orchestrating existing git + MCP tools |
| **Risk** | Low | Read-heavy workflow; only commits with user approval |
| **Dependencies** | None | Works standalone; enhanced with MCP tools if available |
| **Testing** | Low | Manual testing across 2-3 workspace types sufficient |
| **Maintenance** | Low | Stable once written; rarely needs updates |

**Overall Complexity: Simple-Medium**

## Development Phases

### Phase 1 — Core Skill (Git + Commit)
**Estimate: 2-3 hours**

1. Create `.claude/skills/cleanup/SKILL.md` with full prompt
2. Implement git status check (branch, modified, untracked, remote tracking)
3. Implement change review (diff summary, dangerous file detection)
4. Implement commit preparation (stage, draft message, present for approval)
5. Test on 3 different workspace types (Python, Node.js, monorepo)

### Phase 2 — Context & Changelog Updates
**Estimate: 2-3 hours**

1. Add context.md staleness detection (compare file mtime vs recent commits)
2. Add backlog task matching (fuzzy match commit message → backlog items)
3. Add changelog entry prompting (detect if changelog updated in this session)
4. Integrate MCP tools (backlog-manager, changelog-writer) with graceful fallback
5. Add post-commit summary with push/PR suggestions

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Core skill | 2-3h | None |
| Phase 2 — Context + changelog | 2-3h | Phase 1 |
| **Total** | **4-6h** | |

## Example Session

```
> /cleanup

Checking worktree for strokmatic.visionking.services.database-writer...

## Git Status
- Branch: feat/aio-pika
- Remote: origin/feat/aio-pika (2 commits ahead)
- Modified (unstaged):
    M src/consumer.py
    M src/writer.py
- Untracked:
    ?? tests/test_consumer.py
    ?? tests/test_writer.py

## Change Review
- 2 modified files (+87 -23 lines)
- 2 new test files (+142 lines)
- No dangerous files detected

## Context Updates
- backlog.md: Task "TEST-01: Add automated test suites" matches this work
  → Mark as in-progress? [y/n]
- Changelog: No entry for today
  → Add "Added: Unit tests for consumer and writer modules"? [y/n]

## Checks
- ruff check: PASSED (0 errors)
- pytest: PASSED (8 tests, 0 failures)

## Ready to Commit
Staged files:
  M src/consumer.py
  M src/writer.py
  A tests/test_consumer.py
  A tests/test_writer.py

Proposed commit message:
  "feat: add unit tests for consumer and writer modules"

Proceed with commit? [y/n]
```

## References

- Existing skills: `.claude/skills/` (25 skills, follow same SKILL.md pattern)
- MCP tools: backlog-manager, changelog-writer, workspace-analyzer
- Git conventions: CLAUDE.md commit guidelines (Co-Authored-By, no --amend, heredoc messages)
