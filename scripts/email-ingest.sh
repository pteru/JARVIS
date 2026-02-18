#!/usr/bin/env bash
# Email Organizer — hourly cron pipeline
# Fetches new emails via IMAP, classifies into PMO folders, parses to JSON,
# then runs AI analysis on any uncategorized emails.
# Deduplication is built-in:
#   - fetch: tracks seen UIDs per IMAP folder in data/email-organizer/imap_state.json
#   - parse: skips emails whose hash already exists in the project's index.json
#   - analyze: skips emails that already have a category

set -euo pipefail

JARVIS_HOME="${ORCHESTRATOR_HOME:-/home/teruel/JARVIS}"
EMAIL_TOOL="$JARVIS_HOME/tools/email-organizer"
VENV_PYTHON="$EMAIL_TOOL/.venv/bin/python"
MAIN="$EMAIL_TOOL/main.py"

# Load IMAP credentials (handles spaces in app password)
if [[ -f "$EMAIL_TOOL/.env" ]]; then
    export IMAP_USERNAME=$(grep '^IMAP_USERNAME=' "$EMAIL_TOOL/.env" | cut -d= -f2-)
    export IMAP_PASSWORD=$(grep '^IMAP_PASSWORD=' "$EMAIL_TOOL/.env" | cut -d= -f2-)
    export IMAP_HOST=$(grep '^IMAP_HOST=' "$EMAIL_TOOL/.env" | cut -d= -f2- || echo "imap.gmail.com")
fi

if [[ -z "${IMAP_USERNAME:-}" || -z "${IMAP_PASSWORD:-}" ]]; then
    echo "ERROR: IMAP credentials not found in $EMAIL_TOOL/.env"
    exit 1
fi

export JARVIS_HOME

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Email Ingest — $(date -Iseconds) ==="
"$VENV_PYTHON" "$MAIN" ingest

# Run AI analysis on any uncategorized emails
"$SCRIPT_DIR/email-analyze.sh"
echo "=== Done — $(date -Iseconds) ==="
