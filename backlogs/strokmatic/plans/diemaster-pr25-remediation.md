# PR #25/#37 Review Remediation — Execution Plan

## Summary

Fix 6 remaining issues from the DieMaster frontend/backend PR reviews. Two sandbox dispatches (one per repo), running in parallel.

## Prerequisites

1. Commit both spec files to JARVIS `develop` so sandbox can access them
2. Verify both target repos are on latest `develop`

## Step 1: Dispatch Backend Sandbox

```bash
./scripts/sandbox.sh \
  --task "Fix 3 review items: remove JWT guard from ProductionController, revert onModuleInit to fire-and-forget, remove debugDatabaseTables" \
  --spec backlogs/plans/pr25-review-remediation-backend.md \
  --branch fix/pr25-review-remediation \
  --base-branch develop \
  --model sonnet \
  --memory 4g \
  --timeout 15m \
  --workspace strokmatic.diemaster.services.backend
```

**Expected output**: 1 commit, 3 file changes (production.controller.ts, production.service.ts)

## Step 2: Dispatch Frontend Sandbox (parallel)

```bash
./scripts/sandbox.sh \
  --task "Fix 3 review items: XSS in PDF export, broken report specs, guest 401 silent failure" \
  --spec backlogs/plans/pr25-review-remediation-frontend.md \
  --branch fix/pr25-review-remediation \
  --base-branch develop \
  --model sonnet \
  --memory 6g \
  --cpus 4 \
  --timeout 20m \
  --workspace strokmatic.diemaster.services.frontend
```

**Expected output**: 1 commit, 4-5 file changes (reports-content.component.ts, 3x spec.ts, error-catching.interceptor.ts)

## Step 3: Review Patches

1. Read sandbox reports from `reports/sandbox/`
2. Review generated patches
3. Apply patches to respective repos
4. Push fix branches and open PRs

## Step 4: Verification

After applying patches:
- Backend: `npm run build` passes, no TypeScript errors
- Frontend: `npm run build` and `npm run test:ci` pass
- Manual check: guest flow works end-to-end (no 401, dashboard loads data)
