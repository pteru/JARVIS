#!/usr/bin/env bash
# Central configuration for all JARVIS scripts
# Source this file instead of defining ORCHESTRATOR_HOME locally.
# Usage: source "$(dirname "$0")/lib/config.sh"  (from scripts/)
#    or: source "$(dirname "$0")/../lib/config.sh" (from scripts/helpers/)

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"

# Config paths
WORKSPACES_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/workspaces.json"
MODELS_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/models.json"
DISPATCHES_LOG="${ORCHESTRATOR_HOME}/logs/dispatches.json"
BACKLOG_DIR="${ORCHESTRATOR_HOME}/backlogs/products"
CHANGELOG_DIR="${ORCHESTRATOR_HOME}/changelogs"
NOTIFICATIONS_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/notifications.json"
TELEGRAM_BOTS_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/telegram-bots.json"
