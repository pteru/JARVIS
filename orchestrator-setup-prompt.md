# Claude Code Orchestrator Setup - Implementation Prompt

I've created a repository for a Claude Code orchestrator system that manages multiple development workspaces. The repository structure is already in place, but I need you to complete the implementation based on the following specifications:

## Project Overview

This is a centralized orchestration system for Claude Code that:
- Manages tasks across multiple development workspaces/repositories
- Automates periodic task execution with intelligent model selection
- Tracks backlogs, changelogs, and generates reports
- Uses MCP (Model Context Protocol) servers as "skills" to enhance Claude Code capabilities
- Maintains both central (orchestrator) and workspace-local CLAUDE.md files for context

## Repository Structure Already Created

```
claude-orchestrator/
├── config/
│   ├── claude/
│   │   ├── config.json              # MCP server registrations
│   │   └── settings.json
│   ├── orchestrator/
│   │   ├── workspaces.json.example
│   │   ├── models.json              # Model selection rules
│   │   └── schedules.json
│   └── cron/
│       └── orchestrator.cron
├── mcp-servers/                     # MCP skills (some implemented, some need completion)
│   ├── backlog-manager/
│   ├── changelog-writer/
│   ├── workspace-analyzer/
│   ├── task-dispatcher/
│   └── report-generator/
├── scripts/
│   ├── orchestrator.sh              # Main automation script
│   ├── task-dispatcher.sh           # Routes tasks to workspaces
│   ├── model-selector.sh            # Chooses appropriate model
│   ├── init-workspace.sh            # Initialize new workspaces
│   └── verify-setup.sh              # Verify setup
├── setup/
│   ├── install.sh                   # Main installer
│   ├── uninstall.sh
│   └── update.sh
├── prompts/templates/
├── backlogs/
├── changelogs/
├── reports/
├── logs/
├── CLAUDE.md                        # Master guidelines
└── docs/
```

## What Needs Implementation

### 1. Complete MCP Servers

**Already implemented:**
- `backlog-manager/` - Fully functional
- `workspace-analyzer/` - Fully functional
- `report-generator/` - Fully functional

**Need implementation:**
- `changelog-writer/` - MCP server for automated changelog management
- `task-dispatcher/` - MCP server to intelligently dispatch tasks to workspaces

For each MCP server to implement, create:
- `package.json` with dependencies on `@modelcontextprotocol/sdk`
- `index.js` with proper MCP server implementation
- `README.md` documenting the tools available

### 2. Configuration Files

**config/orchestrator/workspaces.json.example:**
Template showing how to configure workspaces:
```json
{
  "workspaces": {
    "api-backend": {
      "path": "/Users/you/projects/api-backend",
      "type": "nodejs",
      "priority": "high",
      "auto_review": true
    },
    "frontend-app": {
      "path": "/Users/you/projects/frontend-app",
      "type": "react",
      "priority": "medium",
      "auto_review": false
    }
  }
}
```

**config/orchestrator/models.json:**
Rules for model selection based on task complexity:
- Simple tasks (docs, typos, logging) → claude-haiku-4-5-20251001
- Medium tasks (features, refactoring, tests) → claude-sonnet-4-5-20250929
- Complex tasks (architecture, multi-file changes) → claude-opus-4-5-20251101

**config/orchestrator/schedules.json:**
Define when automated tasks run (daily, weekly, etc.)

**config/cron/orchestrator.cron:**
Cron configuration for periodic task execution

### 3. Shell Scripts

**scripts/orchestrator.sh:**
Main orchestrator that:
- Reads workspaces.json
- Processes backlogs
- Dispatches tasks
- Handles daily/weekly/manual modes

**scripts/task-dispatcher.sh:**
- Accepts workspace name, task description, and optional complexity
- Selects appropriate model using model-selector.sh
- Changes to workspace directory
- Executes Claude Code with proper context including:
  - Master CLAUDE.md guidelines
  - Workspace-specific CLAUDE.md (if exists)
  - Backlog reference
  - Changelog update requirements (both central and workspace)
- Logs execution
- Updates central changelog on completion

**scripts/model-selector.sh:**
- Accepts task description and optional complexity override
- Returns appropriate model string based on:
  - Explicit complexity parameter
  - Keyword analysis (architecture, docs, etc.)
  - Heuristics from models.json

