## PR Review: diemaster-status#9

**Title:** chore: merge develop into master — single-DB routing + mirror flag
**Author:** viniciussotero
**Size:** +55/-41, 2 files
**Reviewed:** 2026-02-18

### Summary

Refactors Redis configuration from hardcoded dual-DB writes (DB3 + DB5) to a single configurable primary DB with optional mirror. Incorporates all fixes from PR #8 (which addressed #7 review findings):

- Hardcoded production credentials replaced with safe defaults (`localhost`, `guest`, empty password)
- Unused `sensor_id` parameter removed from `limpar_hashes()` and `aplicar_ttl()`
- Redis DB validation at startup (0-15 range check)
- `MIRROR_ENABLED` flag controls optional second DB write
- Per-message log demoted from `info` to `debug`
- `STATUS_QUEUE` now configurable via env var

### Findings

**Critical:** None

**Warnings:**

1. **Credential exposure in `smartdie-status.yml`** — `REDIS_PASSWORD=SmartDie@@2022` and `REDIS_PORT=4000` are still hardcoded in the compose file (lines 24-26). This undermines the safe defaults in the Python code. Should use `.env` file or variable substitution (`${REDIS_PASSWORD}`).

2. **`limpar_hashes()` is never called** — The function was refactored (signature simplified) but still has no callers anywhere. Dead code — should be removed or wired into a cleanup path.

**Suggestions:**

1. Consider wrapping mirror writes in try-except with distinct logging so mirror failures don't silently go unnoticed.
2. Log message still uses Portuguese ("com sucesso!") — minor, but worth standardizing if the codebase moves to English logging.

### Verdict: **APPROVE WITH COMMENTS**

The core refactoring is solid — configurable single-DB with optional mirror is a clean improvement over the hardcoded dual-DB approach. The compose credential issue is a pre-existing problem, not introduced by this PR. Safe to merge; compose cleanup can be a follow-up task.
