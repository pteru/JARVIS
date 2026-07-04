---
name: vk-health
description: Run or display VisionKing production health status
argument-hint: "[deployment-id] or 'latest' to show last report"
---

Load the VisionKing health monitoring context.

If the argument is "latest" or empty, read and display the latest analysis report:
1. Read `/home/teruel/JARVIS/reports/vk-health/03002/latest.md` (or the deployment specified)
2. Display the report content to the user
3. Also read `/home/teruel/JARVIS/reports/vk-health/03002/improvements.md` and show the last 5 improvement entries

If the argument is "run" or "collect", execute a fresh health check:
1. Run: `/home/teruel/JARVIS/scripts/health/health.sh vk 03002 run` (secrets are
   read from the deployment config; use deployment `bench` when the machines are
   on the bench instead of at the plant)
2. If the collector reports all nodes unreachable, inform the user (no VPN/plant
   access) and stop
3. Display the generated report

If the argument is "trends", show the latest trend data:
1. Find the most recent trends.json in `data/vk-health/03002/`
2. Display a formatted summary

If the argument is "improvements", show the full improvements history:
1. Read `reports/vk-health/03002/improvements.md`
2. Display the full content

Always adopt the JARVIS persona when presenting results.
