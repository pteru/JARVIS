# PR Review: diemaster-firmware-hub#3
**Title:** feat: boot sync, CS mapping fix, MQTT queue increase
**Reviewed:** 2026-02-20T16:45:08-03:00
**Complexity:** complex

## Summary
This PR adds dynamic sensor discovery from Redis during boot-sync, centralizes hub configuration in `hub_config.h`, restores correct SPI chip-select mappings for all 10 SERCOMs, increases MQTT queue length from 5 to 20 to prevent dropped sensor data, and adds proper `.gitignore` to exclude build artifacts. The changes span 12 commits with significant firmware architecture improvements including a 4-phase Redis boot-sync protocol (discover id → discover type → settings → acq_rate).

## Findings

### Critical
1. **Hardcoded credentials in source code** (`hub_config.h:44`): Redis password `"SmartDie@@2022"` is hardcoded. This is flagged in the project's CLAUDE.md as a KNOWN ISSUE requiring HIGH priority remediation. Same credential appears in `app_mqtt_task.h:184`.

2. **Integer overflow risk in APP_ParseRedisBulkString** (`app.c:276-277`): The function calculates `len = strlen(data)` then truncates trailing characters, but `strlen()` on unterminated or malformed Redis responses could cause undefined behavior. The function doesn't validate that the bulk string length prefix matches actual content.

### Warnings
1. **Potential buffer overflow in logging** (`app.c:228-231`): `logging_success_f` uses variadic printf-style formatting without explicit bounds checking on the IP address format string.

2. **Missing timeout on Redis discovery phases** (`app.c:666-788`): The boot-sync state machine has no timeout mechanism for phases 0-3. If Redis returns malformed data or hangs mid-discovery, the firmware could block indefinitely in `APP_STATE_FETCH_REDIS_HASHES` or `APP_STATE_WAIT_REDIS_RESPONSE`.

3. **Sensor array index assumptions** (`app.c:299-318`, `app_mqtt_task.c:264-278`): The code assumes `g_sensor_configurations[i].sercom_id == i` but this is only true if sensors are discovered in SERCOM order. If Redis reports sensors out of order, the array index used to access `all_drawin_sensors[i]` and `all_gap_sensors[i]` may not match the intended SERCOM.

4. **Race condition potential** (`app.c:54-55`): `g_sensor_configurations[]` and `g_num_sensors` are accessed from multiple contexts (main task, MQTT task) without synchronization primitives. While FreeRTOS tasks may not preempt each other at certain points, this is fragile.

5. **Large static allocation** (`app_mqtt_task.h:67,176`): `MQTT_QUEUE_LENGTH=20` combined with `APP_MQTT_MAX_PUBLISH_MESSAGE_SIZE=64000` results in significant RAM usage for the MQTT publish buffer, which is allocated statically.

### Suggestions
1. **Add boot-sync timeout**: Consider adding a timeout (e.g., 10 seconds) for the entire boot-sync sequence that falls back to defaults if Redis is unreachable or slow.

2. **Validate Redis bulk string parsing**: Add bounds checking to verify that the length prefix in Redis RESP protocol matches actual content before processing.

3. **Refactor status JSON builder** (`app_mqtt_task.c:226`): The `(int)` cast in the loop condition `i < (int)(buf_size - 80)` could be simplified and the magic number `80` documented.

4. **Consider using const for sensor config pointer** (`app_sensors.c:241`): Already correct, but could benefit from a `restrict` qualifier for optimization hints.

5. **Document the boot-sync protocol**: The 4-phase Redis discovery protocol (phases 0-3) is clever but undocumented. A comment block explaining the state machine would help maintainability.

## Verdict
**APPROVE WITH COMMENTS**

The architectural improvements (dynamic sensor discovery, centralized configuration, CS mapping fix) are well-implemented and hardware-validated per the PR description. The MQTT queue increase is well-justified with clear reasoning in the commit message. However, the hardcoded credentials should be addressed as a follow-up (already tracked as a known issue), and the Redis boot-sync timeout should be added to prevent startup hangs. The code quality is good with proper error handling patterns, but the security findings should be tracked for remediation.
