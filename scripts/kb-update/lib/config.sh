#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../lib/config.sh"

KB_REPO_PATH="${ORCHESTRATOR_HOME}/workspaces/strokmatic/knowledge-base"
KB_REMOTE="origin"
KB_BRANCH="master"
KB_UPDATES_FILE="${KB_REPO_PATH}/kb-updates.json"
KB_PAGE_MAP="${ORCHESTRATOR_HOME}/config/orchestrator/kb-page-map.json"
KB_STALENESS="${ORCHESTRATOR_HOME}/config/orchestrator/kb-staleness.json"
KB_LOG="${ORCHESTRATOR_HOME}/logs/cron-kb-update.log"
