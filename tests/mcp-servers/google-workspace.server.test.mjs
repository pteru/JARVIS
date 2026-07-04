/**
 * Hermetic contract tests for the google-workspace MCP server.
 *
 * REGRESSION NET for the upcoming split of mcp-servers/google-workspace/index.js
 * (2,543 lines) into per-service modules. These tests lock the externally
 * visible contract: the full tool-name set, representative input schemas,
 * graceful auth-failure behavior, and unknown-tool handling.
 *
 * Hermetic guarantees:
 *  - The server child process gets ORCHESTRATOR_HOME pointed at a mkdtemp
 *    directory, so SERVICE_ACCOUNT_PATH / OAUTH_CONFIG_PATH / OAUTH_TOKENS_PATH
 *    all resolve inside the temp home (index.js derives every credential path
 *    from ORCHESTRATOR_HOME via ../lib/config-loader.js; it never reads
 *    GOOGLE_APPLICATION_CREDENTIALS or any absolute repo path — verified by
 *    grep). GOOGLE_APPLICATION_CREDENTIALS is overridden anyway as
 *    belt-and-suspenders so googleapis ADC lookup can never find real creds.
 *  - No network I/O: every tools/call exercised here fails inside
 *    AuthManager BEFORE any googleapis client is constructed:
 *      service_account -> fs.readFile(SERVICE_ACCOUNT_PATH) throws ENOENT,
 *                         or JSON.parse throws on a garbage file;
 *      oauth2          -> fs.readFile(OAUTH_CONFIG_PATH) throws ENOENT;
 *      google_oauth_callback -> exchangeCode reads OAUTH_CONFIG_PATH first
 *                         (ENOENT) before client.getToken would hit the net.
 *    Paths that WOULD reach the network (e.g. a syntactically valid service
 *    account key -> GoogleAuth token fetch to oauth2.googleapis.com) are
 *    deliberately NOT exercised — see SKIPPED PATHS note at the bottom.
 *
 * Run: node --test tests/mcp-servers/google-workspace.server.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_PATH = path.join(REPO_ROOT, "mcp-servers", "google-workspace", "index.js");

const DEADLINE_MS = 10_000;

// ---------------------------------------------------------------------------
// Minimal stdio JSON-RPC client for MCP (newline-delimited JSON framing)
// ---------------------------------------------------------------------------

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject }
    this.stderr = "";
    this.exited = false;

    let buffer = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // ignore non-JSON noise
        }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    child.on("exit", () => {
      this.exited = true;
      for (const [, { reject }] of this.pending) {
        reject(new Error(`server exited before responding. stderr:\n${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  static async start(env) {
    const child = spawn(process.execPath, [SERVER_PATH], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new McpClient(child);
    await client.initialize();
    return client;
  }

  send(msg) {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  request(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(
              `deadline (${DEADLINE_MS}ms) waiting for response to ${method} (id ${id}). stderr:\n${this.stderr}`,
            ),
          );
        }
      }, DEADLINE_MS);
      timer.unref();
    });
    this.send({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  async initialize() {
    const res = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "google-workspace-contract-test", version: "0.0.0" },
    });
    assert.equal(res.error, undefined, `initialize failed: ${JSON.stringify(res.error)}`);
    assert.equal(res.result.serverInfo.name, "google-workspace");
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return res.result;
  }

  async listTools() {
    const res = await this.request("tools/list", {});
    assert.equal(res.error, undefined, `tools/list failed: ${JSON.stringify(res.error)}`);
    return res.result.tools;
  }

  /** Returns the full JSON-RPC response (may carry result.isError or error). */
  callTool(name, args) {
    return this.request("tools/call", { name, arguments: args ?? {} });
  }

  kill() {
    if (!this.exited) {
      this.child.kill("SIGKILL");
    }
  }
}

// ---------------------------------------------------------------------------
// Temp ORCHESTRATOR_HOME + hermetic env
// ---------------------------------------------------------------------------

async function makeTempHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gws-mcp-test-"));
  await fs.mkdir(path.join(home, "config", "credentials"), { recursive: true });
  return home;
}

function hermeticEnv(tempHome) {
  return {
    // Deliberately minimal: do NOT spread process.env, so no real
    // GOOGLE_APPLICATION_CREDENTIALS / gcloud config can leak in.
    PATH: process.env.PATH,
    HOME: tempHome, // config-loader fallback would be <HOME>/JARVIS — also isolated
    ORCHESTRATOR_HOME: tempHome,
    GOOGLE_APPLICATION_CREDENTIALS: path.join(
      tempHome, "config", "credentials", "gcp-service-account.json",
    ),
  };
}

