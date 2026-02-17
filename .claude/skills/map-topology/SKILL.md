---
name: map-topology
description: Map running production topology from remote machines via SSH
argument-hint: "[output-dir]"
---

Map the running production topology from remote machines via SSH. This command helps collect Docker container data from production nodes and generate topology documentation.

Output directory (if provided): $ARGUMENTS

Steps:
1. Check if the mapping script exists at `/home/teruel/JARVIS/workspaces/strokmatic/visionking/scripts/map-production-topology.sh`
2. Ask the user for: node IPs/hostnames, SSH user, SSH port, output directory
3. Run the script or equivalent SSH commands to collect: system info (CPU, RAM, GPU, disk), docker container list with env vars, infrastructure service details
4. Save JSON output per node to the specified directory
5. Generate topology-summary.md, deployment.mmd (with dark-mode styling), and issues-and-improvements.md

If the script doesn't exist or needs modification, create/update it based on the pattern in the visionking workspace.