**scripts/init-workspace.sh:**
Initializes a new workspace by:
- Creating team CLAUDE.md in workspace root (if doesn't exist)
- Creating personal .claude/CLAUDE.md with orchestrator context
- Adding .claude/ to .gitignore
- Creating workspace CHANGELOG.md
- Creating central backlog file
- Adding workspace to workspaces.json (optionally)

**scripts/verify-setup.sh:**
Verifies the installation by checking:
- Master CLAUDE.md exists
- Each workspace has proper CLAUDE.md files
- Backlogs exist
- MCP servers are installed
- Claude Code config is valid

### 4. Documentation Files

**docs/SKILLS.md:**
Complete documentation of all MCP skills and their tools

**docs/SETUP.md:**
Detailed setup instructions

**docs/TROUBLESHOOTING.md:**
Common issues and solutions

### 5. CLAUDE.md Files

**Master CLAUDE.md (repository root):**
Global rules for all automation including:
- General coding principles
- Changelog format requirements (dual system: central + workspace)
- Task completion checklist
- Backlog management conventions
- Error handling guidelines

**Template for workspace .claude/CLAUDE.md:**
Orchestrator-specific context including:
- Links to central backlog and changelog
- Automation configuration
- Task completion requirements
- Reference to master guidelines

### 6. Setup Scripts

**setup/install.sh:**
Already implemented - installs everything to ~/claude-orchestrator and ~/.claude/

**setup/uninstall.sh:**
Needs implementation to:
- Remove orchestrator directory (with confirmation)
- Remove MCP servers from ~/.claude/
- Remove cron jobs
- Remove shell aliases

**setup/update.sh:**
Already implemented - updates from repository

## Key Design Decisions

### CLAUDE.md Hierarchy
1. **Root CLAUDE.md** in workspace - Team guidelines (committed to git)
2. **.claude/CLAUDE.md** in workspace - Personal/orchestrator context (gitignored)
3. **Master CLAUDE.md** in orchestrator - Global automation rules

All are automatically loaded by Claude Code and work together.

### Dual Changelog System
- **Workspace CHANGELOG.md** - User-facing, Keep a Changelog format, committed to git
- **Central changelog** - Internal tracking, detailed logs, in orchestrator directory

### Model Selection Strategy
Optimize token usage by selecting the right model for each task based on complexity.

### Backlog Format
Markdown with priority sections, tasks marked with `- [ ]` and `[COMPLEXITY]` tags:
```markdown
## High Priority
- [ ] [COMPLEX] Implement rate limiting middleware
- [ ] [MEDIUM] Add request validation

## Medium Priority
- [ ] [SIMPLE] Update API documentation
```

## Implementation Instructions

Please implement all missing components following these guidelines:

1. **For MCP servers:**
   - Use @modelcontextprotocol/sdk
   - Follow the pattern from backlog-manager
   - Each tool should have clear input schemas
   - Handle errors gracefully
   - Use ORCHESTRATOR_HOME environment variable

2. **For shell scripts:**
   - Use bash with `set -e` for error handling
   - Source helper scripts where appropriate
   - Provide clear logging output
   - Handle edge cases (missing files, etc.)

3. **For configuration files:**
   - Use clear, commented JSON
   - Provide sensible defaults
   - Include examples

4. **Code style:**
   - Clear, well-commented code
   - Error handling on all file operations
   - Consistent formatting
   - Helpful error messages

## Expected Workflow After Implementation

1. User runs `./setup/install.sh` to install orchestrator
2. User edits `~/claude-orchestrator/config/workspaces.json` with their projects
3. User runs `co-init workspace-name /path/to/workspace` to initialize workspaces
4. Daily cron job runs `orchestrator.sh daily` which:
   - Reads backlogs
   - Selects top priority tasks
   - Dispatches to appropriate workspaces with optimal model
   - Updates both changelogs
   - Marks tasks complete

5. Claude Code in each workspace automatically sees:
   - Team guidelines from workspace CLAUDE.md
   - Orchestrator context from .claude/CLAUDE.md
   - Master guidelines (referenced in prompts)

6. User can also manually dispatch tasks:
   ```bash
   co-daily  # Run daily automation
   co-weekly # Generate weekly report
   orchestrator.sh manual workspace-name "task description" complex
   ```

## Files to Focus On

Priority order for implementation:
1. Complete missing MCP servers (changelog-writer, task-dispatcher)
2. Implement all shell scripts (orchestrator.sh, task-dispatcher.sh, etc.)
3. Create all configuration files with examples
4. Write documentation files
5. Implement uninstall.sh

Please implement these components and ensure they work together as a cohesive system. The goal is a fully functional orchestrator that can manage multiple development workspaces with automated task execution and intelligent model selection.
