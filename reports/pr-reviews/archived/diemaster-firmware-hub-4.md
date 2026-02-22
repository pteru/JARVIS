# PR Review: diemaster-firmware-hub#4
**Title:** release: merge develop into master
**Reviewed:** 2026-02-22T08:59:38-03:00
**Complexity:** complex

## Summary
This PR merges develop into master, promoting the feature branch that adds dynamic sensor discovery from Redis during boot-sync, centralizes hub configuration in `hub_config.h`, restores correct SPI chip-select mappings for all 10 SERCOMs, increases MQTT queue length from 5 to 20, and refactors sensor configuration from static arrays to runtime discovery. The changes span significant firmware architecture improvements with a 4-phase Redis boot-sync protocol.

## Findings

### Critical
1. **Hardcoded credentials in source code** (`hub_config.h:44`): Redis password `"SmartDie@@2022"` is hardcoded. This is flagged in the project's CLAUDE.md as a KNOWN ISSUE requiring HIGH priority remediation. Same credential appears in `app_mqtt_task.h:184`.

2. **Integer overflow risk in APP_ParseRedisBulkString** (`app.c:276-277`): The function calculates `len = strlen(data)` then truncates trailing characters, but `strlen()` on unterminated or malformed Redis responses could cause undefined behavior. The function doesn't validate that the bulk string length prefix matches actual content.

### Warnings
1. **Potential buffer overflow in logging** (`app.c:228-231`): `logging_success_f` uses variadic printf-style formatting without explicit bounds checking on the IP address format string.

2. **Missing timeout on Redis discovery phases** (`app.c:666-788`): The boot-sync state machine has no timeout mechanism for phases 0-3. If Redis returns malformed data or hangs mid-discovery, the firmware could block indefinitely in `APP_STATE_FETCH_REDIS_HASHES` or `APP_STATE_WAIT_REDIS_RESPONSE`.

3. **Sensor array index assumptions** (`app.c:299-318`, `app_mqtt_task.c:264-278`): The code assumes `g_sensor_configurations[i].sercom_id == i` when applying boot-sync values and building status payloads. While the boot-sync logic correctly populates the array, the indexing is valid only if sensors are discovered sequentially per SERCOM. If Redis discovery yields out-of-order results, indices could mismatch.

4. **Race condition potential** (`app.c:54-55`): `g_sensor_configurations[]` and `g_num_sensors` are accessed from multiple contexts (main task, MQTT task) without synchronization primitives. While FreeRTOS tasks may not preempt at certain points, this is fragile.

5. **Large static allocation** (`app_mqtt_task.h:67,176`): `MQTT_QUEUE_LENGTH=20` combined with `APP_MQTT_MAX_PUBLISH_MESSAGE_SIZE=64000` results in significant RAM usage for the MQTT publish buffer, which is allocated statically.

### Suggestions
1. **Add boot-sync timeout**: Implement a timeout (e.g., 10 seconds) for the entire boot-sync sequence that falls back to defaults if Redis is unreachable or slow.

2. **Validate Redis bulk string parsing**: Add bounds checking to verify that the length prefix in Redis RESP protocol matches actual content before processing.

3. **Document the boot-sync protocol**: The 4-phase Redis discovery protocol (phases 0-3) is clever but undocumented. A comment block explaining the state machine would improve maintainability.

4. **Consider bounds checking for status JSON builder**: The `(int)(buf_size - 80)` cast in the loop condition (`app_mqtt_task.c:220`) uses a magic number that should be documented or replaced with a constant.

## Verdict
**APPROVE WITH COMMENTS**

This is a promotion PR of code already reviewed in PR #3. The architectural improvements (dynamic sensor discovery, centralized configuration, CS mapping fix) are well-implemented and hardware-validated per the prior PR description. The MQTT queue increase is justified. However, the previously-flagged security findings (hardcoded credentials) should be addressed as follow-up work (already tracked as KNOWN ISSUE), and the Redis boot-sync timeout should be added to prevent startup hangs. No new issues beyond PR #3 were identified in this promotion.
