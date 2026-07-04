#!/bin/bash
# RETIRED 2026-07-04 — the legacy vk-health monitor was replaced by the unified
# config-driven health monitor. Use:
#   scripts/health/health.sh vk <deployment> run      (e.g. 03002, bench)
# Keepers were relocated to scripts/health/extras/ (gpu-watchdog, monitoring deploy).
echo "RETIRED: use scripts/health/health.sh vk <deployment> run  (see scripts/health/)" >&2
exit 1
