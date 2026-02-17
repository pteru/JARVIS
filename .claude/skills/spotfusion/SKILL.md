---
name: spotfusion
description: Load SpotFusion product context into the session
---

Load the SpotFusion product context. Read and internalize the following files:

1. `/home/teruel/JARVIS/workspaces/strokmatic/spotfusion/.claude/context.md` — Fan-out architecture, tech stack, repo structure
2. `/home/teruel/JARVIS/workspaces/strokmatic/spotfusion/.claude/CLAUDE.md` — Project conventions, key patterns

Also explore the architecture directory for any diagrams or documentation:
- `/home/teruel/JARVIS/workspaces/strokmatic/spotfusion/architecture/`

After reading, provide a brief summary confirming what you've loaded:
- Fan-out pipeline (smart cameras → detection → N spots × M classifiers → aggregation)
- 26+ microservices
- Key architectural difference from VisionKing (fan-out vs linear)
- Shared tooling patterns (topology-configurator, deployment-runner)

Confirm you're ready to work on SpotFusion tasks.
