// Hermetic test suite for the notifier MCP server (mcp-servers/notifier/index.js).
//
// Strategy: spawn the real server as a child process with ORCHESTRATOR_HOME (and
// HOME, as a safety net for "~" token paths) pointed at a mkdtemp sandbox, then
// drive it over stdio JSON-RPC (initialize -> initialized -> tools/list ->
// tools/call). The server re-reads notifications.json and logs/inbox.json on
// every tool call, so a single child serves all subtests; each subtest writes
// the config shape it needs first.
//
// Structure note: everything runs inside ONE top-level test with sequential
// t.test() subtests and teardown in `finally`. Top-level before()/after() root
// hooks are NOT used — on Node 20.5 the root `after` hook never fires, which
// leaves the spawned server alive and hangs the test process.
//
// HERMETIC GUARANTEE — no network is ever attempted. Every exercised path was
// verified in the source to return BEFORE any fetch():
//   - send_notification: config.enabled=false / event disabled -> early return;
//     telegram enabled without bot_token/chat_id -> resolveRoute() legacy path
//     returns undefined creds and the guard at "Missing bot_token or chat_id in
//     config" runs before sendTelegram(); discord enabled without webhook_url
//     -> guard before sendDiscord(); bot_token_file pointing at a missing file
//     -> loadConfig() throws ENOENT inside the CallTool try/catch.
//   - test_notification: disabled backends and missing creds are checked before
//     any send.
//   - reply_telegram: resolveRoute() returns null when telegram is disabled.
//   - check_telegram_inbox: "inbound not enabled" and "no credentials" guards
//     run before the getUpdates fetch.
//
// SKIPPED (cannot be exercised hermetically):
//   - Successful sendTelegram / sendDiscord delivery (real fetch to
//     api.telegram.org / Discord webhook).
//   - check_telegram_inbox happy path: update polling, offset advance,
//     command parsing dispatch, inbox append, reply acks — all sit behind the
//     getUpdates fetch.
//   - Voice transcription (transcribeVoice) — behind Telegram getFile fetch.
//   - Pure helpers (formatTelegramMessage, escapeMarkdown, formatDuration,
//     classifyDuration, parseCommand) — only reachable after a valid route
//     (i.e. on the network path), and not unit-importable because index.js
//     instantiates and connects the server at module load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_PATH = path.join(REPO_ROOT, "mcp-servers", "notifier", "index.js");
const DEADLINE_MS = 10_000;

// ---------------------------------------------------------------------------
// Minimal newline-delimited JSON-RPC client over child stdio
// ---------------------------------------------------------------------------

