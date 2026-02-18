Let me output the review directly to the user instead:

## PR Review: visionking-inference#14

**Title:** fix: Shutdown graceful com watchdog event  
**Reviewed:** 2026-02-18T14:45:00Z  
**Complexity:** medium

### Summary
This PR implements graceful shutdown mechanisms for the InferenceServer when health monitoring detects critical failures (pipeline stall or excessive RAM usage). Instead of abruptly calling `sys.exit(1)` from the watchdog, it introduces an `asyncio.Event` to signal shutdown, allowing proper cleanup of resources including batch processor state and RabbitMQ connections. After cleanup completes, `os._exit(1)` forces process termination to ensure Docker container restart.

### Findings

#### Critical
1. **Race condition in shutdown sequence (inference_server.py:149-152)**: After cancelling `consumer_task`, the code awaits it to handle `CancelledError`. However, subsequent resource cleanup (lines 154-160) may attempt operations on a consumer being cancelled, potentially causing double-close or resource leak.
   - **Fix**: Ensure consumer cleanup is idempotent or use `asyncio.shield()`.

2. **Signal potentially lost if listener not ready**: The watchdog returns after setting `_shutdown_event`, but if `wait_for_shutdown_signal()` hasn't started polling yet, the signal is lost.
   - **Fix**: Add explicit logging when shutdown is triggered; ensure `wait_for_shutdown_signal()` launches before watchdog.

3. **Orphaned asyncio tasks during forced exit**: When `asyncio.wait([consumer_task, shutdown_signal_task], ...)` completes, pending tasks are cancelled but not awaited for cleanup. Tasks with `finally` blocks may not execute before `os._exit(1)`.
   - **Fix**: Use `asyncio.gather(*pending_tasks, return_exceptions=True)` after cancelling to ensure cleanup.

#### Warnings
- **Import change: `sys` → `os`**: Removing `sys` import assumes it's not used elsewhere. Should verify before removing.
- **Sequential timeout stacking**: 10s (batch processor) + 5s + 5s (RabbitMQ) = 20s total, exceeds Docker's 10s default `--stop-timeout`. Container may be force-killed mid-cleanup.
  - **Fix**: Use aggregate timeout ~5-8s for all cleanup combined.
- **Timeout warnings are silent**: RabbitMQ timeouts don't escalate; underlying connectivity issues could be masked.
- **Watchdog continues logging during shutdown**: After `_shutdown_event` is set, redundant monitoring logs appear. Add early exit to watchdog loop for cleaner shutdown.

#### Suggestions
- No integration tests present for shutdown flow; add tests for stall/RAM scenarios.
- Document the shutdown contract (watchdog → signal → cleanup → force exit) in docstrings.
- Remove redundant `shutdown_requested` check (always true at that point).
- Add environment variables for timeouts: `SHUTDOWN_TIMEOUT`, `RABBITMQ_STOP_TIMEOUT`, `RABBITMQ_CLOSE_TIMEOUT`.

### Verdict
**APPROVE WITH COMMENTS**

The core fix is sound: replacing `sys.exit()` with graceful event signaling allows proper resource cleanup. However, address the race condition in task cancellation and Docker timeout alignment before production. The other findings are best practices that strengthen production resilience.
