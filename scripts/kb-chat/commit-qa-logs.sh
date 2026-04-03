#!/usr/bin/env bash
set -euo pipefail

KB_REPO="${HOME}/JARVIS/workspaces/strokmatic/knowledge-base"

cd "$KB_REPO"

# Check if there are changes in registro-qa/
if git diff --quiet registro-qa/ && git diff --cached --quiet registro-qa/; then
  echo "[$(date -Iseconds)] No new Q&A logs to commit"
  exit 0
fi

git add registro-qa/
git commit -m "chore: update Q&A logs ($(date +%Y-%m-%d))"
git push origin master

echo "[$(date -Iseconds)] Q&A logs committed and pushed"
