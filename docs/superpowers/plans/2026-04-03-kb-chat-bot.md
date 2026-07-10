---
type: Implementation Plan
title: KB Chat Bot @JARVIS (Phase 3) Implementation Plan
description: Searches KB markdown files by keyword relevance. Returns top N pages sorted by match count.
timestamp: 2026-04-03
---

# KB Chat Bot @JARVIS (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let team members ask @JARVIS questions in Google Chat and get answers sourced from the knowledge base, with all Q&A logged.

**Architecture:** Polling-based approach — a cron script checks Google Chat spaces for new @JARVIS mentions every 2 minutes, searches the KB for relevant content, generates answers via `claude --print`, replies in-thread, and logs the exchange to `registro-qa/`. No Cloud Function or Apps Script needed — leverages existing Google Workspace MCP tools (`list_chat_messages`, `send_chat_message`).

**Tech Stack:** Node.js (ESM, matches existing MCP patterns), `claude --print` (answer generation), Google Workspace MCP tools (chat read/write), jq (state management)

**Why polling over webhook:** The Google Workspace MCP server already has `list_chat_messages` and `send_chat_message` fully implemented. Polling avoids the complexity of setting up Pub/Sub topics, Cloud Functions, and webhook endpoints. At 2-min intervals, response latency is acceptable for a knowledge base (not a real-time chat bot).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/kb-chat/poll-and-reply.mjs` | Main loop: poll Chat → search KB → generate answer → reply → log |
| `scripts/kb-chat/lib/kb-search.mjs` | Search KB content by keywords and semantic relevance |
| `scripts/kb-chat/lib/answer-generator.mjs` | Feed relevant KB pages to `claude --print`, get answer |
| `scripts/kb-chat/lib/qa-logger.mjs` | Append Q&A to registro-qa/ monthly files + detect gaps |
| `scripts/kb-chat/lib/chat-client.mjs` | Wrapper around Google Workspace MCP chat tools |
| `config/orchestrator/kb-chat.json` | Config: spaces to monitor, polling interval, model, max context |
| `scripts/kb-chat/state.json` | Polling state: last message timestamp per space |

---

### Task 1: Configuration and State

**Files:**
- Create: `config/orchestrator/kb-chat.json`
- Create: `scripts/kb-chat/state.json`

- [ ] **Step 1: Create chat bot config**

```json
// config/orchestrator/kb-chat.json
{
  "enabled": true,
  "polling_interval_seconds": 120,
  "mention_trigger": "JARVIS",
  "kb_repo_path": "workspaces/strokmatic/knowledge-base",
  "max_context_pages": 5,
  "max_context_lines": 500,
  "model": "sonnet",
  "spaces": [],
  "_comment_spaces": "Leave empty to monitor all spaces. Add space names (spaces/XXXXX) to restrict.",
  "system_prompt": "Voce e o JARVIS, assistente tecnico da Strokmatic. Responda em PT-BR com base EXCLUSIVAMENTE no conteudo da base de conhecimento fornecida. Se a informacao nao estiver na KB, diga 'Nao encontrei essa informacao na base de conhecimento.' e sugira quem perguntar (consulte a pagina de contatos). Seja conciso e direto.",
  "log_dir": "workspaces/strokmatic/knowledge-base/registro-qa"
}
```

- [ ] **Step 2: Create polling state file**

```json
// scripts/kb-chat/state.json
{
  "last_poll": null,
  "spaces_state": {}
}
```

- [ ] **Step 3: Commit**

```bash
git add config/orchestrator/kb-chat.json scripts/kb-chat/state.json
git commit -m "feat(kb-chat): add chat bot config and state"
```

---

### Task 2: KB Search Module

**Files:**
- Create: `scripts/kb-chat/lib/kb-search.mjs`

- [ ] **Step 1: Create the KB search module**

Searches KB markdown files by keyword relevance. Returns top N pages sorted by match count.

```javascript
// scripts/kb-chat/lib/kb-search.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (entry.isDirectory()) findMarkdownFiles(fullPath, files);
    else if (entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

/**
 * Extract keywords from a question (simple tokenization + stopword removal)
 */
function extractKeywords(question) {
  const stopwords = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'como', 'que',
    'qual', 'quais', 'onde', 'quando', 'e', 'ou', 'se', 'nao', 'sim',
    'the', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to',
    'and', 'or', 'not', 'what', 'how', 'where', 'when', 'which', 'who',
    'jarvis', '@jarvis', 'me', 'eu', 'meu', 'isso', 'esse', 'esta'
  ]);

  return question
    .toLowerCase()
    .replace(/[^\w\sáéíóúâêôãõç-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

/**
 * Score a file against keywords. Returns { path, relPath, score, title, preview }
 */
function scoreFile(filePath, kbRoot, keywords) {
  const content = readFileSync(filePath, 'utf-8');
  const lower = content.toLowerCase();
  const relPath = relative(kbRoot, filePath);

  let score = 0;
  for (const kw of keywords) {
    // Count occurrences in content
    const regex = new RegExp(kw, 'gi');
    const matches = lower.match(regex);
    if (matches) score += matches.length;

    // Bonus for keyword in filename
    if (relPath.toLowerCase().includes(kw)) score += 5;

    // Bonus for keyword in title (first line)
    const firstLine = content.split('\n')[0].toLowerCase();
    if (firstLine.includes(kw)) score += 3;
  }

  // Extract title
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : relPath;

  // Extract first 3 non-empty, non-header lines as preview
  const preview = content
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('>'))
    .slice(0, 3)
    .join(' ')
    .substring(0, 200);

  return { path: filePath, relPath, score, title, preview };
}

/**
 * Search KB for pages relevant to a question.
 * @param {string} kbRoot - Path to KB repo root
 * @param {string} question - User's question
 * @param {number} maxResults - Max pages to return
 * @returns {Array<{relPath, title, content}>} - Relevant pages with full content
 */
export function searchKB(kbRoot, question, maxResults = 5) {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return [];

  const files = findMarkdownFiles(kbRoot);
  const scored = files
    .map(f => scoreFile(f, kbRoot, keywords))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map(s => ({
    relPath: s.relPath,
    title: s.title,
    content: readFileSync(s.path, 'utf-8'),
    score: s.score
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/kb-chat/lib/kb-search.mjs
git commit -m "feat(kb-chat): add KB keyword search module"
```

---

### Task 3: Answer Generator Module

**Files:**
- Create: `scripts/kb-chat/lib/answer-generator.mjs`

- [ ] **Step 1: Create the answer generator**

Feeds relevant KB pages to `claude --print` with the system prompt. Returns the generated answer.

```javascript
// scripts/kb-chat/lib/answer-generator.mjs
import { spawn } from 'child_process';
import { readFileSync } from 'fs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;

/**
 * Generate an answer using claude --print with KB context
 * @param {string} question - User's question
 * @param {Array<{relPath, title, content}>} kbPages - Relevant KB pages
 * @param {object} config - Chat bot config
 * @returns {Promise<string>} - Generated answer
 */
export async function generateAnswer(question, kbPages, config) {
  // Build context from KB pages
  let context = '';
  let totalLines = 0;
  for (const page of kbPages) {
    const lines = page.content.split('\n').length;
    if (totalLines + lines > config.max_context_lines) break;
    context += `\n\n--- ${page.relPath} ---\n${page.content}`;
    totalLines += lines;
  }

  const prompt = `${config.system_prompt}

## Base de Conhecimento (contexto para responder)
${context}

## Pergunta do usuario
${question}

## Instrucoes
- Responda SOMENTE com base no conteudo acima
- Se nao encontrar a resposta, diga "Nao encontrei essa informacao na base de conhecimento"
- Seja conciso (maximo 500 palavras)
- Use markdown para formatacao
- Inclua referencia a pagina da KB quando relevante (ex: "Ver: produtos/visionking/arquitetura.md")`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', config.model || 'sonnet',
      '--max-turns', '1'
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude --print failed (code ${code}): ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/kb-chat/lib/answer-generator.mjs
git commit -m "feat(kb-chat): add answer generator with claude --print"
```

---

### Task 4: Q&A Logger Module

**Files:**
- Create: `scripts/kb-chat/lib/qa-logger.mjs`

- [ ] **Step 1: Create the Q&A logger**

Appends each exchange to the monthly log and detects KB gaps.

```javascript
// scripts/kb-chat/lib/qa-logger.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Log a Q&A exchange to the registro-qa/ directory
 * @param {string} logDir - Path to registro-qa/
 * @param {object} entry - { who, question, answer, kbPagesUsed, isGap }
 */
export function logQA(logDir, entry) {
  const now = new Date();
  const monthFile = join(logDir, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`);
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);

  // Create month file header if it doesn't exist
  if (!existsSync(monthFile)) {
    writeFileSync(monthFile, `# Registro Q&A — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}\n\n`);
  }

  // Determine short question for header
  const shortQuestion = entry.question.length > 80
    ? entry.question.substring(0, 77) + '...'
    : entry.question;

  // Build entry
  const qaEntry = `### ${timestamp} — ${shortQuestion}

**Quem perguntou:** ${entry.who}
**Pergunta:** ${entry.question}
**Resposta:** ${entry.answer}
**Paginas KB usadas:** ${entry.kbPagesUsed.length > 0 ? entry.kbPagesUsed.join(', ') : 'nenhuma'}
**Lacuna identificada:** ${entry.isGap ? 'sim' : 'nao'}

---

`;

  appendFileSync(monthFile, qaEntry);

  // If gap detected, add to pendentes.md
  if (entry.isGap) {
    const pendentesFile = join(logDir, 'pendentes.md');
    const pendentesEntry = `- [ ] ${now.toISOString().substring(0, 10)} — ${shortQuestion} (${entry.who})\n`;
    appendFileSync(pendentesFile, pendentesEntry);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/kb-chat/lib/qa-logger.mjs
git commit -m "feat(kb-chat): add Q&A logger with gap detection"
```

---

### Task 5: Chat Client Wrapper

**Files:**
- Create: `scripts/kb-chat/lib/chat-client.mjs`

- [ ] **Step 1: Create the chat client**

Wraps Google Workspace MCP tools for polling and replying. Uses `claude --print` with `--allowedTools` to invoke MCP tools.

```javascript
// scripts/kb-chat/lib/chat-client.mjs
import { spawn } from 'child_process';

/**
 * Call a Google Workspace MCP tool via claude --print
 * @param {string} toolName - MCP tool name (e.g., 'list_chat_messages')
 * @param {object} args - Tool arguments
 * @returns {Promise<string>} - Tool output
 */
async function callMcpTool(toolName, args) {
  const prompt = `Call the MCP tool ${toolName} with these exact arguments: ${JSON.stringify(args)}. Return ONLY the raw tool output, nothing else.`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', 'haiku',
      '--max-turns', '1',
      '--allowedTools', `mcp__google-workspace__${toolName}`
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`MCP tool ${toolName} failed`));
      else resolve(stdout.trim());
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * List recent messages in a Chat space
 * @param {string} spaceName - Space ID (spaces/XXXXX)
 * @param {string} sinceTimestamp - ISO timestamp to filter from
 * @returns {Promise<Array>} - Messages
 */
export async function listRecentMessages(spaceName, sinceTimestamp) {
  const result = await callMcpTool('list_chat_messages', {
    space_name: spaceName,
    page_size: 25
  });
  // Parse result — format depends on MCP server output
  try {
    const parsed = JSON.parse(result);
    return (parsed.messages || []).filter(m => {
      if (!sinceTimestamp) return true;
      return new Date(m.createTime) > new Date(sinceTimestamp);
    });
  } catch {
    return [];
  }
}

/**
 * Send a reply to a Chat space (optionally in a thread)
 * @param {string} spaceName - Space ID
 * @param {string} text - Message text (markdown supported)
 * @param {string} threadName - Optional thread ID for threaded reply
 */
export async function sendReply(spaceName, text, threadName) {
  const args = { space_name: spaceName, text };
  if (threadName) args.thread_name = threadName;
  await callMcpTool('send_chat_message', args);
}

/**
 * List all available Chat spaces
 * @returns {Promise<Array>} - Spaces
 */
export async function listSpaces() {
  const result = await callMcpTool('list_chat_spaces', {});
  try {
    return JSON.parse(result).spaces || [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/kb-chat/lib/chat-client.mjs
git commit -m "feat(kb-chat): add Chat client wrapper for MCP tools"
```

---

### Task 6: Main Polling Loop

**Files:**
- Create: `scripts/kb-chat/poll-and-reply.mjs`

- [ ] **Step 1: Create the main polling script**

```javascript
// scripts/kb-chat/poll-and-reply.mjs
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { searchKB } from './lib/kb-search.mjs';
import { generateAnswer } from './lib/answer-generator.mjs';
import { logQA } from './lib/qa-logger.mjs';
import { listRecentMessages, sendReply, listSpaces } from './lib/chat-client.mjs';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const CONFIG_PATH = join(ORCHESTRATOR_HOME, 'config/orchestrator/kb-chat.json');
const STATE_PATH = join(ORCHESTRATOR_HOME, 'scripts/kb-chat/state.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
const kbRoot = join(ORCHESTRATOR_HOME, config.kb_repo_path);
const logDir = join(ORCHESTRATOR_HOME, config.log_dir);

async function main() {
  if (!config.enabled) {
    console.log('[kb-chat] Bot disabled in config');
    process.exit(0);
  }

  console.log(`[kb-chat] Polling at ${new Date().toISOString()}`);

  // Get spaces to monitor
  let spaces = config.spaces;
  if (!spaces || spaces.length === 0) {
    const allSpaces = await listSpaces();
    spaces = allSpaces.map(s => s.name);
  }

  let processed = 0;

  for (const spaceName of spaces) {
    const lastTimestamp = state.spaces_state?.[spaceName]?.last_message_time || null;
    const messages = await listRecentMessages(spaceName, lastTimestamp);

    for (const msg of messages) {
      // Check if message mentions JARVIS
      const text = msg.text || '';
      if (!text.toLowerCase().includes(config.mention_trigger.toLowerCase())) continue;

      // Extract the question (remove the @JARVIS mention)
      const question = text.replace(/@?jarvis/gi, '').trim();
      if (!question) continue;

      console.log(`[kb-chat] Question from ${msg.sender?.displayName || 'unknown'}: ${question.substring(0, 80)}`);

      // Search KB for relevant pages
      const results = searchKB(kbRoot, question, config.max_context_pages);

      // Generate answer
      let answer;
      let isGap = false;
      try {
        answer = await generateAnswer(question, results, config);
        if (answer.includes('Nao encontrei') || results.length === 0) {
          isGap = true;
        }
      } catch (err) {
        console.error(`[kb-chat] Error generating answer: ${err.message}`);
        answer = 'Desculpe, ocorreu um erro ao processar sua pergunta. Tente novamente ou consulte a KB diretamente.';
        isGap = true;
      }

      // Reply in thread
      const threadName = msg.thread?.name || msg.name;
      try {
        await sendReply(spaceName, answer, threadName);
        console.log(`[kb-chat] Replied in ${spaceName}`);
      } catch (err) {
        console.error(`[kb-chat] Error sending reply: ${err.message}`);
      }

      // Log Q&A
      logQA(logDir, {
        who: msg.sender?.displayName || msg.sender?.name || 'unknown',
        question,
        answer,
        kbPagesUsed: results.map(r => r.relPath),
        isGap
      });

      processed++;
    }

    // Update state with latest message timestamp
    if (messages.length > 0) {
      const latestTime = messages[messages.length - 1].createTime;
      if (!state.spaces_state) state.spaces_state = {};
      state.spaces_state[spaceName] = { last_message_time: latestTime };
    }
  }

  // Save state
  state.last_poll = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  console.log(`[kb-chat] Done. Processed ${processed} questions.`);
}

main().catch(err => {
  console.error(`[kb-chat] Fatal: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/kb-chat/poll-and-reply.mjs
```

- [ ] **Step 3: Test manually**

```bash
node scripts/kb-chat/poll-and-reply.mjs
```

- [ ] **Step 4: Commit**

```bash
git add scripts/kb-chat/poll-and-reply.mjs
git commit -m "feat(kb-chat): add main polling loop — poll, search, answer, reply, log"
```

---

### Task 7: Register Cron Job

**Files:**
- Modify: `config/cron/orchestrator.cron`

- [ ] **Step 1: Add KB chat bot cron entry**

Add to `config/cron/orchestrator.cron`:
```cron
# KB Chat Bot (Phase 3)
*/2 * * * * cd $HOME/JARVIS && node scripts/kb-chat/poll-and-reply.mjs >> logs/cron-kb-chat.log 2>&1
```

Every 2 minutes.

- [ ] **Step 2: Install crontab**

```bash
crontab config/cron/orchestrator.cron
crontab -l  # verify
```

- [ ] **Step 3: Commit**

```bash
git add config/cron/orchestrator.cron
git commit -m "feat(kb-chat): register 2-min polling cron job"
```

---

### Task 8: Commit Q&A logs to KB repo periodically

**Files:**
- Create: `scripts/kb-chat/commit-qa-logs.sh`

- [ ] **Step 1: Create log commit script**

The Q&A logger writes to the KB repo but doesn't commit. This script commits and pushes accumulated Q&A logs daily.

```bash
#!/usr/bin/env bash
set -euo pipefail

KB_REPO="${HOME}/JARVIS/workspaces/strokmatic/knowledge-base"

cd "$KB_REPO"

# Check if there are changes in registro-qa/
if git diff --quiet registro-qa/ && git diff --cached --quiet registro-qa/; then
  echo "[$(date -Iseconds)] No new Q&A logs to commit"
  exit 0
fi

git add registro-qa/
git commit -m "chore: update Q&A logs ($(date +%Y-%m-%d))"
git push origin master

echo "[$(date -Iseconds)] Q&A logs committed and pushed"
```

- [ ] **Step 2: Add cron entry (daily at midnight)**

```cron
# KB Q&A log commit
0 0 * * * cd $HOME/JARVIS && bash scripts/kb-chat/commit-qa-logs.sh >> logs/cron-kb-chat.log 2>&1
```

- [ ] **Step 3: Commit**

```bash
chmod +x scripts/kb-chat/commit-qa-logs.sh
git add scripts/kb-chat/commit-qa-logs.sh
git commit -m "feat(kb-chat): add daily Q&A log commit script"
```