// ---------------------------------------------------------------------------
// Contract: the 32 tool names (sorted). THE core regression net for the split.
// Enumerated literally from the switch/case + getToolDefinitions() in index.js.
// ---------------------------------------------------------------------------

const EXPECTED_TOOL_NAMES = [
  "add_slide",
  "create_doc",
  "create_folder",
  "create_presentation",
  "create_sheet",
  "download_attachment",
  "download_chat_attachment",
  "download_file",
  "get_chat_space",
  "get_file_metadata",
  "get_labels",
  "google_oauth_callback",
  "list_chat_members",
  "list_chat_messages",
  "list_chat_spaces",
  "list_docs",
  "list_emails",
  "list_folder",
  "move_file",
  "read_chat_message",
  "read_doc",
  "read_email",
  "read_presentation",
  "read_sheet",
  "read_sheet_metadata",
  "search_drive",
  "search_emails",
  "send_chat_message",
  "share_file",
  "update_doc",
  "update_sheet",
  "upload_file",
];

// ---------------------------------------------------------------------------
// Suite 1: contract lock (server started with NO credential files at all)
// ---------------------------------------------------------------------------

describe("google-workspace MCP server — contract lock (no credentials present)", () => {
  let tempHome;
  let client;
  let tools; // cached tools/list result

  before(async () => {
    tempHome = await makeTempHome();
    client = await McpClient.start(hermeticEnv(tempHome));
    tools = await client.listTools();
  });

  after(async () => {
    try {
      client?.kill();
    } finally {
      if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("tools/list returns exactly the 32 expected tool names", () => {
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, EXPECTED_TOOL_NAMES);
    assert.equal(names.length, 32);
  });

  it("every tool has a description and an object inputSchema", () => {
    for (const t of tools) {
      assert.equal(typeof t.description, "string", `${t.name}: missing description`);
      assert.ok(t.description.length > 0, `${t.name}: empty description`);
      assert.equal(t.inputSchema?.type, "object", `${t.name}: inputSchema.type !== object`);
    }
  });

  // --- (b) representative schema locks -------------------------------------

  function toolByName(name) {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `tool ${name} not found in tools/list`);
    return t;
  }

  it("read_doc schema: required [doc_id]; properties {auth_mode, doc_id, tab}", () => {
    const s = toolByName("read_doc").inputSchema;
    assert.deepEqual(s.required, ["doc_id"]);
    assert.deepEqual(Object.keys(s.properties).sort(), ["auth_mode", "doc_id", "tab"]);
    assert.deepEqual(s.properties.auth_mode.enum, ["service_account", "oauth2"]);
  });

  it("update_sheet schema: required [spreadsheet_id, range, data, mode]; mode enum locked", () => {
    const s = toolByName("update_sheet").inputSchema;
    assert.deepEqual(s.required, ["spreadsheet_id", "range", "data", "mode"]);
    assert.deepEqual(
      Object.keys(s.properties).sort(),
      ["auth_mode", "data", "mode", "range", "spreadsheet_id"],
    );
    assert.deepEqual(s.properties.mode.enum, ["overwrite", "append"]);
    assert.equal(s.properties.data.type, "array");
  });

  it("send_chat_message schema: required [space_name, text]; properties locked", () => {
    const s = toolByName("send_chat_message").inputSchema;
    assert.deepEqual(s.required, ["space_name", "text"]);
    assert.deepEqual(
      Object.keys(s.properties).sort(),
      ["auth_mode", "space_name", "text", "thread_name"],
    );
  });

  it("search_emails schema: required [query]; properties locked", () => {
    const s = toolByName("search_emails").inputSchema;
    assert.deepEqual(s.required, ["query"]);
    assert.deepEqual(
      Object.keys(s.properties).sort(),
      ["auth_mode", "max_results", "page_token", "query"],
    );
  });

  it("update_doc schema: required [doc_id, content, mode]; mode enum locked", () => {
    const s = toolByName("update_doc").inputSchema;
    assert.deepEqual(s.required, ["doc_id", "content", "mode"]);
    assert.deepEqual(s.properties.mode.enum, ["append", "replace", "insert"]);
  });

  // --- (c) auth failure paths: MISSING credentials file --------------------
  // getServiceAccountAuth() does fs.readFile(SERVICE_ACCOUNT_PATH) FIRST;
  // with the file absent it throws ENOENT before any googleapis client is
  // built — so this cannot touch the network.

  it("service-account tool with missing credentials returns a graceful error result", async () => {
    const res = await client.callTool("read_doc", { doc_id: "abc123" });
    assert.equal(res.error, undefined, "must be a tool-level error, not a protocol error");
    assert.equal(res.result.isError, true);
    const text = res.result.content[0].text;
    assert.match(text, /^Error: /);
    assert.match(text, /ENOENT|no such file/i);
    assert.match(text, /gcp-service-account\.json/);
  });

  it("second service-account tool also errors gracefully (no cached crash state)", async () => {
    const res = await client.callTool("search_emails", { query: "from:x@y.z" });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /ENOENT|no such file/i);
  });

  it("oauth2 auth_mode with missing oauth config returns a graceful error result", async () => {
    // getOAuth2Client() reads OAUTH_CONFIG_PATH first -> ENOENT, pre-network.
    const res = await client.callTool("read_doc", { doc_id: "abc123", auth_mode: "oauth2" });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /^Error: /);
    assert.match(res.result.content[0].text, /ENOENT|no such file/i);
  });

  it("google_oauth_callback with missing oauth config returns a graceful error result", async () => {
    // exchangeCode() reads OAUTH_CONFIG_PATH before getToken -> fails pre-network.
    const res = await client.callTool("google_oauth_callback", { code: "fake-code" });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /OAuth2 token exchange failed/);
  });

  // --- (d) unknown tool -----------------------------------------------------

  it("unknown tool name returns an error result", async () => {
    const res = await client.callTool("does_not_exist", {});
    assert.equal(res.error, undefined, "handler catches and wraps as tool error");
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /Unknown tool: does_not_exist/);
  });

  it("server is still alive and serving after all error paths", async () => {
    const again = await client.listTools();
    assert.equal(again.length, 32);
    assert.equal(client.exited, false, "server process must not have crashed");
  });
});

