#!/bin/bash
set -uo pipefail

# ============================================================
# JARVIS Sandbox Entrypoint
# Clones repo, sets up environment, launches Claude Code
# ============================================================

TASK="${SANDBOX_TASK:-No task specified}"
SPEC_PATH="${SANDBOX_SPEC:-}"
BRANCH="${SANDBOX_BRANCH:-sandbox/$(date +%Y%m%d-%H%M%S)}"
BASE_BRANCH="${SANDBOX_BASE_BRANCH:-develop}"
MODEL="${SANDBOX_MODEL:-opus}"
INTERACTIVE="${SANDBOX_INTERACTIVE:-false}"
PROMPT_FILE="/tmp/sandbox-prompt.md"

# Ensure mounted dirs are writable by sandbox user
sudo chown -R sandbox:sandbox /output 2>/dev/null || true
# Copy .claude config from read-only host mounts to writable locations
# Host's ~/.claude is mounted at .claude-host:ro to prevent permission damage
# Must use sudo because some files (e.g. .credentials.json) are 600 with host UID
if [ -d /home/sandbox/.claude-host ]; then
    sudo cp -a /home/sandbox/.claude-host /home/sandbox/.claude 2>/dev/null || true
    sudo chown -R sandbox:sandbox /home/sandbox/.claude 2>/dev/null || true
fi
# Copy ~/.claude.json (Claude Code settings/state file)
if [ -f /home/sandbox/.claude.json.host ]; then
    sudo cp -a /home/sandbox/.claude.json.host /home/sandbox/.claude.json 2>/dev/null || true
    sudo chown sandbox:sandbox /home/sandbox/.claude.json 2>/dev/null || true
fi

echo "============================================"
echo "  JARVIS Sandbox Environment"
echo "============================================"
echo "  Task:   $TASK"
echo "  Branch: $BRANCH"
echo "  Model:  $MODEL"
echo "  Mode:   $([ "$INTERACTIVE" = "true" ] && echo "interactive" || echo "autonomous")"
echo "============================================"
echo ""

