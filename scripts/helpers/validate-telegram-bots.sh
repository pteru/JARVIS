#!/usr/bin/env bash
# Validate telegram-bots.json configuration
# Checks: JSON parsing, token file existence, domain→bot references, default_bot.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/config.sh"

ERRORS=0
WARNINGS=0

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  ✗ $1"; ERRORS=$((ERRORS + 1)); }

echo "=== Telegram Bot Manager — Config Validation ==="
echo ""

# --- Check telegram-bots.json exists and parses ---
echo "[1] Config file"
if [[ ! -f "$TELEGRAM_BOTS_CONFIG" ]]; then
    fail "telegram-bots.json not found at $TELEGRAM_BOTS_CONFIG"
    echo ""
    echo "Result: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
fi

if ! jq empty "$TELEGRAM_BOTS_CONFIG" 2>/dev/null; then
    fail "telegram-bots.json is not valid JSON"
    echo ""
    echo "Result: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
fi
ok "telegram-bots.json parses correctly"

# --- Check default_bot exists in bots ---
echo ""
echo "[2] Default bot"
DEFAULT_BOT=$(jq -r '.default_bot // empty' "$TELEGRAM_BOTS_CONFIG")
if [[ -z "$DEFAULT_BOT" ]]; then
    fail "No default_bot defined"
else
    BOT_EXISTS=$(jq -r --arg b "$DEFAULT_BOT" '.bots[$b] // empty' "$TELEGRAM_BOTS_CONFIG")
    if [[ -z "$BOT_EXISTS" ]]; then
        fail "default_bot '$DEFAULT_BOT' not found in bots"
    else
        ok "default_bot '$DEFAULT_BOT' exists in bots"
    fi
fi

# --- Check each bot's token file ---
echo ""
echo "[3] Bot token files"
for bot_name in $(jq -r '.bots | keys[]' "$TELEGRAM_BOTS_CONFIG"); do
    TOKEN_FILE=$(jq -r --arg b "$bot_name" '.bots[$b].bot_token_file // empty' "$TELEGRAM_BOTS_CONFIG")
    TOKEN_FILE="${TOKEN_FILE/#\~/$HOME}"

    if [[ -z "$TOKEN_FILE" ]]; then
        fail "Bot '$bot_name': no bot_token_file defined"
    elif [[ ! -f "$TOKEN_FILE" ]]; then
        fail "Bot '$bot_name': token file not found: $TOKEN_FILE"
    elif [[ ! -r "$TOKEN_FILE" ]]; then
        fail "Bot '$bot_name': token file not readable: $TOKEN_FILE"
    else
        ok "Bot '$bot_name': token file exists and readable"
    fi

    CHAT_ID=$(jq -r --arg b "$bot_name" '.bots[$b].default_chat_id // empty' "$TELEGRAM_BOTS_CONFIG")
    if [[ -z "$CHAT_ID" ]]; then
        warn "Bot '$bot_name': no default_chat_id set"
    else
        ok "Bot '$bot_name': default_chat_id = $CHAT_ID"
    fi
done

# --- Check domain→bot references ---
echo ""
echo "[4] Domain routing"
for domain in $(jq -r '.domains | keys[]' "$TELEGRAM_BOTS_CONFIG"); do
    BOT_REF=$(jq -r --arg d "$domain" '.domains[$d].bot // empty' "$TELEGRAM_BOTS_CONFIG")
    if [[ -z "$BOT_REF" ]]; then
        fail "Domain '$domain': no bot reference"
    else
        BOT_EXISTS=$(jq -r --arg b "$BOT_REF" '.bots[$b] // empty' "$TELEGRAM_BOTS_CONFIG")
        if [[ -z "$BOT_EXISTS" ]]; then
            fail "Domain '$domain': references bot '$BOT_REF' which doesn't exist"
        else
            ok "Domain '$domain' → bot '$BOT_REF'"
        fi
    fi
done

# --- Check notifications.json toggle ---
echo ""
echo "[5] Toggle status"
if [[ -f "$NOTIFICATIONS_CONFIG" ]]; then
    if jq -e 'has("bot_manager_enabled")' "$NOTIFICATIONS_CONFIG" >/dev/null 2>&1; then
        TOGGLE=$(jq -r '.bot_manager_enabled' "$NOTIFICATIONS_CONFIG")
        if [[ "$TOGGLE" == "true" ]]; then
            ok "bot_manager_enabled = true (routing active)"
        else
            ok "bot_manager_enabled = false (legacy mode)"
        fi
    else
        warn "bot_manager_enabled not set in notifications.json"
    fi
else
    warn "notifications.json not found at $NOTIFICATIONS_CONFIG"
fi

# --- Summary ---
echo ""
echo "=== Result: $ERRORS error(s), $WARNINGS warning(s) ==="
[[ $ERRORS -eq 0 ]] && exit 0 || exit 1
