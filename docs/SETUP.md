# Claude Orchestrator - Setup Guide

## Prerequisites
- Node.js (v18+)
- npm
- Claude Code CLI (`claude-code`)

## Installation

```bash
git clone <repo-url> ~/claude-orchestrator-repo
cd ~/claude-orchestrator-repo
bash setup/install.sh
```

The installer will:
1. Create the orchestrator directory structure at `~/claude-orchestrator`
2. Copy scripts, prompts, and configuration files
3. Install all 5 MCP servers with dependencies
4. Configure Claude Code (`~/.claude/config.json`)
5. Add shell aliases to your `.zshrc` or `.bashrc`
6. Optionally install cron jobs for daily/weekly automation

## Post-Installation

### 1. Reload your shell
```bash
source ~/.zshrc  # or ~/.bashrc
```

### 2. Configure workspaces
```bash
cp ~/claude-orchestrator/config/workspaces.json.example ~/claude-orchestrator/config/workspaces.json
vim ~/claude-orchestrator/config/workspaces.json
```

Edit the file to include your actual workspace paths and names.

### 3. Initialize workspaces
```bash
co-init my-project /path/to/my-project
```

This creates a CLAUDE.md, backlog, and changelog for the workspace.

### 4. Verify setup
```bash
co-verify
```

## Shell Aliases
| Alias | Command |
|-------|---------|
| `co-daily` | Run daily task processing |
| `co-weekly` | Run weekly summary |
| `co-verify` | Verify installation |
| `co-init` | Initialize a new workspace |
| `co-status` | List configured workspaces |

## Updating
```bash
cd ~/claude-orchestrator-repo
git pull
bash setup/update.sh
```

## Uninstalling
```bash
bash ~/claude-orchestrator-repo/setup/uninstall.sh
```
