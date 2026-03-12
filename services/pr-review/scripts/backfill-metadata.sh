#!/bin/bash
# One-time migration: backfill .meta.json for existing review .md files.
# Creates metadata with reviewed_at from file mtime and empty head_sha.
# Safe to run multiple times — skips reviews that already have metadata.
#
# Usage: backfill-metadata.sh [--dry-run]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/config.sh"
source "$SCRIPT_DIR/../lib/review-metadata.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [backfill] $*"; }

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    log "Dry-run mode — no files will be written"
fi

if [[ ! -d "$REVIEWS_DIR" ]]; then
    log "No reviews directory at $REVIEWS_DIR"
    exit 0
fi

TOTAL=0
CREATED=0
SKIPPED=0

for review_file in "$REVIEWS_DIR"/*.md; do
    [[ -f "$review_file" ]] || continue
    TOTAL=$((TOTAL + 1))

    basename=$(basename "$review_file" .md)
    meta_file="$REVIEWS_DIR/${basename}.meta.json"

    # Skip if metadata already exists
    if [[ -f "$meta_file" ]]; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # Extract repo and number from basename (e.g. "my-repo-123")
    number="${basename##*-}"
    repo="${basename%-*}"

    # Get file mtime as reviewed_at
    review_mtime=$(stat -c %Y "$review_file" 2>/dev/null || date -r "$review_file" +%s 2>/dev/null || echo 0)
    reviewed_at=$(date -d "@$review_mtime" -Iseconds 2>/dev/null || date -r "$review_mtime" -Iseconds 2>/dev/null || date -Iseconds)

    if [[ "$DRY_RUN" == "true" ]]; then
        log "Would create: $meta_file (repo=$repo, number=$number, reviewed_at=$reviewed_at)"
    else
        # Write metadata with empty head_sha (unknown for existing reviews)
        node -e "
            const fs = require('fs');
            const meta = {
                current_version: 1,
                current_head_sha: '',
                current_reviewed_at: process.argv[1],
                versions: [{
                    version: 1,
                    reviewed_at: process.argv[1],
                    head_sha: ''
                }],
                posted_to_github: null,
                labels_applied: []
            };
            fs.writeFileSync(process.argv[2], JSON.stringify(meta, null, 2) + '\n');
        " "$reviewed_at" "$meta_file" 2>/dev/null

        log "Created: $meta_file"
    fi
    CREATED=$((CREATED + 1))
done

log "Done. Total: $TOTAL reviews, Created: $CREATED metadata files, Skipped: $SKIPPED (already exist)"
