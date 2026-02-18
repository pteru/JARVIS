---
name: pr-review
description: Run the PR inbox pipeline — fetch, review, and report on open PRs across all Strokmatic repos
argument-hint: "[fetch|review|inbox|archive|status] [options]"
---

# PR Review Pipeline

Run the full or partial PR review pipeline for the Strokmatic GitHub organization.

## Commands

### No argument or "run" — Full pipeline
Run fetch → review → inbox report (equivalent to `orchestrator.sh pr-inbox`):
```bash
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/fetch-open-prs.sh
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/review-pr.sh --all --parallel 3
node /home/teruel/JARVIS/scripts/helpers/build-pr-inbox.mjs
```

### "fetch" — Fetch only
Scan all repos for open PRs without reviewing:
```bash
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/fetch-open-prs.sh
```

### "review" — Review only
Review unreviewed PRs from the last fetch (parallel by default):
```bash
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/review-pr.sh --all --parallel 3
```

### "inbox" or "report" — Generate inbox report only
Build the markdown inbox from existing data:
```bash
node /home/teruel/JARVIS/scripts/helpers/build-pr-inbox.mjs
```
Then read and display `/home/teruel/JARVIS/reports/pr-inbox.md`.

### "archive" — Archive merged reviews
Move reviews for merged/closed PRs to archived:
```bash
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/helpers/archive-merged-reviews.sh
```

### "status" — Show current inbox status
Read `/home/teruel/JARVIS/reports/pr-inbox.json` and show a summary table of all open PRs with their review status. Check `reports/pr-reviews/` for existing review files and extract verdicts.

### Single PR: "review <repo> <number>"
Review a specific PR:
```bash
ORCHESTRATOR_HOME=/home/teruel/JARVIS bash /home/teruel/JARVIS/scripts/review-pr.sh --repo <repo> --pr <number>
```

### "post <repo> <number>" — Post review to GitHub
Clean and post an existing review to GitHub:
```bash
CLEAN_BODY=$(bash /home/teruel/JARVIS/scripts/helpers/clean-review-for-github.sh /home/teruel/JARVIS/reports/pr-reviews/<repo>-<number>.md)
gh pr review <number> --repo strokmatic/<repo> --approve --body "$CLEAN_BODY"
```
Ask the user whether to approve, request changes, or just comment before posting.

### "merge <repo> <number>" — Merge a PR
```bash
gh pr merge <number> --repo strokmatic/<repo> --merge
```
Always confirm with the user before merging.

## After running any command
- Show results to the user in a concise summary table
- If reviews were generated, show the verdict for each PR
- If posting to GitHub, confirm the action was successful
