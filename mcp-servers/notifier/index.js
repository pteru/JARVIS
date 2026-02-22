#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  path.join(process.env.HOME, "JARVIS");

class NotifierServer {
  constructor() {
    this.server = new Server(
      { name: "notifier", version: "1.2.0" },
      { capabilities: { tools: {} } },
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  async loadConfig() {
    const configPath = path.join(
      ORCHESTRATOR_HOME,
      "config",
      "orchestrator",
      "notifications.json",
    );
    const config = JSON.parse(await fs.readFile(configPath, "utf-8"));

    // Resolve file-based secrets (bot_token_file → bot_token)
    const tg = config.backends?.telegram;
    if (tg && !tg.bot_token && tg.bot_token_file) {
      const tokenPath = tg.bot_token_file.replace(/^~/, process.env.HOME);
      tg.bot_token = (await fs.readFile(tokenPath, "utf-8")).trim();
    }

    return config;
  }

  // ---------------------------------------------------------------------------
  // Duration helpers
  // ---------------------------------------------------------------------------

  classifyDuration(seconds, thresholds) {
    if (seconds == null) return "standard";
    if (seconds <= thresholds.quick_max) return "quick";
    if (seconds <= thresholds.standard_max) return "standard";
    if (seconds <= thresholds.long_max) return "long";
    return "extended";
  }

  formatDuration(seconds) {
    if (seconds == null) return "unknown";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }

  // ---------------------------------------------------------------------------
  // Message formatting
  // ---------------------------------------------------------------------------

  formatTelegramMessage(eventType, workspace, message, durationSeconds, category, metadata) {
    const model = metadata?.model || "";
    const duration = this.formatDuration(durationSeconds);

    const prefix = {
      task_completed: category === "extended" ? "\u{1F6A8}" : "\u2705",
      task_failed: "\u274C",
      task_timeout: "\u23F0",
      task_started: "\u{1F680}",
    }[eventType] || "\u2139\uFE0F";

    const label = {
      task_completed: category === "extended" ? "Long task completed" : "Task completed",
      task_failed: "Task failed",
      task_timeout: "Task timed out",
      task_started: "Task started",
    }[eventType] || "Task event";

    let text = `${prefix} *${label}* — ${this.escapeMarkdown(workspace)}\n${this.escapeMarkdown(message)}`;

    if (eventType === "task_failed" && metadata?.error) {
      text += `\n\u{1F4CB} Error: \`${this.escapeMarkdown(metadata.error)}\``;
    }

    if (durationSeconds != null) {
      text += `\n\u{1F552} Duration: ${this.escapeMarkdown(duration)}`;
    }
    if (model) {
      const short = model.replace(/^claude-/, "").split("-").slice(0, 2).join("-");
      text += ` \\| Model: ${this.escapeMarkdown(short)}`;
    }

    return text;
  }

  escapeMarkdown(text) {
    // Escape Telegram MarkdownV2 special characters
    return String(text).replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
  }

  formatDiscordEmbed(eventType, workspace, message, durationSeconds, category, metadata) {
    const colors = {
      task_completed: 0x00ff00,
      task_failed: 0xff0000,
      task_timeout: 0xff9900,
      task_started: 0x3498db,
    };

    const statusLabels = {
      task_completed: "Completed",
      task_failed: "Failed",
      task_timeout: "Timed Out",
      task_started: "Started",
    };

    const fields = [];
    if (metadata?.model) {
      fields.push({ name: "Model", value: metadata.model, inline: true });
    }
    if (durationSeconds != null) {
      fields.push({ name: "Duration", value: this.formatDuration(durationSeconds), inline: true });
    }
    if (metadata?.task_id) {
      fields.push({ name: "Dispatch ID", value: metadata.task_id, inline: true });
    }
    if (metadata?.error) {
      fields.push({ name: "Error", value: metadata.error.slice(0, 200) });
    }

    return {
      embeds: [
        {
          title: `Task ${statusLabels[eventType] || "Event"}: ${workspace}`,
          description: message.slice(0, 200),
          color: colors[eventType] || 0x95a5a6,
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Backend handlers
  // ---------------------------------------------------------------------------

  async sendTelegram(config, text) {
    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chat_id,
          text,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return { success: data.ok, status: res.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async sendDiscord(config, payload, mentionRole) {
    let body = payload;
    if (mentionRole && config.mention_role_id) {
      body = { ...payload, content: `<@&${config.mention_role_id}>` };
    }

    try {
      const res = await fetch(config.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return { success: res.ok, status: res.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Notification history (optional)
  // ---------------------------------------------------------------------------

  async logNotification(entry) {
    const logPath = path.join(ORCHESTRATOR_HOME, "logs", "notifications.json");
    let log = [];
    try {
      log = JSON.parse(await fs.readFile(logPath, "utf-8"));
    } catch {
      // First entry
    }
    log.push({ ...entry, timestamp: new Date().toISOString() });

    // Keep last 500 entries
    if (log.length > 500) log = log.slice(-500);

    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, JSON.stringify(log, null, 2), "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Core send logic
  // ---------------------------------------------------------------------------

  async sendNotification(eventType, workspace, message, durationSeconds, metadata) {
    const config = await this.loadConfig();

    if (!config.enabled) {
      return this.textResult("Notifications disabled globally");
    }

    if (!config.events?.[eventType]) {
      return this.textResult(`Event "${eventType}" is disabled in config`);
    }

    const category = this.classifyDuration(durationSeconds, config.duration_thresholds);
    const backendsNotified = [];
    const errors = [];

    // Telegram
    if (config.backends?.telegram?.enabled) {
      const tg = config.backends.telegram;
      if (!tg.bot_token || !tg.chat_id) {
        errors.push({ backend: "telegram", error: "Missing bot_token or chat_id in config" });
      } else {
        const text = this.formatTelegramMessage(
          eventType, workspace, message, durationSeconds, category, metadata,
        );
        const result = await this.sendTelegram(tg, text);
        if (result.success) {
          backendsNotified.push("telegram");
        } else {
          errors.push({ backend: "telegram", error: result.error || `HTTP ${result.status}` });
        }
      }
    }

    // Discord
    if (config.backends?.discord?.enabled) {
      const dc = config.backends.discord;
      if (!dc.webhook_url) {
        errors.push({ backend: "discord", error: "Missing webhook_url in config" });
      } else {
        const shouldMention = category === "extended" || eventType === "task_failed";
        const embed = this.formatDiscordEmbed(
          eventType, workspace, message, durationSeconds, category, metadata,
        );
        const result = await this.sendDiscord(dc, embed, shouldMention);
        if (result.success) {
          backendsNotified.push("discord");
        } else {
          errors.push({ backend: "discord", error: result.error || `HTTP ${result.status}` });
        }
      }
    }

    await this.logNotification({
      eventType, workspace, message, durationSeconds, category,
      backendsNotified, errors: errors.length > 0 ? errors : undefined,
    }).catch(() => {});

    return this.textResult(
      JSON.stringify({ backends_notified: backendsNotified, errors }, null, 2),
    );
  }

  async testNotification(backend) {
    const config = await this.loadConfig();
    const results = {};

    const testBackends = backend === "all"
      ? ["telegram", "discord"]
      : [backend];

    for (const b of testBackends) {
      if (b === "telegram") {
        const tg = config.backends?.telegram;
        if (!tg?.enabled) {
          results.telegram = { success: false, error: "Telegram backend is disabled" };
        } else if (!tg.bot_token || !tg.chat_id) {
          results.telegram = { success: false, error: "Missing bot_token or chat_id" };
        } else {
          const res = await this.sendTelegram(tg,
            "\u{1F916} Orchestrator notification test — if you see this, it works\\!");
          results.telegram = res.success
            ? { success: true, message: "Test sent to Telegram" }
            : { success: false, error: res.error || `HTTP ${res.status}` };
        }
      }

      if (b === "discord") {
        const dc = config.backends?.discord;
        if (!dc?.enabled) {
          results.discord = { success: false, error: "Discord backend is disabled" };
        } else if (!dc.webhook_url) {
          results.discord = { success: false, error: "Missing webhook_url" };
        } else {
          const embed = {
            embeds: [{
              title: "Orchestrator Notification Test",
              description: "If you see this, Discord notifications are working!",
              color: 0x3498db,
              timestamp: new Date().toISOString(),
            }],
          };
          const res = await this.sendDiscord(dc, embed, false);
          results.discord = res.success
            ? { success: true, message: "Test embed sent" }
            : { success: false, error: res.error || `HTTP ${res.status}` };
        }
      }
    }

    return this.textResult(JSON.stringify(results, null, 2));
  }

  textResult(text) {
    return { content: [{ type: "text", text }] };
  }

  // ---------------------------------------------------------------------------
  // Telegram inbound helpers
  // ---------------------------------------------------------------------------

  get offsetPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "telegram_update_offset.json");
  }

  get inboxPath() {
    return path.join(ORCHESTRATOR_HOME, "logs", "inbox.json");
  }

  async loadOffset() {
    try {
      const data = JSON.parse(await fs.readFile(this.offsetPath, "utf-8"));
      return data.offset || 0;
    } catch {
      return 0;
    }
  }

  async saveOffset(offset) {
    await fs.mkdir(path.dirname(this.offsetPath), { recursive: true });
    await fs.writeFile(this.offsetPath, JSON.stringify({ offset }), "utf-8");
  }

  async loadInbox() {
    try {
      return JSON.parse(await fs.readFile(this.inboxPath, "utf-8"));
    } catch {
      return [];
    }
  }

  async saveInbox(inbox) {
    // Cap at 200 entries
    if (inbox.length > 200) inbox = inbox.slice(-200);
    await fs.mkdir(path.dirname(this.inboxPath), { recursive: true });
    await fs.writeFile(this.inboxPath, JSON.stringify(inbox, null, 2), "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Voice transcription
  // ---------------------------------------------------------------------------

  async transcribeVoice(fileId, botToken, config) {
    const inbound = config.backends?.telegram?.inbound;
    if (!inbound?.voice_transcription?.enabled) {
      return { text: null, error: "Voice transcription disabled" };
    }

    const apiKeyEnv = inbound.voice_transcription.api_key_env || "GROQ_API_KEY";
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      return { text: null, error: `Missing env var ${apiKeyEnv}` };
    }

    const provider = inbound.voice_transcription.provider || "groq";
    const baseUrl = provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://api.groq.com/openai/v1";

    try {
      // Get file path from Telegram
      const fileRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const fileData = await fileRes.json();
      if (!fileData.ok) return { text: null, error: "Failed to get file info" };

      // Download the voice file
      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
      const audioRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      // Transcribe via Whisper API
      const boundary = `----FormBoundary${Date.now()}`;
      const filename = fileData.result.file_path.split("/").pop() || "voice.ogg";
      const whisperModel = provider === "openai" ? "whisper-1" : "whisper-large-v3";
      const bodyParts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/ogg\r\n\r\n`,
        audioBuffer,
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n--${boundary}--\r\n`,
      ];
      const body = Buffer.concat(bodyParts.map(p => typeof p === "string" ? Buffer.from(p) : p));

      const whisperRes = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const whisperData = await whisperRes.json();
      return { text: whisperData.text || null, error: whisperData.error?.message };
    } catch (err) {
      return { text: null, error: err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Command parsing
  // ---------------------------------------------------------------------------

  parseCommand(text) {
    if (!text || !text.startsWith("/")) return null;
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/@\w+$/, ""); // strip bot mention
    switch (cmd) {
      case "/status":
        return { type: "command", command: "status", args: parts.slice(1) };
      case "/dispatch":
        if (parts.length < 3) return null;
        return { type: "command", command: "dispatch", args: { workspace: parts[1], task: parts.slice(2).join(" ") } };
      case "/cancel":
        if (parts.length < 2) return null;
        return { type: "command", command: "cancel", args: { id: parts[1] } };
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // check_telegram_inbox implementation
  // ---------------------------------------------------------------------------

  async checkTelegramInbox() {
    const config = await this.loadConfig();
    const tg = config.backends?.telegram;

    if (!tg?.enabled || !tg?.inbound?.enabled) {
      return this.textResult(JSON.stringify({ error: "Telegram inbound not enabled" }));
    }

    const offset = await this.loadOffset();
    const commands = [];
    const inboxMessages = [];
    const errors = [];

    try {
      const url = `https://api.telegram.org/bot${tg.bot_token}/getUpdates?offset=${offset}&timeout=1&allowed_updates=["message"]`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await res.json();

      if (!data.ok || !data.result?.length) {
        return this.textResult(JSON.stringify({ commands, inbox_messages: inboxMessages, errors, updates_checked: 0 }));
      }

      let maxUpdateId = offset;

      for (const update of data.result) {
        if (update.update_id >= maxUpdateId) maxUpdateId = update.update_id + 1;

        const msg = update.message;
        if (!msg) continue;

        // Security: only accept messages from configured chat_id
        if (String(msg.chat.id) !== String(tg.chat_id)) continue;

        let text = msg.text || "";
        let originalType = "text";

        // Voice message handling
        if (msg.voice) {
          originalType = "voice";
          const result = await this.transcribeVoice(msg.voice.file_id, tg.bot_token, config);
          if (result.text) {
            text = result.text;
          } else {
            errors.push({ message_id: msg.message_id, error: `Voice transcription failed: ${result.error}` });
            text = `[Voice message - transcription failed: ${result.error}]`;
          }
        }

        // Try to parse as command
        const cmd = this.parseCommand(text);
        if (cmd) {
          commands.push({ ...cmd, message_id: msg.message_id, raw: text });
          // Acknowledge command
          await this.sendTelegramReply(tg, `✓ Command received: ${cmd.command}`, msg.message_id).catch(() => {});
        } else {
          // Store in inbox
          const entry = {
            id: `inbox_${Date.now()}_${msg.message_id}`,
            telegram_message_id: msg.message_id,
            timestamp: new Date(msg.date * 1000).toISOString(),
            text: text || "[no text]",
            original_type: originalType,
            status: "pending",
          };
          inboxMessages.push(entry);
        }
      }

      // Persist offset and inbox
      await this.saveOffset(maxUpdateId);

      if (inboxMessages.length > 0) {
        const inbox = await this.loadInbox();
        inbox.push(...inboxMessages);
        await this.saveInbox(inbox);
        // Acknowledge receipt
        await this.sendTelegramReply(tg, `📥 ${inboxMessages.length} message(s) received and stored`).catch(() => {});
      }

      return this.textResult(JSON.stringify({ commands, inbox_messages: inboxMessages, errors, updates_checked: data.result.length }, null, 2));
    } catch (err) {
      return this.textResult(JSON.stringify({ commands, inbox_messages: inboxMessages, errors: [...errors, { error: err.message }] }));
    }
  }

  // ---------------------------------------------------------------------------
  // get_inbox implementation
  // ---------------------------------------------------------------------------

  async getInbox(statusFilter, markRead) {
    const inbox = await this.loadInbox();
    let filtered = inbox;
    if (statusFilter) {
      filtered = inbox.filter((m) => m.status === statusFilter);
    }

    if (markRead) {
      for (const msg of inbox) {
        if (!statusFilter || msg.status === statusFilter) {
          msg.status = "read";
        }
      }
      await this.saveInbox(inbox);
    }

    return this.textResult(JSON.stringify({ count: filtered.length, messages: filtered }, null, 2));
  }

  // ---------------------------------------------------------------------------
  // reply_telegram implementation
  // ---------------------------------------------------------------------------

  async sendTelegramReply(tgConfig, text, replyToMessageId) {
    const url = `https://api.telegram.org/bot${tgConfig.bot_token}/sendMessage`;
    const body = {
      chat_id: tgConfig.chat_id,
      text,
    };
    if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return { success: data.ok, message_id: data.result?.message_id };
  }

  async replyTelegram(message, replyToMessageId) {
    const config = await this.loadConfig();
    const tg = config.backends?.telegram;

    if (!tg?.enabled || !tg.bot_token || !tg.chat_id) {
      return this.textResult(JSON.stringify({ success: false, error: "Telegram not configured" }));
    }

    try {
      const result = await this.sendTelegramReply(tg, message, replyToMessageId);
      return this.textResult(JSON.stringify(result));
    } catch (err) {
      return this.textResult(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // ---------------------------------------------------------------------------
  // MCP tool definitions
  // ---------------------------------------------------------------------------

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "send_notification",
          description:
            "Send a notification about a task event to all enabled backends (Telegram, Discord)",
          inputSchema: {
            type: "object",
            properties: {
              event_type: {
                type: "string",
                enum: ["task_completed", "task_failed", "task_started", "task_timeout"],
                description: "Type of task event",
              },
              workspace: {
                type: "string",
                description: "Workspace name",
              },
              message: {
                type: "string",
                description: "Task description or summary",
              },
              duration_seconds: {
                type: "number",
                description: "Task execution duration in seconds (optional)",
              },
              metadata: {
                type: "object",
                description:
                  "Optional: model, task_id, error, complexity, changelog_path",
              },
            },
            required: ["event_type", "workspace", "message"],
          },
        },
        {
          name: "test_notification",
          description:
            "Send a test notification to verify backend configuration",
          inputSchema: {
            type: "object",
            properties: {
              backend: {
                type: "string",
                enum: ["telegram", "discord", "all"],
                description: "Which backend to test",
              },
            },
            required: ["backend"],
          },
        },
        {
          name: "check_telegram_inbox",
          description:
            "Poll Telegram for new inbound messages. Parses commands (/status, /dispatch, /cancel), transcribes voice messages via OpenAI Whisper, and stores unroutable messages in the inbox.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_inbox",
          description:
            "Retrieve stored inbox messages from Telegram that were not recognized as commands",
          inputSchema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["pending", "read"],
                description: "Filter by message status (optional)",
              },
              mark_read: {
                type: "boolean",
                description: "Mark matching messages as read (default false)",
              },
            },
          },
        },
        {
          name: "reply_telegram",
          description:
            "Send a freeform reply message to the user on Telegram",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "The message text to send",
              },
              reply_to_message_id: {
                type: "number",
                description: "Telegram message ID to reply to (for threading, optional)",
              },
            },
            required: ["message"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "send_notification":
            return await this.sendNotification(
              args.event_type,
              args.workspace,
              args.message,
              args.duration_seconds,
              args.metadata,
            );

          case "test_notification":
            return await this.testNotification(args.backend);

          case "check_telegram_inbox":
            return await this.checkTelegramInbox();

          case "get_inbox":
            return await this.getInbox(args.status, args.mark_read);

          case "reply_telegram":
            return await this.replyTelegram(args.message, args.reply_to_message_id);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Notifier MCP server running on stdio");
  }
}

const server = new NotifierServer();
server.run().catch(console.error);
