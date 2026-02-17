---
name: diemaster
description: Load DieMaster product context into the session
---

Load the DieMaster product context. Read and internalize the following files:

1. `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/context.md` — IoT architecture, firmware stack, known issues
2. `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/CLAUDE.md` — Project conventions, security warnings
3. `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/backlog.md` — Current task backlog with priorities

After reading, provide a brief summary confirming what you've loaded:
- IoT pipeline (ESP32 sensors → firmware → cloud → backend → dashboard)
- 14 services + firmware components
- Critical security issues (hardcoded credentials, eval(), GCP key in repo)
- Current backlog priorities

Confirm you're ready to work on DieMaster tasks.
