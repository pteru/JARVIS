#!/bin/bash
# VK Health Monitor — Telegram notification helper
# Sourced by other scripts. Requires ORCHESTRATOR_HOME to be set (via config.sh).

set -euo pipefail

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
NOTIFICATIONS_CONFIG="${ORCHESTRATOR_HOME}/config/orchestrator/notifications.json"

# Source the router if available
_VK_ROUTER_AVAILABLE=false
_ROUTER_PATH="${ORCHESTRATOR_HOME}/scripts/lib/telegram-router.sh"
if [[ -f "$_ROUTER_PATH" ]]; then
    # shellcheck source=../lib/telegram-router.sh
    source "$_ROUTER_PATH"
    _VK_ROUTER_AVAILABLE=true
fi

# ---------------------------------------------------------------------------
# send_telegram <message> [domain]
# Sends a plain text message via Telegram Bot API.
# When the router is available and bot_manager_enabled, delegates to
# send_telegram_routed with the given domain (default: "vk-health").
# Otherwise falls back to legacy inline resolution.
# Truncates message to 4000 chars. Returns the HTTP status code.
# ---------------------------------------------------------------------------
send_telegram() {
    local message="$1"
    local domain="${2:-vk-health}"

    # Try router first
    if [[ "$_VK_ROUTER_AVAILABLE" == "true" ]]; then
        send_telegram_routed "$domain" "$message"
        return $?
    fi

    # Legacy fallback: inline resolution from notifications.json
    if [[ ! -f "$NOTIFICATIONS_CONFIG" ]]; then
        echo "ERROR: Notifications config not found: $NOTIFICATIONS_CONFIG" >&2
        return 1
    fi

    local bot_token chat_id bot_token_file
    bot_token=$(jq -r '.backends.telegram.bot_token // empty' "$NOTIFICATIONS_CONFIG")
    if [[ -z "$bot_token" ]]; then
        bot_token_file=$(jq -r '.backends.telegram.bot_token_file // empty' "$NOTIFICATIONS_CONFIG")
        bot_token_file="${bot_token_file/#\~/$HOME}"
        [[ -f "$bot_token_file" ]] && bot_token=$(<"$bot_token_file")
    fi
    chat_id=$(jq -r '.backends.telegram.chat_id' "$NOTIFICATIONS_CONFIG")

    if [[ -z "$bot_token" || -z "$chat_id" || "$bot_token" == "null" || "$chat_id" == "null" ]]; then
        echo "ERROR: Could not read Telegram config from $NOTIFICATIONS_CONFIG" >&2
        return 1
    fi

    # Truncate to 4000 chars (Telegram limit is 4096)
    message="${message:0:4000}"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg chat_id "$chat_id" --arg text "$message" \
            '{chat_id: $chat_id, text: $text}')")

    echo "$http_code"
}

# ---------------------------------------------------------------------------
# send_telegram_alert <severity> <title> <details>
# Formats an alert with severity indicator and sends via Telegram.
# Severity: CRITICAL, WARNING, or HEALTHY.
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

    local deployment_name=""
    if [[ -n "${CONFIG_FILE:-}" && -f "${CONFIG_FILE:-}" ]]; then
        deployment_name=$(jq -r '.name // empty' "$CONFIG_FILE")
    fi

    local message="${emoji} ${severity}: ${title}"
    if [[ -n "$deployment_name" ]]; then
        message="${message}
Deployment: ${deployment_name}"
    fi
    message="${message}

${details}

$(date '+%Y-%m-%d %H:%M:%S %Z')"

    send_telegram "$message"
}
