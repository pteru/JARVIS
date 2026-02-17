---
name: vk-service-info
description: Look up details about a specific VisionKing service
argument-hint: "<service-name>"
---

Look up details about the VisionKing service: $ARGUMENTS

Search the visionking workspace at `/home/teruel/claude-orchestrator/workspaces/strokmatic/visionking/` for information about the requested service.

Check these sources:
1. `services/<service-name>/` — README, Dockerfile, requirements, entry point
2. `docker-compose.yml` — ports, env vars, network mode, resource limits
3. `.env.example` — environment variable defaults
4. `architecture/service-map.md` — service role, inputs/outputs
5. `architecture/queue-topology.md` — queue connections
6. `.claude/context.md` — pipeline context

Return: service purpose, input/output (queues, Redis DBs, PostgreSQL), environment variables, resource limits, Docker image, and any known issues.
