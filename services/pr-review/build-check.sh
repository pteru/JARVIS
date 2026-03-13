#!/bin/bash
# PR Review Service — Build & Test Checker (Tier 1)
# Clones a PR branch, detects project type, runs build + test, and appends
# results to the review file as a "## Build & Test Results" section.
#
# Gated by build_check_enabled and build_check_repos in config/service.json.
# Only runs for repos explicitly listed in build_check_repos (empty = none).
#
# Usage:
#   build-check.sh --all                     Check all reviewed PRs (that have reviews)
#   build-check.sh --repo <name> --pr <num>  Check a single PR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SERVICE_DIR="${SERVICE_DIR:-$SCRIPT_DIR}"
source "$SCRIPT_DIR/lib/config.sh"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [build-check] $*"; }

# ─── Config ──────────────────────────────────────────────────────────────────
BUILD_TIMEOUT=300  # 5 minutes per step (build, test)
CLONE_DIR=""       # Set per-PR, cleaned up in trap

cleanup() {
    if [[ -n "$CLONE_DIR" && -d "$CLONE_DIR" ]]; then
        rm -rf "$CLONE_DIR"
    fi
}
trap cleanup EXIT

# ─── Check feature flag ─────────────────────────────────────────────────────
is_build_check_enabled() {
    if [[ ! -f "$SERVICE_CONFIG" ]]; then
        return 1
    fi
    node -e "
        const c = JSON.parse(require('fs').readFileSync('$SERVICE_CONFIG','utf-8'));
        process.exit(c.build_check_enabled === true ? 0 : 1);
    " 2>/dev/null
}

is_repo_eligible() {
    local repo="$1"
    if [[ ! -f "$SERVICE_CONFIG" ]]; then
        return 1
    fi
    node -e "
        const c = JSON.parse(require('fs').readFileSync('$SERVICE_CONFIG','utf-8'));
        const repos = c.build_check_repos || [];
        // Match exact name or wildcard '*'
        const eligible = repos.includes('$repo') || repos.includes('*');
        process.exit(eligible ? 0 : 1);
    " 2>/dev/null
}

