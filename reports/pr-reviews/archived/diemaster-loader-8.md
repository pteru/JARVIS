# PR Review: diemaster-loader#8
**Title:** feat: write per-port discovery keys for hub firmware boot-sync
**Reviewed:** 2026-02-20T16:45:08-03:00
**Complexity:** simple

## Summary
Adds per-port discovery key generation in Redis for hub firmware boot-sync functionality. When loading sensor data, the loader now writes `{hub_name}:port:{n}` hashes containing sensor ID and type for each SERCOM port, with legacy port value 10 normalized to port 0. Old port keys are cleared before writing new ones on each die load.

## Findings

### Critical
None

### Warnings
- **Redundant sensortype_id check**: The code calls `SENSOR_TYPE_MAP.get(sensortype_id, "draw-in")` (which has a built-in default) then immediately checks `if sensortype_id not in SENSOR_TYPE_MAP` and logs a warning. The warning will never trigger for the default case since the mapping already handles unknown IDs. Simplify by removing the explicit check or restructure to avoid the redundancy.

### Suggestions
- **Port overwrite behavior**: If multiple sensors map to the same port via `hub_port % 10`, the last sensor wins (hash overwrite). Document whether this is expected or if sensors should have unique port assignments.
- **Test coverage**: PR description lists manual test steps but no automated tests added. Consider adding a unit test for the port normalization logic (10→0 conversion, invalid values) if a test framework exists.
- **Type mapping extensibility**: Consider moving `SENSOR_TYPE_MAP` to configuration (env var or config file) for easier updates without code changes.

## Verdict
APPROVE WITH COMMENTS

The core functionality is sound: port normalization is correct, error handling is appropriate, and the Redis operations are safe. The redundant sensortype_id check is minor and doesn't affect correctness. The feature correctly implements the prerequisite for hub firmware boot-sync discovery. Approve once the redundant check is cleaned up (can be trivial fix).
