Let me output the review to the user instead:

---

# PR Review: diemaster-status#4
**Title:** feat: single configurable DB + optional DB2 mirror
**Reviewed:** 2026-02-18T11:02:12-03:00
**Complexity:** simple

## Summary
This PR refactors hardcoded dual-DB writes (DB3 + DB5) into a single configurable `REDIS_STATUS_DB` environment variable with an optional `MIRROR_TO_DB2` flag. It also makes `STATUS_QUEUE` configurable, enabling per-matrix deployment scenarios without code changes. The refactoring simplifies the codebase while maintaining backward compatibility through sensible defaults.

## Findings

### Critical
None

### Warnings

1. **Hardcoded credentials remain in codebase**
   - Default credentials for RabbitMQ (`SmartDie@@2022`) and Redis (`SmartDie@@2022`) are still hardcoded in lines 28, 34
   - These should be environment variables only with no defaults in source code
   - **Context:** DieMaster CLAUDE.md notes hardcoded credentials in 10+ locations as HIGH priority remediation

2. **Logger output exposes internal connection pool details**
   - Lines accessing `db.connection_pool.connection_kwargs['db']` couple log output to redis-py internals
   - A more robust approach: pass DB numbers to `processar_mensagem()` as simple integers or track them separately
   - **Risk:** If redis-py changes its connection pool API, this could break at runtime

3. **MIRROR_TO_DB2 defaults to "false" but DB2 remains hardcoded**
   - While `MIRROR_TO_DB2` is configurable, `REDIS_DB2 = 2` is hardcoded
   - For full flexibility, consider: `REDIS_MIRROR_DB = os.getenv("REDIS_MIRROR_DB", "2")`
   - Current approach couples mirror functionality to DB2 specifically

4. **Unused code path**
   - The `limpar_hashes()` function is defined but never called in either version
   - Indicates incomplete cleanup or commented-out functionality

### Suggestions

1. **Log message formatting improvement**
   - Instead of accessing `connection_pool.connection_kwargs['db']`, track DB numbers explicitly:
     ```python
     db_targets = [REDIS_STATUS_DB]
     if MIRROR_TO_DB2:
         db_targets.append(REDIS_DB2)
     db_names = ", ".join(f"DB{db}" for db in db_targets)
     logger.info(f"Writing to Redis: {db_names}")
     ```

2. **Future enhancement: per-DB TTL configuration**
   - Currently `TTL_EXPIRATION` applies uniformly to all DBs
   - If future deployments need different TTLs, consider a `REDIS_TTL_<DB>` pattern

3. **Test coverage**
   - The manual test plan is good — consider automating these as integration tests

## Verdict
**APPROVE WITH COMMENTS**

The PR successfully achieves its goals of making DB selection and queue naming configurable while maintaining backward compatibility. The refactoring is clean, defaults are sensible, and the `target_dbs` list approach is elegant.

**Action items before merge:**
1. **Critical:** Address hardcoded credentials per DieMaster's security roadmap
2. **Recommended:** Consider making mirror target DB configurable for consistency
3. **Nice-to-have:** Simplify logger output to avoid coupling to redis-py internals

The functional logic is sound and correct. Ready to merge once hardcoded credentials are addressed.
