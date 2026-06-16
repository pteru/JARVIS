#!/usr/bin/env bash
# Standardize branch protection across all Strokmatic repos
# - master is always the default branch
# - Rulesets replace legacy branch protection
# - develop: no direct push, no review required for PRs
# - master: no direct push, 1 review required for PRs
#
# Usage: ./scripts/standardize-repo-rulesets.sh [--dry-run] [--repo <name>]

set -euo pipefail

DRY_RUN=false
SINGLE_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --repo) SINGLE_REPO="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

ORG="strokmatic"
PASS=0
FAIL=0
SKIP=0

log()  { echo "[INFO]  $*"; }
warn() { echo "[WARN]  $*"; }
err()  { echo "[ERROR] $*"; }
dry()  { if $DRY_RUN; then echo "[DRY-RUN] $*"; return 0; else return 1; fi; }

# --- Get repo list ---
if [[ -n "$SINGLE_REPO" ]]; then
  repos="$SINGLE_REPO"
else
  repos=$(gh repo list "$ORG" --no-archived --json name --limit 200 --jq '.[].name' | sort)
fi

total=$(echo "$repos" | wc -l)
current=0

for repo in $repos; do
  current=$((current + 1))
  echo ""
  echo "===== [$current/$total] $ORG/$repo ====="

  # --- 1. Ensure master branch exists and is default ---
  default_branch=$(gh api "repos/$ORG/$repo" --jq '.default_branch' 2>/dev/null)
  log "Current default branch: $default_branch"

  if [[ "$default_branch" == "master" ]]; then
    log "Default branch is already master"
  elif [[ "$default_branch" == "main" ]]; then
    log "Renaming 'main' -> 'master'"
    if ! dry "Would rename main -> master"; then
      gh api "repos/$ORG/$repo/branches/main/rename" --method POST -f new_name=master 2>/dev/null || {
        err "Failed to rename main -> master"
        FAIL=$((FAIL + 1))
        continue
      }
      log "Renamed main -> master"
    fi
  else
    # Default is something else (e.g. chore/inline-submodules, develop)
    # Check if master branch exists
    has_master=$(gh api "repos/$ORG/$repo/branches/master" --jq '.name' 2>/dev/null || echo "")
    if [[ "$has_master" == "master" ]]; then
      log "Setting default branch to master (was: $default_branch)"
      if ! dry "Would set default branch to master"; then
        gh api "repos/$ORG/$repo" --method PATCH -f default_branch=master 2>/dev/null || {
          err "Failed to set default branch to master"
          FAIL=$((FAIL + 1))
          continue
        }
      fi
    else
      warn "No 'master' branch found — skipping (default: $default_branch)"
      SKIP=$((SKIP + 1))
      continue
    fi
  fi

  # --- 2. Remove legacy branch protection ---
  for branch in master develop; do
    has_protection=$(gh api "repos/$ORG/$repo/branches/$branch/protection" --jq '.url' 2>/dev/null || echo "")
    if [[ -n "$has_protection" ]]; then
      log "Removing legacy protection on $branch"
      if ! dry "Would remove legacy protection on $branch"; then
        gh api "repos/$ORG/$repo/branches/$branch/protection" --method DELETE 2>/dev/null || {
          warn "Failed to remove legacy protection on $branch (may not exist)"
        }
      fi
    fi
  done

  # --- 3. Delete existing rulesets ---
  existing_rulesets=$(gh api "repos/$ORG/$repo/rulesets" 2>/dev/null || echo "[]")
  ruleset_ids=$(echo "$existing_rulesets" | jq -r '.[].id' 2>/dev/null)
  for rs_id in $ruleset_ids; do
    rs_name=$(echo "$existing_rulesets" | jq -r ".[] | select(.id == $rs_id) | .name")
    log "Deleting existing ruleset: $rs_name (id: $rs_id)"
    if ! dry "Would delete ruleset $rs_name ($rs_id)"; then
      gh api "repos/$ORG/$repo/rulesets/$rs_id" --method DELETE 2>/dev/null || {
        warn "Failed to delete ruleset $rs_id"
      }
    fi
  done

  # --- 4. Create develop ruleset (no review required) ---
  # Check if develop branch exists before creating ruleset
  has_develop=$(gh api "repos/$ORG/$repo/branches/develop" --jq '.name' 2>/dev/null || echo "")
  if [[ "$has_develop" == "develop" ]]; then
    log "Creating develop ruleset (no PR review)"
    if ! dry "Would create develop ruleset"; then
      gh api "repos/$ORG/$repo/rulesets" --method POST --input - <<'DEVELOP_EOF' 2>/dev/null || {
{
  "name": "develop",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/develop"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_linear_history"}
  ]
}
DEVELOP_EOF
        err "Failed to create develop ruleset"
      }
    fi
  else
    warn "No 'develop' branch — skipping develop ruleset"
  fi

  # --- 5. Create master ruleset (1 review required) ---
  log "Creating master ruleset (1 PR review required)"
  if ! dry "Would create master ruleset"; then
    gh api "repos/$ORG/$repo/rulesets" --method POST --input - <<'MASTER_EOF' 2>/dev/null || {
{
  "name": "master",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/master"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_linear_history"},
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash", "rebase"]
      }
    }
  ]
}
MASTER_EOF
      err "Failed to create master ruleset"
    }
  fi

  PASS=$((PASS + 1))
  log "Done"
done

echo ""
echo "===== SUMMARY ====="
echo "Total: $total | Pass: $PASS | Fail: $FAIL | Skip: $SKIP"
