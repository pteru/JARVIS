Let me display the review for you instead, since I'm restricted from writing to most directories:

---

# PR Review: diemaster-status#7

**Title:** chore: merge develop into master — single-DB routing + DB2 mirror
**Reviewed:** 2026-02-18T12:00:00-03:00
**Complexity:** medium

## Summary

This PR refactors the DieMaster status service to consolidate dual-database writes (DB3+DB5) into a single configurable `REDIS_STATUS_DB` with optional mirroring to `REDIS_MIRROR_DB`. It improves flexibility by making `STATUS_QUEUE` configurable via environment variables and modernizes function signatures to accept dynamic database lists instead of hardcoded multiple parameters.

## Findings

### Critical

1. **Function Signature Mismatch - `aplicar_ttl()` Not Updated**
   - **Location:** Line 117 (original code) 
   - **Issue:** The old code calls `aplicar_ttl(redis_db3, redis_db5, sensor_id)` but the new signature becomes `aplicar_ttl(target_dbs, sensor_id)` (2 params instead of 3)
   - **Impact:** Function calls at lines 116 and 125 in `processar_mensagem` will fail with `TypeError: aplicar_ttl() takes 2 positional arguments but 3 were given`
   - **Fix Required:** Remove the unused `sensor_id` parameter from ALL `aplicar_ttl()` calls
   - **Severity:** ⚠️ **RUNTIME FAILURE** — Every message will error

2. **Hardcoded Credentials Exposure**
   - **Location:** Lines 27-28
   - **Issue:** RabbitMQ password `SmartDie@@2022` is hardcoded as default fallback
   - **Context:** Directly conflicts with CLAUDE.md HIGH priority: "Hardcoded credentials exist in 10+ locations — remediation is HIGH priority"
   - **Fix Required:** Remove default or use secure credential management
   - **Severity:** ⚠️ **SECURITY VULNERABILITY** (OWASP A07:2021 - Identification & Authentication Failures)

3. **Unused Function Parameters**
   - **Location:** `limpar_hashes(target_dbs, sensor_id)` — `sensor_id` is never used
   - **Issue:** Dead parameter indicates incomplete refactoring
   - **Fix Required:** Remove `sensor_id` from signature and all calls

### Warnings

1. **Removed Backwards Compatibility Without Migration Path**
   - **Location:** Env var renaming (REDIS_DB3/REDIS_DB5 → REDIS_STATUS_DB/REDIS_MIRROR_DB)
   - **Issue:** Existing deployments using old names will silently fall back to defaults, creating hidden misconfigurations
   - **Risk:** Operators may miss the need to update their docker-compose/K8s manifests

2. **Missing Retry/Timeout Handling in Redis Connection**
   - **Location:** `conectar_redis()` function
   - **Issue:** If Redis is temporarily unavailable during startup, the service crashes immediately with no retry
   - **Note:** Pre-existing issue, but worth hardening

3. **Potential Log Message Duplication**
   - **Location:** Line 116 "Dados escritos no Redis" appears to be logged per-message
   - **Suggestion:** Keep startup log, remove per-message log to avoid spam

### Suggestions

1. **Validate Redis DB Number Range**
   ```python
   REDIS_STATUS_DB = int(os.getenv("REDIS_STATUS_DB", 3))
   if not 0 <= REDIS_STATUS_DB <= 15:
       raise ValueError(f"REDIS_STATUS_DB out of range: {REDIS_STATUS_DB}")
   ```

2. **Clarify Mirror Configuration**
   - Rename `MIRROR_TO_DB2` → `MIRROR_ENABLED` (the name suggests it mirrors to DB2 specifically, but actually uses `REDIS_MIRROR_DB`)

3. **Verify Test Coverage**
   - No test files changed in the diff
   - `processar_mensagem()` signature changed significantly (4 individual dbs → dynamic list)
   - Ensure unit tests validate the new function signatures

4. **Improve Exception Handling**
   - Current: `auto_ack=True` + exception handling = silent message loss
   - Consider: Dead-letter queues or retry mechanism for failed messages

## Verdict

### **CHANGES REQUESTED** ❌

#### Justification

The PR refactoring is a good design improvement (consolidating 4 hardcoded DB parameters into flexible lists), but it introduces **3 blocking issues**:

1. **Critical Bug:** `aplicar_ttl()` function calls don't match the new signature — every message will fail
2. **Security Debt:** Hardcoded credentials directly contradict the project's HIGH priority remediation plan
3. **Incomplete Refactoring:** Unused `sensor_id` parameters indicate the changes weren't fully tested

**Before merge, required changes:**
- [ ] Fix `aplicar_ttl(target_dbs, sensor_id)` calls (remove 3rd argument)
- [ ] Remove hardcoded RabbitMQ password default
- [ ] Remove unused `sensor_id` parameter from `limpar_hashes()`  
- [ ] Run and verify all unit tests pass
- [ ] Document env var renaming or provide migration path

Once these are fixed, the refactoring is solid and improves maintainability.

---

**Summary for GitHub PR comment:**
The refactoring improves configuration flexibility, but introduces a critical bug: `aplicar_ttl()` function calls pass 3 arguments when the new signature accepts 2, causing runtime failures on every message. Additionally, hardcoded credentials conflict with the project's security remediation priorities. These must be fixed before merge.
