# Claude Orchestrator - Troubleshooting

## MCP Server Issues

### "Cannot find module @modelcontextprotocol/sdk"
Dependencies not installed. Run:
```bash
cd ~/.claude/mcp_servers/<server-name>
npm install
```
Or re-run `bash setup/install.sh`.

### MCP server not appearing in Claude Code
Check `~/.claude/config.json` has the server entry. Restart Claude Code after config changes.

### "ORCHESTRATOR_HOME is not set"
Add to your shell profile:
```bash
export ORCHESTRATOR_HOME="$HOME/claude-orchestrator"
```
Then `source ~/.zshrc` (or `.bashrc`).

## Script Issues

### "Permission denied" when running scripts
```bash
chmod +x ~/claude-orchestrator/scripts/*.sh
```

### "workspaces.json not found"
Copy from example:
```bash
cp ~/claude-orchestrator/config/workspaces.json.example ~/claude-orchestrator/config/workspaces.json
```

### "Workspace not found"
Check that the workspace name matches exactly in `workspaces.json` and the path exists.

## Cron Issues

### Cron jobs not running
1. Check cron is installed: `crontab -l`
2. Verify ORCHESTRATOR_HOME is set in cron entries
3. Check logs: `cat ~/claude-orchestrator/logs/cron-daily.log`

### Claude Code not found in cron
Cron has a minimal PATH. Ensure the cron entry includes the full path to `claude` or add PATH at the top of the crontab.

## Verification Failures

Run `co-verify` and address each error:
- **Missing directories**: Re-run `bash setup/install.sh`
- **Invalid JSON**: Check syntax in the reported config file
- **MCP server not installed**: Check `~/.claude/mcp_servers/` directory

## Common Errors

### "No pending tasks for workspace"
The workspace backlog has no unchecked (`- [ ]`) tasks. Add tasks via the backlog-manager MCP tool or edit the backlog file directly.

### Task dispatch fails
1. Check workspace path exists
2. Verify Claude Code CLI works: `claude --version`
3. Check model name is valid in `models.json`