// ---------------------------------------------------------------------------
// Suite 2: invalid (garbage) credentials JSON
// ---------------------------------------------------------------------------

describe("google-workspace MCP server — invalid credentials JSON", () => {
  let tempHome;
  let client;

  before(async () => {
    tempHome = await makeTempHome();
    // Garbage, non-JSON content: JSON.parse in getServiceAccountAuth throws
    // BEFORE new google.auth.GoogleAuth(...) — no network possible.
    await fs.writeFile(
      path.join(tempHome, "config", "credentials", "gcp-service-account.json"),
      "this is not JSON {{{",
      "utf-8",
    );
    client = await McpClient.start(hermeticEnv(tempHome));
  });

  after(async () => {
    try {
      client?.kill();
    } finally {
      if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("service-account tool with garbage credentials returns a graceful parse-error result", async () => {
    const res = await client.callTool("list_docs", {});
    assert.equal(res.error, undefined);
    assert.equal(res.result.isError, true);
    const text = res.result.content[0].text;
    assert.match(text, /^Error: /);
    // JSON.parse failure message (wording varies across Node versions)
    assert.match(text, /JSON|Unexpected token/i);
  });

  it("server survives the parse failure and still lists 32 tools", async () => {
    const tools = await client.listTools();
    assert.equal(tools.length, 32);
    assert.equal(client.exited, false);
  });
});

// ---------------------------------------------------------------------------
// SKIPPED PATHS (deliberate, to stay hermetic):
//  - A syntactically VALID service-account key file: GoogleAuth would attempt
//    a JWT token exchange against oauth2.googleapis.com on the first API call
//    (network). Auth-success behavior is therefore not covered here.
//  - oauth2 mode with a valid google-oauth-config.json but no tokens file:
//    getOAuth2Client throws a "No OAuth2 tokens found" error whose message is
//    built via client.generateAuthUrl() (local, no network) — coverable, but
//    it requires fabricating an oauth config; omitted to keep the surface
//    minimal. Add it if the split touches AuthManager.getOAuth2Client.
//  - google_oauth_callback with a config file present: exchangeCode would call
//    client.getToken(code) -> POST to oauth2.googleapis.com (network).
// ---------------------------------------------------------------------------
