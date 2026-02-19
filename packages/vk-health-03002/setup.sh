#!/bin/bash
# VK Health Monitor — Interactive first-run setup
# Creates secrets, configures notifications, and verifies prerequisites.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/secrets"
NOTIFICATIONS_FILE="$SCRIPT_DIR/config/orchestrator/notifications.json"

echo "========================================="
echo "  VK Health Monitor — Setup"
echo "  Deployment: 03002"
echo "========================================="
echo ""

# ---------------------------------------------------------------------------
# Step 1: Check prerequisites
# ---------------------------------------------------------------------------
echo "Checking prerequisites..."

MISSING=()
for cmd in sshpass jq python3 curl; do
    if ! command -v "$cmd" &>/dev/null; then
        MISSING+=("$cmd")
    fi
done

if ! command -v claude &>/dev/null; then
    echo "  WARNING: 'claude' (Claude Code CLI) not found."
    echo "  The analyze.sh step requires Claude Code for AI analysis."
    echo "  Install from: https://claude.ai/download"
    echo ""
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "  ERROR: Missing required tools: ${MISSING[*]}"
    echo "  Install them with: sudo apt install ${MISSING[*]}"
    exit 1
fi

echo "  All required tools found."
echo ""

# ---------------------------------------------------------------------------
# Step 2: Create secrets directory
# ---------------------------------------------------------------------------
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# ---------------------------------------------------------------------------
# Step 3: VK SSH password
# ---------------------------------------------------------------------------
if [[ -f "$SECRETS_DIR/vk-ssh-password" ]]; then
    echo "SSH password already configured (secrets/vk-ssh-password exists)."
    read -rp "Overwrite? [y/N] " overwrite_ssh
    if [[ "${overwrite_ssh,,}" != "y" ]]; then
        echo "  Keeping existing SSH password."
    else
        read -rsp "Enter VK SSH password: " ssh_pass
        echo ""
        echo "$ssh_pass" > "$SECRETS_DIR/vk-ssh-password"
        chmod 600 "$SECRETS_DIR/vk-ssh-password"
        echo "  SSH password saved."
    fi
else
    read -rsp "Enter VK SSH password: " ssh_pass
    echo ""
    echo "$ssh_pass" > "$SECRETS_DIR/vk-ssh-password"
    chmod 600 "$SECRETS_DIR/vk-ssh-password"
    echo "  SSH password saved."
fi
echo ""

# ---------------------------------------------------------------------------
# Step 4: RabbitMQ password
# ---------------------------------------------------------------------------
if [[ -f "$SECRETS_DIR/vk-rabbit-password" ]]; then
    echo "RabbitMQ password already configured (secrets/vk-rabbit-password exists)."
    read -rp "Overwrite? [y/N] " overwrite_rabbit
    if [[ "${overwrite_rabbit,,}" != "y" ]]; then
        echo "  Keeping existing RabbitMQ password."
    else
        read -rsp "Enter RabbitMQ password: " rabbit_pass
        echo ""
        echo "$rabbit_pass" > "$SECRETS_DIR/vk-rabbit-password"
        chmod 600 "$SECRETS_DIR/vk-rabbit-password"
        echo "  RabbitMQ password saved."
    fi
else
    read -rsp "Enter RabbitMQ password: " rabbit_pass
    echo ""
    echo "$rabbit_pass" > "$SECRETS_DIR/vk-rabbit-password"
    chmod 600 "$SECRETS_DIR/vk-rabbit-password"
    echo "  RabbitMQ password saved."
fi
echo ""

# ---------------------------------------------------------------------------
# Step 5: Telegram notifications (optional)
# ---------------------------------------------------------------------------
echo "Telegram notifications (optional — press Enter to skip):"
read -rp "  Telegram bot token: " bot_token
read -rp "  Telegram chat ID: " chat_id

if [[ -n "$bot_token" && -n "$chat_id" ]]; then
    # Update notifications.json with real values
    tmp=$(mktemp)
    jq --arg bt "$bot_token" --arg ci "$chat_id" \
        '.backends.telegram.bot_token = $bt | .backends.telegram.chat_id = $ci' \
        "$NOTIFICATIONS_FILE" > "$tmp" && mv "$tmp" "$NOTIFICATIONS_FILE"
    echo "  Telegram notifications configured."
else
    echo "  Skipped Telegram setup. Edit config/orchestrator/notifications.json manually later."
fi
echo ""

# ---------------------------------------------------------------------------
# Step 6: Test SSH connectivity
# ---------------------------------------------------------------------------
echo "Testing SSH connectivity to vk01 (10.244.70.26:8050)..."
export VK_SSH_PASSWORD
VK_SSH_PASSWORD=$(cat "$SECRETS_DIR/vk-ssh-password")
export SSHPASS="$VK_SSH_PASSWORD"

if sshpass -e ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -p 8050 vk01@10.244.70.26 "echo ok" &>/dev/null; then
    echo "  SSH connection to vk01 successful."
else
    echo "  WARNING: Could not connect to vk01. Make sure you're on the VPN."
    echo "  The monitor will fail until SSH connectivity is available."
fi
echo ""

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo "========================================="
echo "  Setup complete!"
echo ""
echo "  To run the full health check pipeline:"
echo "    export VK_SSH_PASSWORD=\$(cat secrets/vk-ssh-password)"
echo "    export VK_RABBIT_PASSWORD=\$(cat secrets/vk-rabbit-password)"
echo "    ./scripts/vk-health/run.sh"
echo ""
echo "  Or collect data only:"
echo "    ./scripts/vk-health/collect.sh 03002"
echo "========================================="
