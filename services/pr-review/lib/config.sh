#!/usr/bin/env bash
# Service-local configuration for the remote PR review service.
# All paths are relative to SERVICE_DIR (the deployment root).
# Usage: source "$SCRIPT_DIR/lib/config.sh"

SERVICE_DIR="${SERVICE_DIR:-/opt/jarvis-pr-review}"

# Data paths
DATA_DIR="$SERVICE_DIR/data"
REVIEWS_DIR="$SERVICE_DIR/reviews"
ARCHIVE_DIR="$SERVICE_DIR/reviews/archive"
REPORTS_DIR="$SERVICE_DIR/reports"
LOGS_DIR="$SERVICE_DIR/logs"

# Config paths
WORKSPACES_CONFIG="$SERVICE_DIR/config/workspaces.json"
MODELS_CONFIG="$SERVICE_DIR/config/models.json"
NOTIFICATIONS_CONFIG="$SERVICE_DIR/config/notifications.json"
TEAM_MEMBERS_CONFIG="$SERVICE_DIR/config/team-members.json"
CLAUDE_MD_DIR="$SERVICE_DIR/config/claude-md"
SERVICE_CONFIG="$SERVICE_DIR/config/service.json"
CREDENTIALS_DIR="$SERVICE_DIR/credentials"

# Data files
INBOX_FILE="$DATA_DIR/pr-inbox.json"
PREV_INBOX_FILE="$DATA_DIR/pr-inbox.prev.json"
STATE_FILE="$DATA_DIR/state.json"

# Constants
ORG="strokmatic"

# Ensure directories exist
mkdir -p "$DATA_DIR" "$REVIEWS_DIR" "$ARCHIVE_DIR" "$REPORTS_DIR" "$LOGS_DIR"