function withDeadline(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Deadline (${DEADLINE_MS}ms) exceeded waiting for: ${label}`)),
      DEADLINE_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class McpClient {
  constructor(homeDir) {
    this.nextId = 1;
    this.pending = new Map();
    this.exited = false;
    this.child = spawn(process.execPath, [SERVER_PATH], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ORCHESTRATOR_HOME: homeDir,
        // Safety net: "~" in *_file config paths resolves inside the sandbox.
        HOME: homeDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.stderr = "";
    this.child.stderr.on("data", (c) => { this.stderr += c; });

    let buf = "";
    this.child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      }
    });

    this.child.on("exit", () => {
      this.exited = true;
      for (const [, resolve] of this.pending) {
        resolve({ error: { message: `server exited early. stderr: ${this.stderr}` } });
      }
      this.pending.clear();
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const response = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(payload);
    return withDeadline(response, method).then((msg) => {
      if (msg.error) throw new Error(`RPC error for ${method}: ${JSON.stringify(msg.error)}`);
      return msg.result;
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "notifier-test", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
    return result;
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    assert.ok(Array.isArray(result.content), `tools/call ${name} returned no content array`);
    assert.equal(result.content[0].type, "text");
    return result.content[0].text;
  }

  async kill() {
    if (this.exited) return;
    const gone = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.kill("SIGTERM");
    try {
      await withDeadline(gone, "child exit");
    } catch {
      this.child.kill("SIGKILL");
    }
  }
}

// ---------------------------------------------------------------------------
// Sandbox home helpers
// ---------------------------------------------------------------------------

let home;
let client;

const configPath = () => path.join(home, "config", "orchestrator", "notifications.json");
const registryPath = () => path.join(home, "config", "orchestrator", "telegram-bots.json");
const inboxPath = () => path.join(home, "logs", "inbox.json");
const notifLogPath = () => path.join(home, "logs", "notifications.json");

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    events: { task_completed: true, task_failed: true, task_started: true, task_timeout: true },
    duration_thresholds: { quick_max: 60, standard_max: 600, long_max: 1800 },
    backends: {
      telegram: { enabled: false },
      discord: { enabled: false },
    },
    ...overrides,
  };
}

async function writeConfig(config) {
  await writeFile(configPath(), JSON.stringify(config, null, 2), "utf-8");
}

const SEED_INBOX = [
  {
    id: "inbox_1000_1",
    telegram_message_id: 1,
    timestamp: "2026-07-01T10:00:00.000Z",
    text: "primeira mensagem seed",
    original_type: "text",
    status: "pending",
  },
  {
    id: "inbox_2000_2",
    telegram_message_id: 2,
    timestamp: "2026-07-01T11:00:00.000Z",
    text: "segunda mensagem seed",
    original_type: "voice",
    status: "read",
  },
];

// ---------------------------------------------------------------------------
// Suite — single top-level test, sequential subtests, teardown in finally
// ---------------------------------------------------------------------------

test("notifier MCP server (hermetic stdio suite)", { timeout: 120_000 }, async (t) => {
  home = await mkdtemp(path.join(os.tmpdir(), "notifier-test-"));
  await mkdir(path.join(home, "config", "orchestrator"), { recursive: true });
  await mkdir(path.join(home, "logs"), { recursive: true });
  await writeConfig(baseConfig());
  await writeFile(inboxPath(), JSON.stringify(SEED_INBOX, null, 2), "utf-8");

  client = new McpClient(home);

  try {
    const init = await client.initialize();
    assert.equal(init.serverInfo.name, "notifier");

    // -----------------------------------------------------------------------
    // (a) tools/list
    // -----------------------------------------------------------------------

    await t.test("tools/list exposes exactly the 5 expected tools", async () => {
      const result = await client.request("tools/list");
      const names = result.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        "check_telegram_inbox",
        "get_inbox",
        "reply_telegram",
        "send_notification",
        "test_notification",
      ]);
      const send = result.tools.find((tool) => tool.name === "send_notification");
      assert.deepEqual(send.inputSchema.required, ["event_type", "workspace", "message"]);
    });

    // -----------------------------------------------------------------------
    // (b) get_inbox — seeded state
    // -----------------------------------------------------------------------

    await t.test("get_inbox returns all seeded messages when unfiltered", async () => {
      const payload = JSON.parse(await client.callTool("get_inbox", {}));
      assert.equal(payload.count, 2);
      assert.deepEqual(payload.messages.map((m) => m.id), ["inbox_1000_1", "inbox_2000_2"]);
      assert.equal(payload.messages[0].text, "primeira mensagem seed");
    });

    await t.test("get_inbox filters by status", async () => {
      const payload = JSON.parse(await client.callTool("get_inbox", { status: "pending" }));
      assert.equal(payload.count, 1);
      assert.equal(payload.messages[0].id, "inbox_1000_1");
      assert.equal(payload.messages[0].status, "pending");
    });

    await t.test("get_inbox mark_read persists status change to disk", async () => {
      const payload = JSON.parse(
        await client.callTool("get_inbox", { status: "pending", mark_read: true }),
      );
      assert.equal(payload.count, 1);

      const onDisk = JSON.parse(await readFile(inboxPath(), "utf-8"));
      assert.deepEqual(onDisk.map((m) => m.status), ["read", "read"]);

      const again = JSON.parse(await client.callTool("get_inbox", { status: "pending" }));
      assert.equal(again.count, 0);
    });

    await t.test("get_inbox with empty/missing inbox file returns count 0", async () => {
      await rm(inboxPath(), { force: true });
      const payload = JSON.parse(await client.callTool("get_inbox", {}));
      assert.equal(payload.count, 0);
      assert.deepEqual(payload.messages, []);
    });

    // -----------------------------------------------------------------------
    // (c) send_notification — config-validation failures, no network
    // -----------------------------------------------------------------------

    await t.test("send_notification reports disabled-globally without touching backends", async () => {
      await writeConfig(baseConfig({ enabled: false }));
      const text = await client.callTool("send_notification", {
        event_type: "task_completed", workspace: "ws", message: "m",
      });
      assert.equal(text, "Notifications disabled globally");
    });

    await t.test("send_notification reports disabled event type", async () => {
      const cfg = baseConfig();
      cfg.events.task_started = false;
      await writeConfig(cfg);
      const text = await client.callTool("send_notification", {
        event_type: "task_started", workspace: "ws", message: "m",
      });
      assert.equal(text, 'Event "task_started" is disabled in config');
    });

    await t.test("send_notification: telegram enabled but unconfigured -> graceful error result, no crash", async () => {
      // Legacy route path: no bot_token / chat_id anywhere. The guard fires
      // before sendTelegram(), so no fetch is attempted.
      const cfg = baseConfig();
      cfg.backends.telegram = { enabled: true };
      await writeConfig(cfg);

      const payload = JSON.parse(await client.callTool("send_notification", {
        event_type: "task_completed", workspace: "ws", message: "hello", duration_seconds: 42,
      }));
      assert.deepEqual(payload.backends_notified, []);
      assert.equal(payload.errors.length, 1);
      assert.equal(payload.errors[0].backend, "telegram");
      assert.equal(payload.errors[0].error, "Missing bot_token or chat_id in config");
    });

    await t.test("send_notification appends an entry to logs/notifications.json", async () => {
      const log = JSON.parse(await readFile(notifLogPath(), "utf-8"));
      const last = log[log.length - 1];
      assert.equal(last.eventType, "task_completed");
      assert.equal(last.workspace, "ws");
      assert.equal(last.domain, "task-dispatch");
      assert.equal(last.category, "quick"); // 42s <= quick_max 60
      assert.deepEqual(last.backendsNotified, []);
      assert.equal(last.errors[0].backend, "telegram");
    });

    await t.test("send_notification: bot_token_file missing -> Error result, server stays alive", async () => {
      const cfg = baseConfig();
      cfg.backends.telegram = {
        enabled: true,
        bot_token_file: "~/.secrets/definitely-missing-token", // resolves inside sandbox HOME
        chat_id: "123",
      };
      await writeConfig(cfg);

      // loadConfig() throws ENOENT before any backend/fetch code runs; the
      // CallTool handler catches it and returns a text error result.
      const text = await client.callTool("send_notification", {
        event_type: "task_completed", workspace: "ws", message: "m",
      });
      assert.match(text, /^Error: /);
      assert.match(text, /ENOENT/);

      // Server did not crash: it still answers.
      const list = await client.request("tools/list");
      assert.equal(list.tools.length, 5);
    });

    await t.test("send_notification: discord enabled without webhook_url -> config error, no network", async () => {
      const cfg = baseConfig();
      cfg.backends.discord = { enabled: true };
      await writeConfig(cfg);

      const payload = JSON.parse(await client.callTool("send_notification", {
        event_type: "task_failed", workspace: "ws", message: "boom",
        metadata: { error: "stack trace here" },
      }));
      assert.deepEqual(payload.backends_notified, []);
      assert.deepEqual(payload.errors, [
        { backend: "discord", error: "Missing webhook_url in config" },
      ]);
    });

    await t.test("send_notification: bot-manager registry with unreadable token file falls back to legacy (still unconfigured)", async () => {
      const cfg = baseConfig({ bot_manager_enabled: true });
      cfg.backends.telegram = { enabled: true }; // no legacy creds either
      await writeConfig(cfg);
      await writeFile(registryPath(), JSON.stringify({
        default_bot: "main",
        bots: { main: { bot_token_file: "~/.secrets/missing-bot-token", default_chat_id: "999" } },
        domains: { "task-dispatch": { bot: "main" } },
      }), "utf-8");

      const payload = JSON.parse(await client.callTool("send_notification", {
        event_type: "task_completed", workspace: "ws", message: "m",
      }));
      // Registry token read fails -> resolveRoute falls back to legacy creds,
      // which are absent -> config-validation error before any fetch.
      assert.deepEqual(payload.backends_notified, []);
      assert.equal(payload.errors[0].error, "Missing bot_token or chat_id in config");
      await rm(registryPath(), { force: true });
    });

    // -----------------------------------------------------------------------
    // (d) test_notification / reply_telegram / check_telegram_inbox
    // -----------------------------------------------------------------------

    await t.test("test_notification backend=all with both backends disabled", async () => {
      await writeConfig(baseConfig());
      const results = JSON.parse(await client.callTool("test_notification", { backend: "all" }));
      assert.deepEqual(results, {
        telegram: { success: false, error: "Telegram backend is disabled" },
        discord: { success: false, error: "Discord backend is disabled" },
      });
    });

    await t.test("test_notification telegram enabled without creds -> missing-creds error, no network", async () => {
      const cfg = baseConfig();
      cfg.backends.telegram = { enabled: true };
      await writeConfig(cfg);
      const results = JSON.parse(await client.callTool("test_notification", { backend: "telegram" }));
      assert.deepEqual(results.telegram, { success: false, error: "Missing bot_token or chat_id" });
    });

    await t.test("reply_telegram with telegram disabled -> 'Telegram not configured'", async () => {
      await writeConfig(baseConfig());
      const payload = JSON.parse(await client.callTool("reply_telegram", { message: "oi" }));
      assert.deepEqual(payload, { success: false, error: "Telegram not configured" });
    });

    await t.test("check_telegram_inbox with inbound disabled -> early error, no polling", async () => {
      const cfg = baseConfig();
      cfg.backends.telegram = { enabled: true, bot_token: "not-used", chat_id: "1" }; // inbound absent
      await writeConfig(cfg);
      const payload = JSON.parse(await client.callTool("check_telegram_inbox", {}));
      assert.deepEqual(payload, { error: "Telegram inbound not enabled" });
    });

    await t.test("check_telegram_inbox with inbound enabled but no creds -> credentials error before fetch", async () => {
      const cfg = baseConfig();
      cfg.backends.telegram = { enabled: true, inbound: { enabled: true } }; // no token/chat_id
      await writeConfig(cfg);
      const payload = JSON.parse(await client.callTool("check_telegram_inbox", {}));
      assert.deepEqual(payload, { error: "No Telegram credentials for inbound domain" });
    });

    await t.test("unknown tool name returns an Error text result, not a crash", async () => {
      const text = await client.callTool("no_such_tool", {});
      assert.equal(text, "Error: Unknown tool: no_such_tool");
    });
  } finally {
    await client.kill();
    await rm(home, { recursive: true, force: true });
  }
});
