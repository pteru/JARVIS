I've completed the PR review. The review file could not be written to the requested location `/home/teruel/JARVIS/reports/pr-reviews/diemaster-infra-setup-1.md` because it's outside my allowed working directory. Here's the complete review:

---

# PR Review: diemaster-infra-setup#1
**Title:** Feat schema completo e lógica batch  
**Reviewed:** 2026-02-18T10:29:51-03:00  
**Complexity:** complex

## Summary
This PR expands the database schema to include `site`, `line`, `press`, and `batch` tables, implementing a hierarchical organizational structure. It replaces all boolean `is_deleted` columns with `deleted_at` timestamps for proper soft-delete audit trails, converts all `timestamp` columns to `timestamptz` for timezone awareness, and adds a sophisticated batch assignment system via a trigger that automatically groups consecutive panels from the same die into batches.

## Findings

### Critical

1. **Race condition in batch determination trigger** (`trg_panel_determine_batches_on_insert.sql:1-36`)
   - The `FOR EACH ROW` trigger calls `determine_and_insert_batches()` which performs complex queries and updates across multiple rows. In high-throughput scenarios with concurrent panel inserts, this can cause deadlocks or incorrect batch assignments.
   - **Recommendation:** Consider using an `AFTER INSERT` statement-level trigger with `DEFERRABLE INITIALLY DEFERRED` or an async batch processing approach for production workloads.

2. **Hardcoded default press_id in trigger** (`trg_panel_determine_batches_on_insert.sql:8-9`)
   ```sql
   v_default_press_id INTEGER := 1;
   ```
   - This assumes press_id=1 always exists and is correct for all new batches. This will cause errors if press_id=1 doesn't exist, or silently assign panels to the wrong press in multi-press environments.
   - **Recommendation:** Either remove the hardcode and require the press to be determined from batch history only, or make this configurable via a table/setting.

3. **Missing newline at end of file** (`determine_and_insert_batches.sql:205`, `schema.sql:197`, `trg_panel_determine_batches_on_insert.sql:36`)
   - Multiple files missing final newline.

### Warnings

1. **README documentation error** (`README.md:63`)
   - This line incorrectly states that `first_insert_die_sensor_hub.sql` contains the trigger. The trigger is actually in `trg_panel_determine_batches_on_insert.sql`.

2. **Exception handling swallows errors** (`determine_and_insert_batches.sql:265-267`)
   - Catching all exceptions and downgrading to WARNING means batch creation failures may go unnoticed.

3. **Sentinel value `-999` for NULL press_id comparison** (`determine_and_insert_batches.sql:200`)
   - Using magic number `-999` as a sentinel for NULL is fragile.

4. **No migration strategy for existing data**
   - The schema changes don't include a migration script for existing production data.

5. **Behavior change: acquisition function no longer updates die/sensor metadata** (`insert_acquisition_function.sql`)
   - The function now only warns on mismatches instead of updating `switch_name`, `switch_ip`, and `hub_port`. This is a breaking change.

### Suggestions

1. Add composite index on `batch(die_id, end_timestamp DESC)` for frequent query pattern
2. Consider partial unique index for panels to prevent soft-deleted duplicates
3. Add CHECK constraint: `start_timestamp <= end_timestamp` on batch table
4. Document required transaction isolation level for batch determination
5. Add unique constraint on `(sensor_name, hub_id, die_id)`

## Verdict
**CHANGES REQUESTED**

The architectural improvements are well-designed, but the hardcoded `press_id=1` and potential race condition are production blockers. The README error should also be fixed.

---

Would you like me to write this to a different location, or should I post this review directly on the PR via `gh pr review`?
