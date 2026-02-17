---
name: vk-deploy-review
description: Analyze a VisionKing production deployment folder
argument-hint: "<deployment-folder>"
---

Analyze a VisionKing production deployment. The deployment folder path is: $ARGUMENTS

Read all JSON files in the folder to understand the per-node container topology. Then:

1. Generate or update `topology-summary.md` with an overview table (nodes, IPs, CPU, RAM, GPU, disk, container count) and per-node service tables
2. Generate or update `deployment.mmd` — a Mermaid diagram showing all nodes, their internal services, and cross-node connections. Use the dark-mode styling from `/home/teruel/JARVIS/workspaces/strokmatic/visionking/deployments/03002/deployment.mmd` as reference.
3. Render the mermaid to PNG using mmdc
4. Generate or update `issues-and-improvements.md` — list operational issues (disk, uptime, failing containers), configuration issues (port inconsistencies, missing services), and architectural improvements

Compare against the reference architecture in `architecture/pipeline.mmd` to identify discrepancies.
