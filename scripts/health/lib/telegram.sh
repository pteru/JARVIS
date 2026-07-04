#!/bin/bash
# Health Monitor — unified Telegram notification helper
# Sourced by other scripts. Requires ORCHESTRATOR_HOME to be set (via config.sh).
# Deployment name is read from $HEALTH_NAME (exported by load_health_config).
#
# All sends delegate to scripts/lib/telegram-router.sh — the single bash-side
# Telegram sender (domain-based bot routing with legacy single-bot fallback).
# The router is resolved relative to THIS file so hermetic tests with a temp
# ORCHESTRATOR_HOME still find it; its notifications.json lookup honors
# ORCHESTRATOR_HOME, which is what tests fake.

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"

_ROUTER_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../lib" && pwd)/telegram-router.sh"
if [[ ! -f "$_ROUTER_PATH" ]]; then
    echo "ERROR: telegram-router.sh not found at $_ROUTER_PATH" >&2
    exit 1
fi
# shellcheck source=../../lib/telegram-router.sh
source "$_ROUTER_PATH"

# ---------------------------------------------------------------------------
# send_telegram <message> [domain]
# Sends a plain text message via the router (default domain: "health").
# Returns the HTTP status code on stdout.
# ---------------------------------------------------------------------------
send_telegram() {
    local message="$1"
    local domain="${2:-health}"
    send_telegram_routed "$domain" "$message"
}

# ---------------------------------------------------------------------------
# send_telegram_alert <severity> <title> <details>
# Formats an alert with severity indicator and sends via Telegram.
# Severity: CRITICAL, WARNING, HEALTHY, or any string (falls back to ⚪).
# Deployment name comes from $HEALTH_NAME (set by load_health_config).
# ---------------------------------------------------------------------------
send_telegram_alert() {
    local severity="$1"
    local title="$2"
    local details="$3"

    local emoji
    case "$severity" in
        CRITICAL) emoji="🔴" ;;
        WARNING)  emoji="🟡" ;;
        HEALTHY)  emoji="🟢" ;;
        *)        emoji="⚪" ;;
    esac

    local message="${emoji} ${severity}: ${title}"
    local _label
    _label="${HEALTH_NAME:-${HEALTH_PRODUCT:-health} ${HEALTH_DEPLOYMENT:-}}"
    _label="${_label% }"   # trim trailing space when HEALTH_DEPLOYMENT is unset
    message="${message}
Deployment: ${_label}"
    message="${message}

${details}

$(date '+%Y-%m-%d %H:%M:%S %Z')"

    send_telegram "$message"
}
