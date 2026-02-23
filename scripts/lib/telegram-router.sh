#!/usr/bin/env bash
# Telegram Bot Manager — Shared routing library
# Resolves bot token + chat_id based on notification domain.
# When bot_manager_enabled=false or telegram-bots.json is missing,
# falls back transparently to the legacy single-bot config.
#
# Usage:
#   source "$(dirname "$0")/lib/telegram-router.sh"   # from scripts/
#   resolve_telegram_route "vk-health"
#   # Now use $RESOLVED_BOT_TOKEN and $RESOLVED_CHAT_ID
#
#   # Or use the convenience wrapper:
#   send_telegram_routed "vk-health" "Alert message"

# Requires ORCHESTRATOR_HOME (set via config.sh or caller).
ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"

# Config paths (may already be set via config.sh)
: "${NOTIFICATIONS_CONFIG:=${ORCHESTRATOR_HOME}/config/orchestrator/notifications.json}"
: "${TELEGRAM_BOTS_CONFIG:=${ORCHESTRATOR_HOME}/config/orchestrator/telegram-bots.json}"

# Resolved values — set by resolve_telegram_route
RESOLVED_BOT_TOKEN=""
RESOLVED_CHAT_ID=""

# ---------------------------------------------------------------------------
# _is_bot_manager_enabled
# Returns 0 (true) if bot_manager_enabled is true in notifications.json
# ---------------------------------------------------------------------------
_is_bot_manager_enabled() {
    if [[ ! -f "$NOTIFICATIONS_CONFIG" ]]; then
        return 1
    fi
    local enabled
    enabled=$(jq -r '.bot_manager_enabled // false' "$NOTIFICATIONS_CONFIG" 2>/dev/null)
    [[ "$enabled" == "true" ]]
}

# ---------------------------------------------------------------------------
# _resolve_legacy_token
# Reads bot_token and chat_id from notifications.json (current behavior).
# Sets RESOLVED_BOT_TOKEN and RESOLVED_CHAT_ID.
# ---------------------------------------------------------------------------
_resolve_legacy_token() {
    if [[ ! -f "$NOTIFICATIONS_CONFIG" ]]; then
        echo "ERROR: Notifications config not found: $NOTIFICATIONS_CONFIG" >&2
        return 1
    fi

    local bot_token chat_id bot_token_file

    bot_token=$(jq -r '.backends.telegram.bot_token // empty' "$NOTIFICATIONS_CONFIG")
    if [[ -z "$bot_token" ]]; then
        bot_token_file=$(jq -r '.backends.telegram.bot_token_file // empty' "$NOTIFICATIONS_CONFIG")
        bot_token_file="${bot_token_file/#\~/$HOME}"
        if [[ -f "$bot_token_file" ]]; then
            bot_token=$(<"$bot_token_file")
        fi
    fi

    chat_id=$(jq -r '.backends.telegram.chat_id' "$NOTIFICATIONS_CONFIG")

    if [[ -z "$bot_token" || -z "$chat_id" || "$bot_token" == "null" || "$chat_id" == "null" ]]; then
        echo "ERROR: Could not read Telegram config from $NOTIFICATIONS_CONFIG" >&2
        return 1
    fi

    RESOLVED_BOT_TOKEN="$bot_token"
    RESOLVED_CHAT_ID="$chat_id"
}

# ---------------------------------------------------------------------------
# resolve_telegram_route <domain>
# Resolves bot token + chat_id for the given domain.
# When bot_manager_enabled and telegram-bots.json exists, looks up the domain
# in the registry. Otherwise falls back to legacy single-bot config.
# Sets: RESOLVED_BOT_TOKEN, RESOLVED_CHAT_ID
# ---------------------------------------------------------------------------
resolve_telegram_route() {
    local domain="${1:-}"

    # Reset
    RESOLVED_BOT_TOKEN=""
    RESOLVED_CHAT_ID=""

    # If bot manager is not enabled or config is missing, use legacy
    if ! _is_bot_manager_enabled || [[ ! -f "$TELEGRAM_BOTS_CONFIG" ]]; then
        _resolve_legacy_token
        return $?
    fi

    # Look up the domain in telegram-bots.json
    local bot_name
    bot_name=$(jq -r --arg d "$domain" '.domains[$d].bot // empty' "$TELEGRAM_BOTS_CONFIG" 2>/dev/null)

    # Fall back to default_bot if domain not found
    if [[ -z "$bot_name" ]]; then
        bot_name=$(jq -r '.default_bot // empty' "$TELEGRAM_BOTS_CONFIG" 2>/dev/null)
    fi

    if [[ -z "$bot_name" ]]; then
        echo "WARNING: No bot found for domain '$domain', falling back to legacy" >&2
        _resolve_legacy_token
        return $?
    fi

    # Resolve bot token from file
    local token_file chat_id
    token_file=$(jq -r --arg b "$bot_name" '.bots[$b].bot_token_file // empty' "$TELEGRAM_BOTS_CONFIG" 2>/dev/null)
    token_file="${token_file/#\~/$HOME}"

    if [[ -z "$token_file" || ! -f "$token_file" ]]; then
        echo "WARNING: Token file not found for bot '$bot_name' ($token_file), falling back to legacy" >&2
        _resolve_legacy_token
        return $?
    fi

    local bot_token
    bot_token=$(<"$token_file")

    # Chat ID: domain-level override > bot default_chat_id
    chat_id=$(jq -r --arg d "$domain" '.domains[$d].chat_id // empty' "$TELEGRAM_BOTS_CONFIG" 2>/dev/null)
    if [[ -z "$chat_id" ]]; then
        chat_id=$(jq -r --arg b "$bot_name" '.bots[$b].default_chat_id // empty' "$TELEGRAM_BOTS_CONFIG" 2>/dev/null)
    fi

    if [[ -z "$bot_token" || -z "$chat_id" ]]; then
        echo "WARNING: Incomplete config for bot '$bot_name', falling back to legacy" >&2
        _resolve_legacy_token
        return $?
    fi

    RESOLVED_BOT_TOKEN="$bot_token"
    RESOLVED_CHAT_ID="$chat_id"
}

# ---------------------------------------------------------------------------
# send_telegram_routed <domain> <message>
# Resolves the route for the given domain and sends the message.
# Returns the HTTP status code.
# ---------------------------------------------------------------------------
send_telegram_routed() {
    local domain="$1"
    local message="$2"

    resolve_telegram_route "$domain" || return 1

    # Truncate to 4000 chars (Telegram limit is 4096)
    message="${message:0:4000}"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "https://api.telegram.org/bot${RESOLVED_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg chat_id "$RESOLVED_CHAT_ID" --arg text "$message" \
            '{chat_id: $chat_id, text: $text}')")

    echo "$http_code"
}
