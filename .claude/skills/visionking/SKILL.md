---
name: visionking
description: Load VisionKing product context into the session
---

Load the VisionKing product context. Read and internalize the following files:

1. `/home/teruel/JARVIS/workspaces/strokmatic/visionking/.claude/context.md` — Full pipeline architecture, queue topology, Redis keyspace, production reference
2. `/home/teruel/JARVIS/workspaces/strokmatic/visionking/.claude/CLAUDE.md` — Project conventions, repo structure, deployment profiles, topology tools
3. `/home/teruel/JARVIS/workspaces/strokmatic/visionking/.claude/backlog.md` — Current task backlog with priorities

After reading, provide a brief summary confirming what you've loaded:
- Pipeline flow (cameras → Redis → image-saver → inference → database writers → result)
- Two deployment profiles (Laminacao/steel, Carrocerias/body)
- Key services and their roles
- Current backlog priorities
- Production deployment reference (03002: 3 nodes, 8 cameras)

Confirm you're ready to work on VisionKing tasks.
