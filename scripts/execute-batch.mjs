#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "claude-orchestrator");

const DISPATCHES_PATH = path.join(ORCHESTRATOR_HOME, "logs", "dispatches.json");
const LOCKS_PATH = path.join(ORCHESTRATOR_HOME, "logs", "workspace-locks.json");

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// --- Atomic file helpers ---

async function readJSON(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function writeJSONAtomic(filePath, data) {
  const tmp = filePath + `.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

// --- Workspace locking ---

async function loadLocks() {
  try {
    return await readJSON(LOCKS_PATH);
  } catch {
    return {};
  }
}

async function saveLocks(locks) {
  await fs.mkdir(path.dirname(LOCKS_PATH), { recursive: true });
  await writeJSONAtomic(LOCKS_PATH, locks);
}

async function acquireLock(workspace) {
  const locks = await loadLocks();
  const existing = locks[workspace];
  if (existing) {
    const age = Date.now() - new Date(existing.locked_at).getTime();
    if (age < LOCK_TIMEOUT_MS) {
      return false; // Still locked
    }
    // Stale lock, override
  }
  locks[workspace] = { locked_at: new Date().toISOString(), pid: process.pid };
  await saveLocks(locks);
  return true;
}

async function releaseLock(workspace) {
  const locks = await loadLocks();
  delete locks[workspace];
  await saveLocks(locks);
}

// --- Dispatch helpers ---

async function loadDispatches() {
  return await readJSON(DISPATCHES_PATH);
}

async function updateDispatchStatus(dispatchId, status, extra = {}) {
  const dispatches = await loadDispatches();
  const d = dispatches.find((r) => r.id === dispatchId);
  if (!d) return;

  const now = new Date().toISOString();
  d.status = status;
  d.updated_at = now;

  if (status === "running" && !d.started_at) {
    d.started_at = now;
  }
  if (status === "complete" || status === "failed") {
    d.completed_at = now;
  }
  if (extra.error_message) {
    d.error_message = extra.error_message;
  }

  if (d.status_history) {
    d.status_history.push({
      status,
      timestamp: now,
      note: extra.note || `Status changed to ${status}`,
    });
  }

  await writeJSONAtomic(DISPATCHES_PATH, dispatches);
}

async function updateBatchRecord(batchId, updates) {
  const dispatches = await loadDispatches();
  const batch = dispatches.find((r) => r.id === batchId && r.type === "batch");
  if (!batch) return;

  Object.assign(batch, updates);
  await writeJSONAtomic(DISPATCHES_PATH, dispatches);
}

// --- Execute a single dispatch ---

function executeDispatch(dispatch, logDir) {
  return new Promise((resolve) => {
    const logFile = path.join(logDir, `${dispatch.id}.log`);
    const args = ["--model", dispatch.model, "--print", dispatch.task];

    const child = spawn("claude", args, {
      cwd: dispatch.workspace_path,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    activeChildren.add(child);

    let output = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });

    child.on("close", async (code) => {
      activeChildren.delete(child);

      // Write log
      try {
        await fs.writeFile(logFile, output, "utf-8");
      } catch (e) {
        console.error(`Failed to write log for ${dispatch.id}:`, e.message);
      }

      if (code === 0) {
        resolve({ success: true, dispatch });
      } else {
        resolve({ success: false, dispatch, error: `Exit code ${code}` });
      }
    });

    child.on("error", async (err) => {
      activeChildren.delete(child);
      try {
        await fs.writeFile(logFile, `Spawn error: ${err.message}\n${output}`, "utf-8");
      } catch { /* ignore */ }
      resolve({ success: false, dispatch, error: err.message });
    });
  });
}

// --- Main ---

const activeChildren = new Set();

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("Usage: execute-batch.mjs <batch_id>");
    process.exit(1);
  }

  const dispatches = await loadDispatches();
  const batch = dispatches.find((r) => r.id === batchId && r.type === "batch");
  if (!batch) {
    console.error(`Batch ${batchId} not found`);
    process.exit(1);
  }

  const batchDispatches = dispatches.filter(
    (d) => d.batch_id === batchId && d.type !== "batch" && d.status === "pending",
  );

  if (batchDispatches.length === 0) {
    console.error("No pending dispatches in batch");
    process.exit(0);
  }

  const maxParallel = batch.max_parallel || 4;
  const logDir = path.join(ORCHESTRATOR_HOME, "logs", batchId);
  await fs.mkdir(logDir, { recursive: true });

  // Update batch status to running
  await updateBatchRecord(batchId, { status: "running" });
  console.log(`Starting batch ${batchId}: ${batchDispatches.length} tasks, max ${maxParallel} parallel`);

  // Signal handling
  let cancelled = false;

  const cleanup = async () => {
    cancelled = true;
    console.log("\nCancelling batch...");
    for (const child of activeChildren) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
    // Mark remaining pending dispatches as failed
    for (const d of batchDispatches) {
      if (d.status === "pending" || d.status === "running") {
        await updateDispatchStatus(d.id, "failed", {
          error_message: "Batch interrupted by signal",
          note: "Interrupted",
        });
        await releaseLock(d.workspace);
      }
    }
    await updateBatchRecord(batchId, { status: "cancelled" });
    process.exit(1);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Semaphore-based parallel execution
  let active = 0;
  let idx = 0;
  let completed = 0;
  let failed = 0;

  await new Promise((resolveAll) => {
    const tryNext = async () => {
      while (active < maxParallel && idx < batchDispatches.length && !cancelled) {
        const dispatch = batchDispatches[idx++];

        // Try to acquire workspace lock (with retry wait)
        let locked = await acquireLock(dispatch.workspace);
        if (!locked) {
          // If workspace is locked, defer this dispatch to end
          batchDispatches.push(dispatch);
          continue;
        }

        active++;
        await updateDispatchStatus(dispatch.id, "running", {
          note: "Batch execution started",
        });

        console.log(`[${completed + failed + active}/${batchDispatches.length}] Running: ${dispatch.workspace} (${dispatch.model})`);

        executeDispatch(dispatch, logDir).then(async (result) => {
          active--;
          await releaseLock(result.dispatch.workspace);

          if (result.success) {
            await updateDispatchStatus(result.dispatch.id, "complete", {
              note: "Batch execution completed",
            });
            completed++;
            console.log(`  DONE: ${result.dispatch.workspace}`);
          } else {
            await updateDispatchStatus(result.dispatch.id, "failed", {
              error_message: result.error,
              note: "Batch execution failed",
            });
            failed++;
            console.log(`  FAIL: ${result.dispatch.workspace} - ${result.error}`);
          }

          if (completed + failed === batchDispatches.length) {
            resolveAll();
          } else {
            tryNext();
          }
        });
      }

      // If nothing was started and nothing active, we're done
      if (active === 0 && idx >= batchDispatches.length) {
        resolveAll();
      }
    };

    tryNext();
  });

  // Final batch update
  const finalStatus = failed > 0 ? "completed_with_failures" : "completed";
  await updateBatchRecord(batchId, {
    status: finalStatus,
    tasks_completed: completed,
    tasks_failed: failed,
    tasks_pending: 0,
  });

  console.log(`\nBatch ${batchId} finished: ${finalStatus} (${completed} ok, ${failed} failed)`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
