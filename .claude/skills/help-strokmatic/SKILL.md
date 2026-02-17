---
name: help-strokmatic
description: List all available Strokmatic slash commands
---

List the available Strokmatic slash commands and explain what each one does. Do NOT execute any of them — just print the documentation below as-is.

---

# Strokmatic Slash Commands

## Context Loaders

Use these at the start of a session to load product-specific knowledge.

### `/strokmatic`
Loads context for **all three products** (VisionKing, SpotFusion, DieMaster). Reads CLAUDE.md, context.md, and backlogs for each. Use this when working across products or when unsure which product you'll need.

### `/visionking`
Loads **VisionKing** context: pipeline architecture, queue topology, Redis keyspace, deployment profiles (Laminacao/Carrocerias), production reference, and current backlog.

### `/spotfusion`
Loads **SpotFusion** context: fan-out pipeline architecture, 26 services, shared tooling patterns.

### `/diemaster`
Loads **DieMaster** context: IoT architecture, ESP32 firmware, known security issues, and current backlog.

## VisionKing Tools

### `/vk-pipeline`
Explains the VisionKing pipeline architecture by reading `architecture/pipeline.mmd` and `architecture/pipeline.md`. Describes the full data flow from cameras through inference to database, including the two routing paths (with and without 3D projection via pixel-to-object), queue names, and Redis keyspace.

### `/vk-deploy-review <deployment-folder>`
Analyzes a production deployment folder (e.g., `deployments/03002/`). Reads per-node JSON files and generates:
- `topology-summary.md` — overview table + per-node service tables
- `deployment.mmd` + `deployment.png` — Mermaid diagram with dark-mode styling
- `issues-and-improvements.md` — operational, configuration, and architectural issues

Example: `/vk-deploy-review deployments/03002/`

### `/vk-service-info <service-name>`
Looks up a specific VisionKing service across Dockerfile, docker-compose.yml, .env.example, architecture docs, and context files. Returns: purpose, inputs/outputs, env vars, resource limits, and known issues.

Example: `/vk-service-info inference`

## SpotFusion Tools

### `/sf-pipeline`
Explains the SpotFusion pipeline architecture — smart cameras, detection, fan-out (N spots × M classifiers), aggregation, and database writing.

## Cross-Project Tools

### `/map-topology [output-dir]`
Maps running production topology from remote machines via SSH. Collects Docker container data, system info (CPU, RAM, GPU, disk), and generates topology summary, Mermaid diagram, and issues report.

### `/help-strokmatic`
Shows this documentation.
