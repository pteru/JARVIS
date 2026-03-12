#!/usr/bin/env bash
# Review metadata sidecar management.
# Manages .meta.json files alongside review .md files.
# Usage: source "$SCRIPT_DIR/lib/review-metadata.sh"
#
# Functions:
#   write_review_metadata <repo> <number> <head_sha>
#   read_review_metadata  <repo> <number> <field>
#
# Requires: REVIEWS_DIR from lib/config.sh

# Write or update review metadata sidecar file.
# Creates a new version entry and updates current_* fields.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - head SHA at time of review
write_review_metadata() {
    local repo="$1"
    local number="$2"
    local head_sha="$3"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"
    local reviewed_at
    reviewed_at=$(date -Iseconds)

    node -e "
        const fs = require('fs');
        const metaFile = process.argv[1];
        const headSha = process.argv[2];
        const reviewedAt = process.argv[3];

        let meta = { versions: [] };
        if (fs.existsSync(metaFile)) {
            try {
                meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
            } catch (e) {
                meta = { versions: [] };
            }
        }

        // Determine next version number
        const versions = meta.versions || [];
        const nextVersion = versions.length > 0
            ? Math.max(...versions.map(v => v.version)) + 1
            : 1;

        // Add new version entry
        versions.push({
            version: nextVersion,
            reviewed_at: reviewedAt,
            head_sha: headSha
        });

        // Update current fields
        meta.current_version = nextVersion;
        meta.current_head_sha = headSha;
        meta.current_reviewed_at = reviewedAt;
        meta.versions = versions;

        // Preserve existing posted_to_github and labels_applied if present
        if (!meta.posted_to_github) meta.posted_to_github = null;
        if (!meta.labels_applied) meta.labels_applied = [];

        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
    " "$meta_file" "$head_sha" "$reviewed_at" 2>/dev/null
}

# Read a field from review metadata sidecar file.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - field name (e.g. "current_head_sha", "current_version", "current_reviewed_at")
# Output: field value to stdout, or empty string if not found
read_review_metadata() {
    local repo="$1"
    local number="$2"
    local field="$3"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"

    if [[ ! -f "$meta_file" ]]; then
        echo ""
        return 1
    fi

    node -e "
        const fs = require('fs');
        const metaFile = process.argv[1];
        const field = process.argv[2];
        try {
            const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
            const value = meta[field];
            if (value === null || value === undefined) {
                process.exit(1);
            }
            if (Array.isArray(value)) {
                console.log(JSON.stringify(value));
            } else {
                console.log(String(value));
            }
        } catch (e) {
            process.exit(1);
        }
    " "$meta_file" "$field" 2>/dev/null || echo ""
}

# Update posted_to_github metadata after posting a review as a PR comment.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - GitHub comment ID
#   $4 - md5 hash of the posted review content
update_posted_metadata() {
    local repo="$1"
    local number="$2"
    local comment_id="$3"
    local review_hash="$4"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"
    local posted_at
    posted_at=$(date -Iseconds)

    if [[ ! -f "$meta_file" ]]; then
        echo "ERROR: Metadata file not found: $meta_file" >&2
        return 1
    fi

    node -e "
        const fs = require('fs');
        const metaFile = process.argv[1];
        const commentId = process.argv[2];
        const reviewHash = process.argv[3];
        const postedAt = process.argv[4];

        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        } catch (e) {
            console.error('Failed to parse metadata:', e.message);
            process.exit(1);
        }

        meta.posted_to_github = {
            comment_id: parseInt(commentId) || commentId,
            posted_at: postedAt,
            review_hash: reviewHash
        };

        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
    " "$meta_file" "$comment_id" "$review_hash" "$posted_at" 2>/dev/null
}

# Update labels_applied metadata after labeling a PR.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - JSON array of applied labels (e.g. '["size/M","ai-review/approve"]')
update_labels_metadata() {
    local repo="$1"
    local number="$2"
    local labels_json="$3"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"

    if [[ ! -f "$meta_file" ]]; then
        echo "ERROR: Metadata file not found: $meta_file" >&2
        return 1
    fi

    node -e "
        const fs = require('fs');
        const metaFile = process.argv[1];
        const labelsJson = process.argv[2];

        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        } catch (e) {
            console.error('Failed to parse metadata:', e.message);
            process.exit(1);
        }

        try {
            meta.labels_applied = JSON.parse(labelsJson);
        } catch (e) {
            console.error('Failed to parse labels JSON:', e.message);
            process.exit(1);
        }

        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
    " "$meta_file" "$labels_json" 2>/dev/null
}