# ----------------------------------------------------------
# 1. Clone repo from read-only bind mount
# ----------------------------------------------------------
echo "[1/5] Cloning repository..."
# Trust all directories (bind mount has different ownership)
git config --global --add safe.directory '*'
if [ -d /repo-source/.git ]; then
    # Clone into temp dir then move contents (avoids "directory not empty" error)
    git clone /repo-source /tmp/repo-clone 2>&1 | head -5
    # Move everything into /workspace (which may already exist from Dockerfile WORKDIR)
    rm -rf /workspace/* /workspace/.* 2>/dev/null || true
    mv /tmp/repo-clone/* /tmp/repo-clone/.* /workspace/ 2>/dev/null || true
    rm -rf /tmp/repo-clone
    cd /workspace
    git checkout "$BASE_BRANCH" 2>/dev/null || true
    echo "  Cloned from local bind mount."
else
    echo "  ERROR: /repo-source is not a git repository."
    echo "  Make sure to bind mount the JARVIS repo: -v /path/to/JARVIS:/repo-source:ro"
    exit 1
fi

# ----------------------------------------------------------
# 2. Set up git identity
# ----------------------------------------------------------
echo "[2/5] Configuring git..."
git config user.name "${GIT_AUTHOR_NAME:-JARVIS Sandbox}"
git config user.email "${GIT_AUTHOR_EMAIL:-jarvis-sandbox@strokmatic.com}"
git checkout -b "$BRANCH"
echo "  Created branch: $BRANCH"

# ----------------------------------------------------------
# 3. Build prompt
# ----------------------------------------------------------
echo "[3/5] Preparing task prompt..."

cat > "$PROMPT_FILE" <<PROMPT_EOF
# Autonomous Task Execution

You are running inside an isolated JARVIS sandbox container. You have full
permissions to execute any command, edit any file, and install any package.
Work autonomously until the task is complete.

## Task
$TASK

PROMPT_EOF

# Append spec file if provided
if [ -n "$SPEC_PATH" ] && [ -f "/workspace/$SPEC_PATH" ]; then
    echo "## Specification" >> "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"
    cat "/workspace/$SPEC_PATH" >> "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"
    echo "  Spec loaded: $SPEC_PATH"
elif [ -n "$SPEC_PATH" ]; then
    echo "  WARNING: Spec file not found: $SPEC_PATH"
fi

cat >> "$PROMPT_FILE" <<'PROMPT_EOF'

## Working Directory
/workspace (a fresh clone of the JARVIS repository on a feature branch)

## Guidelines
1. Read CLAUDE.md first to understand project conventions
2. Implement the task following existing code patterns
3. Run tests after implementing changes (if a test framework exists)
4. Run linters if available (ruff for Python, eslint for Node.js)
5. Commit your changes with descriptive messages (use Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>)
6. If you create new files, make sure they follow the existing directory structure
7. When done, verify your work with `git log --oneline` and `git diff --stat` against the base branch

## Constraints
- Do NOT push to any remote
- Do NOT modify files outside /workspace (except /output/ for the report)
- Do NOT run destructive git commands (reset --hard, clean -f)
- Commit all meaningful changes before finishing
- If you encounter blockers you cannot resolve, document them in the report

## Implementation Report (MANDATORY)

After completing your work (or if you get stuck), you MUST write a detailed implementation
report to `/output/REPORT.md` as your FINAL action before exiting. This is the primary
deliverable alongside your code — the person reviewing your work will read this report
to understand what happened.

The report must follow this structure:

```markdown
# Implementation Report

## Task
<What was asked — one sentence summary>

## Approach
<How you decided to tackle this. What did you read/explore first? What patterns did you follow?>

## Exploration & Findings
<What you discovered about the codebase that informed your decisions.
Existing patterns, relevant files, conventions you followed or deviated from.>

## Implementation
<What you built/changed. Describe each file and why.
Include code snippets for key decisions.>

## Tests & Validation
<What checks did you run? Linter results, test results, manual verification.
If something failed, what was it and how did you fix it?>

## Issues & Resolutions
<Problems you hit during implementation. Error messages, wrong assumptions,
things that didn't work on first try. How you resolved each one.
If anything remains unresolved, say so clearly.>

## Files Changed
<List every file added/modified/deleted with a one-line description of the change>

## Lessons Learned
<What would be useful to know for future tasks in this codebase?
Patterns to follow, pitfalls to avoid, things that surprised you.>
```

Write this report AFTER committing your code changes but BEFORE saying "Task complete".
Do NOT commit the report to git — write it directly to `/output/REPORT.md`.
PROMPT_EOF

echo "  Prompt ready ($(wc -l < "$PROMPT_FILE") lines)"

# ----------------------------------------------------------
# 4. Launch Claude Code
# ----------------------------------------------------------
echo "[4/5] Launching Claude Code..."
echo ""

CLAUDE_EXIT=0
if [ "$INTERACTIVE" = "true" ]; then
    # Interactive mode: attach TTY, user can interact
    claude --dangerously-skip-permissions --model "$MODEL" || CLAUDE_EXIT=$?
else
    # Autonomous mode: pipe prompt, let Claude work
    claude --dangerously-skip-permissions --model "$MODEL" -p "$(cat "$PROMPT_FILE")" || CLAUDE_EXIT=$?
fi

# ----------------------------------------------------------
# 5. Extract results
# ----------------------------------------------------------
echo ""
echo "[5/5] Extracting results..."

cd /workspace

# Check if there are any commits on the branch
COMMIT_COUNT=$(git rev-list --count "$BASE_BRANCH".."$BRANCH" 2>/dev/null || echo "0")
COMMIT_COUNT=$(echo "$COMMIT_COUNT" | tr -d '[:space:]')

if [ "$COMMIT_COUNT" -gt 0 ] 2>/dev/null; then
    # Generate patch files
    git format-patch "$BASE_BRANCH" -o /output/ --quiet
    PATCH_COUNT=$(find /output -name '*.patch' -type f 2>/dev/null | wc -l)
    PATCH_COUNT=$(echo "$PATCH_COUNT" | tr -d '[:space:]')
    echo "  $COMMIT_COUNT commit(s), $PATCH_COUNT patch file(s) written to /output/"
else
    PATCH_COUNT=0
    echo "  No commits produced."
fi

# Generate metadata file (machine-readable, used by host launcher)
cat > /output/META.json <<EOF
{
  "task": $(echo "$TASK" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "spec": "$SPEC_PATH",
  "branch": "$BRANCH",
  "base_branch": "$BASE_BRANCH",
  "model": "$MODEL",
  "commits": $COMMIT_COUNT,
  "patches": $PATCH_COUNT,
  "claude_exit_code": $CLAUDE_EXIT,
  "commit_log": $(git log --oneline "$BASE_BRANCH".."$BRANCH" 2>/dev/null | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "diff_stat": $(git diff --stat "$BASE_BRANCH".."$BRANCH" 2>/dev/null | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')
}
EOF

# Check for implementation report
if [ -f /output/REPORT.md ]; then
    echo "  Implementation report: /output/REPORT.md"
else
    echo "  WARNING: No implementation report generated by Claude"
fi

# Make output readable by host user (container UID differs from host UID)
chmod -R a+rX /output 2>/dev/null || true

echo ""
echo "============================================"
echo "  Sandbox session complete"
echo "============================================"

exit $CLAUDE_EXIT
