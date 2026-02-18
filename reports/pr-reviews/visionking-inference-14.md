The review is complete. Here's the full assessment:

---

# PR Review: visionking-inference#14

**Title:** fix: Shutdown graceful com watchdog event
**Reviewed:** 2026-02-18T11:56:09-03:00
**Complexity:** medium

## Summary

This PR replaces the previous `sys.exit(1)` hard-kill approach in the health watchdog with a cooperative shutdown via `asyncio.Event`. When a stall or high-RAM condition is detected, the watchdog sets `_shutdown_event`, which is awaited in `setup_and_run()` alongside the consumer task. The shutdown sequence then stops RabbitMQ consumption, runs `BatchProcessor.shutdown()` with bounded timeouts, and finally calls `os._exit(1)` to guarantee Docker restarts the container.

## Findings

### Critical

None

### Warnings

1. **`_shutdown_event` created before the event loop is guaranteed to exist** (`batch_processor.py:125`).
   `asyncio.Event()` must be instantiated in the same thread/loop that will run it. `BatchProcessor.__init__` is called synchronously before any `asyncio.run()`. On Python ≥ 3.10 there's no implicit loop binding so it's generally fine, but if tests or CLI helpers instantiate `BatchProcessor` without an active event loop and later run it in a separate thread, the `Event` will raise `RuntimeError`. Creating it lazily inside `async_setup()` or the first async method that uses it would be safer.

2. **`shutdown_signal_task` not cancelled on every exception path** (`inference_server.py:124–165`).
   When `consumer_task` completes first (normal SIGTERM), `shutdown_signal_task` ends up in `pending` and is cancelled — good. But if the code inside the `if shutdown_signal_task in done` block raises an exception, `shutdown_signal_task` leaks. A `try/finally` that cancels all pending tasks unconditionally would close this gap.

3. **Double `stop_consuming()` call on watchdog shutdown path** (`inference_server.py:120–127` and `~151`).
   When the watchdog fires, `stop_consuming()` is called with a 5s timeout in the watchdog-branch block, and then called again in the `finally` cleanup if the connection is still open. The second call is likely a no-op but could log spurious errors or add unnecessary delay. Factor it into a single guarded call.

### Suggestions

1. **Store shutdown reason for better post-mortem logs** — A `shutdown_reason: str` field on `BatchProcessor` set by `health_watchdog_worker` would let the final `os._exit(1)` log say "Pipeline stall (idle 310s)" or "RAM at 94%" instead of "stall or RAM threshold".

2. **Consider `os._exit(0)` for intentional RAM-triggered restarts** — Exit code 1 for both crashes and "soft" scheduled restarts makes it harder to distinguish them in Docker restart policies and monitoring dashboards.

3. **Automate the test plan** — A unit test that patches `time.time()` past `STALL_TIMEOUT` and asserts `_shutdown_event.is_set()` would cover the stall path without manual simulation.

## Verdict
**APPROVE WITH COMMENTS**

The core design is sound: replacing `sys.exit(1)` with cooperative event signaling is the correct approach for an asyncio service, and all cleanup paths are bounded with timeouts. The warnings are real but low-severity for the current deployment context. Safe to merge after the author is aware of the warnings.

---

Note: The review file could not be written to `/home/teruel/JARVIS/reports/pr-reviews/` (outside the sandbox) and write permission to the inference service directory was not granted. The review is presented inline above. You can copy it manually or grant write permission if you'd like it saved to disk.
