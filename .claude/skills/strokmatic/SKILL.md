---
name: strokmatic
description: Load Strokmatic company context for all products
---

Load the Strokmatic company context. Read and internalize the following files to understand the full product portfolio:

1. `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/.claude/context.md` — VisionKing: industrial visual inspection (steel + vehicle bodies)
2. `/home/teruel/claude-orchestrator/workspaces/strokmatic/spotfusion/.claude/context.md` — SpotFusion: weld spot detection and classification
3. `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/context.md` — DieMaster: IoT stamping equipment monitoring

After reading all three, provide a brief summary of what you've loaded and confirm you're ready to work across any Strokmatic product. Mention the key architectural differences between the three systems:
- **VisionKing**: Linear pipeline (cameras → inference → database), two deployment profiles (steel/body)
- **SpotFusion**: Fan-out pipeline (detection → N spots × M classifiers → aggregation)
- **DieMaster**: IoT pipeline (ESP32 firmware → cloud services), no RabbitMQ

Also read:
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/.claude/CLAUDE.md`
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/spotfusion/.claude/CLAUDE.md`
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/CLAUDE.md`
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/.claude/backlog.md`
- `/home/teruel/claude-orchestrator/workspaces/strokmatic/diemaster/.claude/backlog.md`