# ─── Detect project type and run build/test ──────────────────────────────────
detect_and_run() {
    local dir="$1"
    local results_file="$2"

    echo "### Environment" >> "$results_file"
    echo '```' >> "$results_file"
    echo "Node: $(node --version 2>/dev/null || echo 'not available')" >> "$results_file"
    echo "Python: $(python3 --version 2>/dev/null || echo 'not available')" >> "$results_file"
    echo "npm: $(npm --version 2>/dev/null || echo 'not available')" >> "$results_file"
    echo '```' >> "$results_file"
    echo "" >> "$results_file"

    local build_ok=false
    local test_ok=false
    local build_output=""
    local test_output=""

    if [[ -f "$dir/package.json" ]]; then
        # ── Node.js project ──
        echo "**Project type:** Node.js" >> "$results_file"
        echo "" >> "$results_file"

        # Install dependencies
        echo "### Install" >> "$results_file"
        echo '```' >> "$results_file"
        local install_output
        if install_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" npm ci --ignore-scripts 2>&1); then
            echo "npm ci: OK" >> "$results_file"
        elif install_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" npm install --ignore-scripts 2>&1); then
            echo "npm install: OK (no lockfile)" >> "$results_file"
        else
            echo "npm install: FAILED" >> "$results_file"
            echo "$install_output" | tail -20 >> "$results_file"
            echo '```' >> "$results_file"
            echo "" >> "$results_file"
            echo "**Result:** INSTALL FAILED" >> "$results_file"
            return
        fi
        echo '```' >> "$results_file"
        echo "" >> "$results_file"

        # Build
        local has_build
        has_build=$(node -e "
            const pkg = JSON.parse(require('fs').readFileSync('$dir/package.json','utf-8'));
            console.log((pkg.scripts && pkg.scripts.build) ? 'yes' : 'no');
        " 2>/dev/null || echo "no")

        if [[ "$has_build" == "yes" ]]; then
            echo "### Build" >> "$results_file"
            echo '```' >> "$results_file"
            if build_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" npm run build 2>&1); then
                echo "npm run build: OK" >> "$results_file"
                build_ok=true
            else
                echo "npm run build: FAILED" >> "$results_file"
                echo "$build_output" | tail -30 >> "$results_file"
            fi
            echo '```' >> "$results_file"
            echo "" >> "$results_file"
        else
            echo "### Build" >> "$results_file"
            echo "No build script defined — skipped." >> "$results_file"
            echo "" >> "$results_file"
            build_ok=true  # No build script = not a failure
        fi

        # Test
        local has_test
        has_test=$(node -e "
            const pkg = JSON.parse(require('fs').readFileSync('$dir/package.json','utf-8'));
            const t = pkg.scripts && pkg.scripts.test;
            console.log(t && !t.includes('no test specified') ? 'yes' : 'no');
        " 2>/dev/null || echo "no")

        if [[ "$has_test" == "yes" ]]; then
            echo "### Test" >> "$results_file"
            echo '```' >> "$results_file"
            if test_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" npm test 2>&1); then
                echo "npm test: OK" >> "$results_file"
                test_ok=true
            else
                echo "npm test: FAILED" >> "$results_file"
                echo "$test_output" | tail -30 >> "$results_file"
            fi
            echo '```' >> "$results_file"
            echo "" >> "$results_file"
        else
            echo "### Test" >> "$results_file"
            echo "No test script defined — skipped." >> "$results_file"
            echo "" >> "$results_file"
            test_ok=true  # No test script = not a failure
        fi

    elif [[ -f "$dir/requirements.txt" || -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]]; then
        # ── Python project ──
        echo "**Project type:** Python" >> "$results_file"
        echo "" >> "$results_file"

        # Install
        echo "### Install" >> "$results_file"
        echo '```' >> "$results_file"
        local venv_dir="$dir/.venv"
        if python3 -m venv "$venv_dir" 2>/dev/null; then
            local pip="$venv_dir/bin/pip"
            local python="$venv_dir/bin/python"
            if [[ -f "$dir/requirements.txt" ]]; then
                if timeout "$BUILD_TIMEOUT" "$pip" install -q -r "$dir/requirements.txt" 2>&1 | tail -5; then
                    echo "pip install: OK" >> "$results_file"
                else
                    echo "pip install: FAILED" >> "$results_file"
                    echo '```' >> "$results_file"
                    echo "" >> "$results_file"
                    echo "**Result:** INSTALL FAILED" >> "$results_file"
                    return
                fi
            elif [[ -f "$dir/pyproject.toml" ]]; then
                if timeout "$BUILD_TIMEOUT" "$pip" install -q -e "$dir" 2>&1 | tail -5; then
                    echo "pip install -e .: OK" >> "$results_file"
                else
                    echo "pip install: FAILED" >> "$results_file"
                    echo '```' >> "$results_file"
                    echo "" >> "$results_file"
                    echo "**Result:** INSTALL FAILED" >> "$results_file"
                    return
                fi
            fi
        else
            echo "venv creation failed" >> "$results_file"
            echo '```' >> "$results_file"
            echo "" >> "$results_file"
            echo "**Result:** VENV CREATION FAILED" >> "$results_file"
            return
        fi
        echo '```' >> "$results_file"
        echo "" >> "$results_file"
        build_ok=true  # Python doesn't have a separate build step

        # Test
        echo "### Test" >> "$results_file"
        echo '```' >> "$results_file"
        if [[ -d "$dir/tests" || -d "$dir/test" ]]; then
            if test_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" "$venv_dir/bin/python" -m pytest --tb=short -q 2>&1); then
                echo "pytest: OK" >> "$results_file"
                echo "$test_output" | tail -10 >> "$results_file"
                test_ok=true
            else
                echo "pytest: FAILED" >> "$results_file"
                echo "$test_output" | tail -30 >> "$results_file"
            fi
        else
            echo "No tests/ directory found — skipped." >> "$results_file"
            test_ok=true
        fi
        echo '```' >> "$results_file"
        echo "" >> "$results_file"

    elif [[ -f "$dir/Makefile" ]]; then
        # ── Makefile project ──
        echo "**Project type:** Makefile" >> "$results_file"
        echo "" >> "$results_file"
        echo "### Build" >> "$results_file"
        echo '```' >> "$results_file"
        if build_output=$(cd "$dir" && timeout "$BUILD_TIMEOUT" make 2>&1); then
            echo "make: OK" >> "$results_file"
            build_ok=true
        else
            echo "make: FAILED" >> "$results_file"
            echo "$build_output" | tail -20 >> "$results_file"
        fi
        echo '```' >> "$results_file"
        echo "" >> "$results_file"
        test_ok=true  # No standard test convention

    else
        echo "**Project type:** Unknown (no package.json, requirements.txt, or Makefile found)" >> "$results_file"
        echo "" >> "$results_file"
        echo "**Result:** SKIPPED — unable to detect project type" >> "$results_file"
        return
    fi

    # Summary
    echo "### Summary" >> "$results_file"
    local status="PASS"
    if [[ "$build_ok" != "true" ]]; then status="BUILD FAILED"; fi
    if [[ "$test_ok" != "true" ]]; then
        if [[ "$status" == "PASS" ]]; then
            status="TESTS FAILED"
        else
            status="BUILD + TESTS FAILED"
        fi
    fi
    echo "**Result:** $status" >> "$results_file"
}

# ─── Process a single PR ────────────────────────────────────────────────────
check_single_pr() {
    local repo="$1"
    local number="$2"

    # Check if repo is eligible
    if ! is_repo_eligible "$repo"; then
        log "Skipping $repo#$number (repo not in build_check_repos)"
        return 0
    fi

    # Check if review file exists
    local review_file="$REVIEWS_DIR/${repo}-${number}.md"
    if [[ ! -f "$review_file" ]]; then
        log "Skipping $repo#$number (no review file)"
        return 0
    fi

    # Check if build results already exist in the review
    if grep -q '^## Build & Test Results' "$review_file" 2>/dev/null; then
        log "Skipping $repo#$number (build results already present)"
        return 0
    fi

    # Get head branch from inbox
    local head_branch
    head_branch=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE','utf-8'));
        const pr = (inbox.pull_requests || []).find(p => p.repo === '$repo' && p.number === $number);
        if (pr) console.log(pr.head_branch || pr.head_ref || '');
    " 2>/dev/null || echo "")

    if [[ -z "$head_branch" ]]; then
        log "WARNING: Could not determine head branch for $repo#$number"
        return 1
    fi

    log "Checking $repo#$number (branch: $head_branch)"

    # Clone the PR branch
    CLONE_DIR=$(mktemp -d "/tmp/jarvis-build-check-XXXXXX")
    log "Cloning $ORG/$repo@$head_branch into $CLONE_DIR"

    if ! timeout 120 git clone --depth 1 --branch "$head_branch" \
        "https://github.com/$ORG/$repo.git" "$CLONE_DIR/$repo" 2>&1 | tail -3; then
        log "ERROR: Failed to clone $repo@$head_branch"
        rm -rf "$CLONE_DIR"
        CLONE_DIR=""
        return 1
    fi

    # Run build + test
    local results_file
    results_file=$(mktemp "/tmp/build-results-XXXXXX.md")

    echo "" >> "$results_file"
    echo "## Build & Test Results" >> "$results_file"
    echo "" >> "$results_file"
    echo "> Auto-generated by JARVIS build checker on $(date '+%Y-%m-%d %H:%M')" >> "$results_file"
    echo "> Branch: \`$head_branch\` | Repo: \`$repo\`" >> "$results_file"
    echo "" >> "$results_file"

    detect_and_run "$CLONE_DIR/$repo" "$results_file"

    # Append results to review file
    cat "$results_file" >> "$review_file"
    log "Build results appended to $review_file"

    # Cleanup
    rm -f "$results_file"
    rm -rf "$CLONE_DIR"
    CLONE_DIR=""

    return 0
}

# ─── Main ────────────────────────────────────────────────────────────────────

# Parse args
MODE=""
TARGET_REPO=""
TARGET_PR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)      MODE="all"; shift ;;
        --repo)     TARGET_REPO="$2"; shift 2 ;;
        --pr)       TARGET_PR="$2"; shift 2 ;;
        *)
            echo "Usage: build-check.sh --all | --repo <name> --pr <number>"
            exit 1
            ;;
    esac
