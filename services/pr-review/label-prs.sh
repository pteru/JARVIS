#!/bin/bash
# Apply labels to PRs based on review analysis.
# Labels include size (S/M/L), verdict (approve/changes-requested),
# and flags (needs-tests, security-concern).
#
# Usage: label-prs.sh --all | --repo <repo> --pr <number>
#
# Idempotent: compares with labels_applied in .meta.json to avoid redundant API calls.
# Removes stale labels when verdict changes.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/config.sh"
source "$SCRIPT_DIR/lib/review-metadata.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [label-prs] $*"; }

usage() {
    echo "Usage: label-prs.sh --all | --repo <repo> --pr <number>"
    echo ""
    echo "Apply labels to PRs based on review analysis."
    echo ""
    echo "Options:"
    echo "  --all                Label all reviewed PRs"
    echo "  --repo <name>        GitHub repo name (e.g. visionking-backend)"
    echo "  --pr <number>        PR number"
    exit 1
}

# Parse args
MODE=""
TARGET_REPO=""
TARGET_PR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)      MODE="all"; shift ;;
        --repo)     TARGET_REPO="$2"; shift 2 ;;
        --pr)       TARGET_PR="$2"; shift 2 ;;
        *)          usage ;;
    esac
done

if [[ "$MODE" != "all" && ( -z "$TARGET_REPO" || -z "$TARGET_PR" ) ]]; then
    usage
fi

if [[ ! -f "$INBOX_FILE" ]]; then
    log "ERROR: PR inbox not found at $INBOX_FILE"
    exit 1
fi

# ─── Label definitions ──────────────────────────────────────────────────────

declare -A LABEL_COLORS
LABEL_COLORS=(
    ["size/S"]="0e8a16"
    ["size/M"]="fbca04"
    ["size/L"]="d93f0b"
    ["ai-review/approve"]="0e8a16"
    ["ai-review/changes-requested"]="d93f0b"
    ["needs-tests"]="e4e669"
    ["security-concern"]="b60205"
)

# Size labels are mutually exclusive
SIZE_LABELS=("size/S" "size/M" "size/L")
# Verdict labels are mutually exclusive
VERDICT_LABELS=("ai-review/approve" "ai-review/changes-requested")

# ─── Helper functions ────────────────────────────────────────────────────────

# Ensure a label exists in the repo (creates if missing).
# Args: $1 - repo, $2 - label name
ensure_label_exists() {
    local repo="$1"
    local label="$2"
    local color="${LABEL_COLORS[$label]:-cccccc}"

    gh label create "$label" \
        --color "$color" \
        --repo "${ORG}/${repo}" \
        2>/dev/null || true
}

# Parse complexity/size from review file content.
# Returns: S, M, or L
# Args: $1 - review file path
parse_size_from_review() {
    local review_file="$1"
    local complexity

    # Try to extract from **Complexity:** line in the review
    complexity=$(grep -oP '\*\*Complexity:\*\*\s*\K\S+' "$review_file" 2>/dev/null | head -1 || echo "")

    case "$complexity" in
        simple)  echo "S" ;;
        medium)  echo "M" ;;
        complex) echo "L" ;;
        *)
            # Fallback: check metadata for complexity hint, default to M
            echo "M"
            ;;
    esac
}

# Parse verdict from review file content.
# Returns: approve | changes-requested | ""
# Args: $1 - review file path
parse_verdict_from_review() {
    local review_file="$1"
    local verdict_line

    # Look for the verdict line after ## Verdict header
    verdict_line=$(awk '/^## Verdict/{found=1; next} found && /^(APPROVE|CHANGES REQUESTED)/{print; exit}' "$review_file" 2>/dev/null || echo "")

    # Also try bold format: **APPROVE** or **CHANGES REQUESTED**
    if [[ -z "$verdict_line" ]]; then
        verdict_line=$(awk '/^## Verdict/{found=1; next} found && /^\*\*(APPROVE|CHANGES REQUESTED)/{print; exit}' "$review_file" 2>/dev/null || echo "")
    fi

    # Normalize
    if echo "$verdict_line" | grep -qi "CHANGES REQUESTED"; then
        echo "changes-requested"
    elif echo "$verdict_line" | grep -qi "APPROVE"; then
        echo "approve"
    else
        echo ""
    fi
}