done

if [[ "$MODE" != "all" && ( -z "$TARGET_REPO" || -z "$TARGET_PR" ) ]]; then
    echo "Usage: build-check.sh --all | --repo <name> --pr <number>"
    exit 1
fi

# Check feature flag
if ! is_build_check_enabled; then
    log "Build checks disabled (build_check_enabled = false)"
    exit 0
fi

if [[ ! -f "$INBOX_FILE" ]]; then
    log "ERROR: PR inbox not found at $INBOX_FILE"
    exit 1
fi

if [[ "$MODE" == "all" ]]; then
    log "Running build checks for all eligible PRs"

    # Get list of open PRs from inbox
    PR_LIST=$(node -e "
        const inbox = JSON.parse(require('fs').readFileSync('$INBOX_FILE','utf-8'));
        (inbox.pull_requests || [])
            .filter(p => !p.is_draft)
            .forEach(p => console.log(p.repo + '\t' + p.number));
    " 2>/dev/null || echo "")

    CHECKED=0
    FAILED=0

    while IFS=$'\t' read -r repo number; do
        [[ -z "$repo" ]] && continue
        if check_single_pr "$repo" "$number"; then
            CHECKED=$((CHECKED + 1))
        else
            FAILED=$((FAILED + 1))
        fi
    done <<< "$PR_LIST"

    log "Build checks complete: $CHECKED checked, $FAILED failed"
else
    check_single_pr "$TARGET_REPO" "$TARGET_PR"
fi