# Check if review mentions missing tests.
# Args: $1 - review file path
has_missing_tests_finding() {
    local review_file="$1"

    # Look for test-related concerns in Critical or Warnings sections
    if grep -qiE '(no tests|missing tests|test coverage|untested|needs? tests?|without tests)' "$review_file" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Check if review mentions security concerns.
# Args: $1 - review file path
has_security_finding() {
    local review_file="$1"

    # Look within Critical section for security-related keywords
    local in_critical
    in_critical=$(awk '/^### Critical/{found=1; next} /^###/{found=0} found{print}' "$review_file" 2>/dev/null || echo "")

    if echo "$in_critical" | grep -qiE '(security|injection|xss|csrf|auth|credentials|secrets?|vulnerab|sql injection|exposed|leak)' 2>/dev/null; then
        # Only flag if the section has actual findings (not "None")
        if ! echo "$in_critical" | grep -qi "^None" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Label a single PR based on its review analysis.
# Args:
#   $1 - repo name
#   $2 - PR number
label_single_pr() {
    local repo="$1"
    local number="$2"
    local review_file="$REVIEWS_DIR/${repo}-${number}.md"
    local meta_file="$REVIEWS_DIR/${repo}-${number}.meta.json"

    if [[ ! -f "$review_file" ]]; then
        log "Skipping $repo#$number — no review file"
        return 0
    fi

    if [[ ! -f "$meta_file" ]]; then
        log "Skipping $repo#$number — no metadata file"
        return 0
    fi

    # Check if PR is draft
    local is_draft
    is_draft=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE', 'utf-8'));
        const pr = (inbox.pull_requests || []).find(p => p.repo === '$repo' && p.number === $number);
        if (!pr) { console.log('not_found'); process.exit(0); }
        console.log(pr.is_draft === true ? 'true' : 'false');
    " 2>/dev/null || echo "not_found")

    if [[ "$is_draft" == "true" ]]; then
        log "Skipping $repo#$number — draft PR"
        return 0
    fi

    if [[ "$is_draft" == "not_found" ]]; then
        log "Skipping $repo#$number — not found in inbox"
        return 0
    fi

    # Determine labels to apply
    local new_labels=()

    # Size label
    local size
    size=$(parse_size_from_review "$review_file")
    new_labels+=("size/${size}")

    # Verdict label
    local verdict
    verdict=$(parse_verdict_from_review "$review_file")
    if [[ -n "$verdict" ]]; then
        new_labels+=("ai-review/${verdict}")
    fi

    # Flag labels
    if has_missing_tests_finding "$review_file"; then
        new_labels+=("needs-tests")
    fi

    if has_security_finding "$review_file"; then
        new_labels+=("security-concern")
    fi

    # Read previously applied labels from metadata
    local prev_labels_json
    prev_labels_json=$(node -e "
        const fs = require('fs');
        try {
            const meta = JSON.parse(fs.readFileSync('$meta_file', 'utf-8'));
            console.log(JSON.stringify(meta.labels_applied || []));
        } catch(e) { console.log('[]'); }
    " 2>/dev/null || echo "[]")

    # Build new labels JSON array
    local new_labels_json
    new_labels_json=$(printf '%s\n' "${new_labels[@]}" | node -e "
        const lines = require('fs').readFileSync('/dev/stdin','utf-8').trim().split('\n').filter(Boolean);
        console.log(JSON.stringify(lines));
    " 2>/dev/null || echo "[]")

    # Compare: skip if identical
    local labels_changed
    labels_changed=$(node -e "
        const prev = JSON.parse(process.argv[1]);
        const next = JSON.parse(process.argv[2]);
        const same = prev.length === next.length && prev.every(l => next.includes(l));
        console.log(same ? 'false' : 'true');
    " "$prev_labels_json" "$new_labels_json" 2>/dev/null || echo "true")

    if [[ "$labels_changed" == "false" ]]; then
        log "Skipping $repo#$number — labels unchanged"
        return 0
    fi

    log "Labeling $repo#$number: ${new_labels[*]}"

    # Determine labels to remove (stale mutually exclusive labels)
    local labels_to_remove=()

    # Remove stale size labels
    for sl in "${SIZE_LABELS[@]}"; do
        local found_in_new=false
        for nl in "${new_labels[@]}"; do
            if [[ "$nl" == "$sl" ]]; then
                found_in_new=true
                break
            fi
        done
        if [[ "$found_in_new" == "false" ]]; then
            labels_to_remove+=("$sl")
        fi
    done

    # Remove stale verdict labels
    for vl in "${VERDICT_LABELS[@]}"; do
        local found_in_new=false
        for nl in "${new_labels[@]}"; do
            if [[ "$nl" == "$vl" ]]; then
                found_in_new=true
                break
            fi
        done
        if [[ "$found_in_new" == "false" ]]; then
            labels_to_remove+=("$vl")
        fi
    done

    # Remove stale flag labels (needs-tests, security-concern) if not in new set
    for fl in "needs-tests" "security-concern"; do
        local found_in_new=false
        for nl in "${new_labels[@]}"; do
            if [[ "$nl" == "$fl" ]]; then
                found_in_new=true
                break
            fi
        done
        if [[ "$found_in_new" == "false" ]]; then
            labels_to_remove+=("$fl")
        fi
    done

    # Ensure all new labels exist in the repo
    for label in "${new_labels[@]}"; do
        ensure_label_exists "$repo" "$label"
    done

    # Remove stale labels
    if [[ ${#labels_to_remove[@]} -gt 0 ]]; then
        local remove_csv
        remove_csv=$(IFS=,; echo "${labels_to_remove[*]}")
        gh pr edit "$number" \
            --repo "${ORG}/${repo}" \
            --remove-label "$remove_csv" \
            2>/dev/null || true
        log "  Removed stale labels: ${labels_to_remove[*]}"
    fi

    # Apply new labels
    if [[ ${#new_labels[@]} -gt 0 ]]; then
        local add_csv
        add_csv=$(IFS=,; echo "${new_labels[*]}")
        if gh pr edit "$number" \
            --repo "${ORG}/${repo}" \
            --add-label "$add_csv" \
            2>/dev/null; then
            log "  Applied labels: ${new_labels[*]}"
        else
            log "ERROR: Failed to apply labels to $repo#$number"
            return 1
        fi
    fi

    # Update metadata
    if update_labels_metadata "$repo" "$number" "$new_labels_json"; then
        log "  Metadata updated for $repo#$number"
    else
        log "WARNING: Failed to update labels metadata for $repo#$number"
    fi

    return 0
}

# Track results
LABELED=0
SKIPPED=0
FAILED=0

if [[ "$MODE" == "all" ]]; then
    # Iterate all review files that have corresponding open PRs
    PR_LIST=$(node -e "
        const fs = require('fs');
        const inbox = JSON.parse(fs.readFileSync('$INBOX_FILE', 'utf-8'));
        const prs = inbox.pull_requests || [];
        const reviewsDir = '$REVIEWS_DIR';

        prs.filter(pr => !pr.is_draft).forEach(pr => {
            const reviewFile = reviewsDir + '/' + pr.repo + '-' + pr.number + '.md';
            if (fs.existsSync(reviewFile)) {
                console.log(pr.repo + '\t' + pr.number);
            }
        });
    " 2>/dev/null || true)

    if [[ -z "$PR_LIST" ]]; then
        log "No PRs to label."
        exit 0
    fi

    TOTAL=$(echo "$PR_LIST" | wc -l | tr -d ' ')
    log "Found $TOTAL PR(s) to check for labeling"

    while IFS=$'\t' read -r repo number; do
        if label_single_pr "$repo" "$number"; then
            LABELED=$((LABELED + 1))
        else
            FAILED=$((FAILED + 1))
        fi
    done <<< "$PR_LIST"

    log "Label summary: $LABELED labeled/checked, $FAILED failed"
else
    # Single PR mode
    if label_single_pr "$TARGET_REPO" "$TARGET_PR"; then
        LABELED=1
    else
        FAILED=1
    fi
fi

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

exit 0
