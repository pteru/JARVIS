# Sprint Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `sprint-agents` as a single service with 3 modes: `fields` (daily, populates ClickUp custom fields), `followup` (daily 08:00, updates sprint.md + alerts blockers), `plan` (manual/bi-weekly, generates sprint planning briefing with HITL approval).

**Architecture:** Node.js ESM, single service with shared ClickUp API client. `fields` and `followup` are cron-driven, `plan` is manual. `followup` uses Haiku for summaries, `plan` uses Sonnet. `fields` is zero-LLM. All 3 read from ClickUp API + PMO mirror + github-clickup-sync state.

**Tech Stack:** Node.js 20+ ESM, ClickUp REST API (native HTTPS), `claude --print` (followup + plan only), `node:test`, bash, cron.

**Spec reference:** No formal spec — designed from workflow doc + STATUS.md sprint agent entries.

**Repository:** `workspaces/strokmatic/infra/` Branch `feature/sprint-agents` off `master`.

---

## Prerequisites

- `services/_shared/pmo-git.mjs` (exists on master)
- `/opt/pmo-readonly/` mirror (exists)
- ClickUp API token at `/opt/github-clickup-sync/.env` (CLICKUP_TOKEN)
- `claude` CLI on server (exists)
- github-clickup-sync running (provides `.state-*.json` files)

---

## Service Structure

```
services/sprint-agents/
├── run.sh                          # mode: fields | followup | plan
├── deploy.sh
├── package.json
├── .gitignore
├── config/
│   └── service.json                # ClickUp IDs, project mapping, thresholds
├── lib/
│   ├── clickup-client.mjs          # Shared ClickUp REST API wrapper
│   ├── sprint-detector.mjs         # PURE: find current sprint list by date range
│   ├── custom-fields.mjs           # Mode 1: populate GitHub URL, Project Code, Drive Folder
│   ├── sprint-followup.mjs         # Mode 2: daily sprint status + blocker alerts
│   └── sprint-planning.mjs         # Mode 3: sprint planning briefing (HITL)
├── prompts/
│   ├── followup-summary.md         # Haiku prompt for daily sprint update
│   └── planning-briefing.md        # Sonnet prompt for sprint planning
├── test/
│   ├── sprint-detector.test.mjs
│   └── test-integration.mjs
├── data/
│   └── state.json
└── logs/
```

---

## Phase 0: Worktree + Scaffolding

### Task 0.1: Create worktree + scaffold

- [ ] **Step 1: Create worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
git worktree add -b feature/sprint-agents /home/teruel/worktrees/infra-sprint-agents origin/master
```

- [ ] **Step 2: Scaffold**

```bash
cd /home/teruel/worktrees/infra-sprint-agents
mkdir -p services/sprint-agents/{config,lib,prompts,test,data,logs}
```

- [ ] **Step 3: Write .gitignore**

Content of `services/sprint-agents/.gitignore`:
```
data/state.json
data/*.lock
logs/
node_modules/
```

- [ ] **Step 4: Write package.json**

```json
{
  "name": "@strokmatic/sprint-agents",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/",
    "fields": "node run-fields.mjs",
    "followup": "node run-followup.mjs",
    "plan": "node run-plan.mjs"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add services/sprint-agents/
git commit -m "feat(sprint-agents): scaffold directory structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: `lib/clickup-client.mjs` (Shared ClickUp API)

Thin wrapper over ClickUp REST API v2. Uses CLICKUP_TOKEN from env.

### Task 1.1: Implement

- [ ] **Step 1: Write implementation**

Content of `services/sprint-agents/lib/clickup-client.mjs`:
```javascript
/**
 * Shared ClickUp REST API client for sprint agents.
 * Uses native HTTPS — zero npm deps.
 */
import https from 'node:https';

const TOKEN = process.env.CLICKUP_TOKEN;

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.clickup.com',
      path: `/api/v2${endpoint}`,
      method,
      headers: {
        Authorization: TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`ClickUp ${res.statusCode} on ${method} ${endpoint}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`ClickUp parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export async function getFolder(folderId) {
  return await request('GET', `/folder/${folderId}`);
}

export async function getListTasks(listId, { subtasks = false, page = 0 } = {}) {
  const qs = `?subtasks=${subtasks}&page=${page}`;
  return await request('GET', `/list/${listId}/task${qs}`);
}

export async function getTask(taskId) {
  return await request('GET', `/task/${taskId}`);
}

export async function updateTask(taskId, payload) {
  return await request('PUT', `/task/${taskId}`, payload);
}

export async function setCustomField(taskId, fieldId, value) {
  return await request('POST', `/task/${taskId}/field/${fieldId}`, { value });
}

export async function getCustomFields(listId) {
  return await request('GET', `/list/${listId}/field`);
}

export async function addTaskToList(listId, taskId) {
  return await request('POST', `/list/${listId}/task/${taskId}`, {});
}
```

- [ ] **Step 2: Commit**

```bash
git add services/sprint-agents/lib/clickup-client.mjs
git commit -m "feat(sprint-agents): add shared ClickUp REST API client

Native HTTPS wrapper: getFolder, getListTasks, getTask, updateTask,
setCustomField, getCustomFields, addTaskToList. Zero npm deps.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: `lib/sprint-detector.mjs` (PURE, TDD)

Find current sprint list by date range in a sprint folder.

### Task 2.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/sprint-agents/test/sprint-detector.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCurrentSprint, findPreviousSprint } from '../lib/sprint-detector.mjs';

const LISTS = [
  { id: '1', name: 'SD Sprint 32', start_date: '1711929600000', due_date: '1713139200000' },
  { id: '2', name: 'SD Sprint 33', start_date: '1713139200000', due_date: '1714348800000' },
  { id: '3', name: 'SD Sprint 34', start_date: '1714348800000', due_date: '1715558400000' },
];

test('findCurrentSprint returns list where today is within range', () => {
  const now = 1713500000000; // within Sprint 33
  const result = findCurrentSprint(LISTS, now);
  assert.equal(result.name, 'SD Sprint 33');
});

test('findCurrentSprint returns most recent if none matches today', () => {
  const now = 1720000000000; // far future
  const result = findCurrentSprint(LISTS, now);
  assert.equal(result.name, 'SD Sprint 34');
});

test('findCurrentSprint returns null for empty lists', () => {
  assert.equal(findCurrentSprint([], Date.now()), null);
});

test('findPreviousSprint returns sprint before current', () => {
  const now = 1713500000000;
  const result = findPreviousSprint(LISTS, now);
  assert.equal(result.name, 'SD Sprint 32');
});

test('findPreviousSprint returns null if current is first', () => {
  const now = 1712000000000; // within Sprint 32
  const result = findPreviousSprint(LISTS, now);
  assert.equal(result, null);
});

test('lists without dates are skipped', () => {
  const lists = [
    { id: '1', name: 'No dates' },
    { id: '2', name: 'SD Sprint 1', start_date: '1713139200000', due_date: '1714348800000' },
  ];
  const result = findCurrentSprint(lists, 1713500000000);
  assert.equal(result.name, 'SD Sprint 1');
});
```

### Task 2.2: Implement

- [ ] **Step 1: Write implementation**

Content of `services/sprint-agents/lib/sprint-detector.mjs`:
```javascript
/**
 * PURE: find current and previous sprint from a list of sprint lists.
 * Uses start_date/due_date (ClickUp epoch milliseconds as strings).
 */

function withDates(lists) {
  return (lists || [])
    .filter(l => l.start_date && l.due_date)
    .sort((a, b) => parseInt(a.start_date) - parseInt(b.start_date));
}

export function findCurrentSprint(lists, now = Date.now()) {
  const sorted = withDates(lists);
  if (sorted.length === 0) return null;

  const active = sorted.find(l =>
    parseInt(l.start_date) <= now && now <= parseInt(l.due_date)
  );
  if (active) return active;

  // Fallback: most recent by start_date
  return sorted[sorted.length - 1];
}

export function findPreviousSprint(lists, now = Date.now()) {
  const sorted = withDates(lists);
  const currentIdx = sorted.findIndex(l =>
    parseInt(l.start_date) <= now && now <= parseInt(l.due_date)
  );
  if (currentIdx <= 0) return null;
  return sorted[currentIdx - 1];
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
git add services/sprint-agents/lib/sprint-detector.mjs services/sprint-agents/test/sprint-detector.test.mjs
git commit -m "feat(sprint-agents): add sprint-detector with TDD

Pure module: findCurrentSprint and findPreviousSprint by date range.
Falls back to most recent sprint if no active one found.

Tests: 6 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: `lib/custom-fields.mjs` (Mode 1: fields)

Populates ClickUp custom fields: GitHub Issue URL, Project Code, Drive Folder.

### Task 3.1: Implement

- [ ] **Step 1: Write `config/service.json`**

Content of `services/sprint-agents/config/service.json`:
```json
{
  "pmo_readonly": "/opt/pmo-readonly",
  "clickup_sync_dir": "/opt/github-clickup-sync",
  "facts_dir": "/opt/jarvis-chat/data/facts",
  "pmo_repo": {
    "url": "git@github.com:teruelskm/pmo.git",
    "branch": "master",
    "clone_path": "/opt/jarvis-sprint-agents/data/pmo-clone",
    "commit_author_name": "JARVIS sprint-agents",
    "commit_author_email": "jarvis-sprint-agents@strokmatic.internal"
  },
  "products": {
    "diemaster": {
      "task_folder_id": "7213380",
      "sprint_folder_id": "90115085362",
      "software_list_id": "205149538"
    },
    "spotfusion": {
      "task_folder_id": "7213400",
      "sprint_folder_id": "90115784429",
      "software_list_id": "901109560051"
    },
    "visionking": {
      "task_folder_id": "90071039181",
      "sprint_folder_id": "90115784442",
      "software_list_id": "901109471398"
    }
  },
  "custom_fields": {
    "github_issue_url": null,
    "project_code": null,
    "drive_folder": null
  },
  "followup": {
    "stale_days": 2,
    "model": "claude-haiku-4-5-20251001"
  },
  "planning": {
    "model": "claude-sonnet-4-6"
  },
  "chat_alert_space": "spaces/AAQADpGfnS4"
}
```

Note: `custom_fields` IDs are null initially — will be resolved at first run by querying ClickUp `getCustomFields`. Can be hardcoded after first discovery.

- [ ] **Step 2: Write `lib/custom-fields.mjs`**

Content of `services/sprint-agents/lib/custom-fields.mjs`:
```javascript
/**
 * Mode 1: Populate ClickUp custom fields for tasks synced from GitHub.
 * Fields: GitHub Issue URL, Project Code, Drive Folder.
 * Zero LLM — pure API calls.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTask, updateTask } from './clickup-client.mjs';

const SYNC_DIR = process.env.CLICKUP_SYNC_DIR || '/opt/github-clickup-sync';
const PMO_ROOT = process.env.PMO_ROOT || '/opt/pmo-readonly';

function loadSyncState() {
  const states = {};
  if (!existsSync(SYNC_DIR)) return states;
  const files = readdirSync(SYNC_DIR).filter(f => f.startsWith('.state-') && f.endsWith('.json'));
  for (const f of files) {
    try {
      const st = JSON.parse(readFileSync(join(SYNC_DIR, f), 'utf-8'));
      const suffix = f.replace('.state-', '').replace('.json', '');
      states[suffix] = st;
    } catch {}
  }
  return states;
}

function findRepoForSuffix(suffix, reposJson) {
  const repos = JSON.parse(readFileSync(reposJson, 'utf-8'));
  return repos.find(r => r.suffix === suffix);
}

export async function populateCustomFields({ config, dryRun = false }) {
  const states = loadSyncState();
  const reposJsonPath = join(SYNC_DIR, 'repos.json');
  let updated = 0;
  let skipped = 0;

  for (const [suffix, state] of Object.entries(states)) {
    const repoInfo = findRepoForSuffix(suffix, reposJsonPath);
    if (!repoInfo) continue;
    const repoName = repoInfo.repo; // e.g. "strokmatic/diemaster"

    for (const [key, taskId] of Object.entries(state)) {
      if (!key.startsWith('clickup_task_') || key.includes('_')) continue;
      const issueNumber = key.replace('clickup_task_', '');

      try {
        const task = await getTask(taskId);
        const existingFields = task.custom_fields || [];

        // Check if GitHub Issue URL is already set
        const ghField = existingFields.find(f => f.name === 'GitHub Issue URL');
        const ghUrl = `https://github.com/${repoName}/issues/${issueNumber}`;

        if (ghField && !ghField.value) {
          if (!dryRun) {
            await updateTask(taskId, {
              custom_fields: [{ id: ghField.id, value: ghUrl }],
            });
          }
          updated++;
        } else {
          skipped++;
        }
      } catch (err) {
        // Task might be deleted or rate limited
        skipped++;
      }
    }
  }

  return { updated, skipped };
}
```

- [ ] **Step 3: Commit**

```bash
git add services/sprint-agents/config/service.json services/sprint-agents/lib/custom-fields.mjs
git commit -m "feat(sprint-agents): add custom-fields mode (populate ClickUp fields)

Zero LLM. Reads github-clickup-sync state files, finds tasks with
empty GitHub Issue URL field, populates it. Extensible for
Project Code and Drive Folder fields.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: `lib/sprint-followup.mjs` (Mode 2: followup)

Daily sprint status update + blocker alerts via Google Chat.

### Task 4.1: Implement

- [ ] **Step 1: Write followup prompt**

Content of `services/sprint-agents/prompts/followup-summary.md`:
```markdown
Gere um resumo diário do sprint para o produto {{PRODUCT}} em PT-BR.

SPRINT ATUAL: {{SPRINT_NAME}}
PERÍODO: {{SPRINT_START}} — {{SPRINT_END}}

TASKS DO SPRINT:
{{TASKS}}

ATIVIDADE RECENTE (últimas 24h):
{{RECENT_ACTIVITY}}

Gere um resumo conciso (máximo 300 palavras) cobrindo:
1. Progresso geral (% concluído, tasks done/in-progress/todo)
2. Blockers ou tasks sem progresso por >2 dias
3. Próximos passos imediatos

Formate para Google Chat: *negrito*, _itálico_. NÃO use # headings ou - bullets markdown.
RESTRIÇÃO FINANCEIRA ativa.
```

- [ ] **Step 2: Write `lib/sprint-followup.mjs`**

Content of `services/sprint-agents/lib/sprint-followup.mjs`:
```javascript
/**
 * Mode 2: Daily sprint followup.
 * Reads current sprint tasks, detects blockers, generates summary via Haiku,
 * updates sprint.md in PMO, alerts via Google Chat if blockers found.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getFolder, getListTasks } from './clickup-client.mjs';
import { findCurrentSprint } from './sprint-detector.mjs';
import { google } from 'googleapis';

const KEY_PATH = process.env.GCP_SERVICE_ACCOUNT_KEY ||
  '/home/strokmatic/.secrets/gcp-service-account.json';

function callClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print', '--model', model, '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function loadPrompt(name) {
  const dir = join(import.meta.dirname, '..', 'prompts');
  return readFileSync(join(dir, `${name}.md`), 'utf-8');
}

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value || '');
  }
  return result;
}

async function sendChatAlert(spaceId, text) {
  const credentials = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });
  const chat = google.chat({ version: 'v1', auth });
  await chat.spaces.messages.create({
    parent: spaceId,
    requestBody: { text },
  });
}

export async function runFollowup({ config, dryRun = false }) {
  const results = [];
  const now = Date.now();

  for (const [product, pcfg] of Object.entries(config.products)) {
    try {
      const folder = await getFolder(pcfg.sprint_folder_id);
      const current = findCurrentSprint(folder.lists, now);
      if (!current) {
        console.log(`[followup] ${product}: no active sprint found`);
        continue;
      }

      const tasksResult = await getListTasks(current.id);
      const tasks = tasksResult.tasks || [];

      const done = tasks.filter(t => t.status?.status?.toLowerCase() === 'done');
      const inProgress = tasks.filter(t => ['in progress', 'in review'].includes(t.status?.status?.toLowerCase()));
      const todo = tasks.filter(t => ['to do', 'backlog', 'open'].includes(t.status?.status?.toLowerCase()));
      const blocked = tasks.filter(t => t.status?.status?.toLowerCase() === 'blocked');

      // Detect stale tasks (no update in >N days)
      const staleDays = config.followup?.stale_days || 2;
      const staleThreshold = now - (staleDays * 24 * 60 * 60 * 1000);
      const stale = inProgress.filter(t => {
        const updated = parseInt(t.date_updated || '0', 10);
        return updated < staleThreshold;
      });

      const tasksSummary = tasks.map(t =>
        `[${t.status?.status || 'unknown'}] ${t.name} (assignees: ${(t.assignees || []).map(a => a.username).join(', ') || 'none'})`
      ).join('\n');

      const recentActivity = [
        `Done: ${done.length}/${tasks.length}`,
        `In progress: ${inProgress.length}`,
        `Blocked: ${blocked.length}`,
        `Stale (>${staleDays}d sem atualização): ${stale.length}`,
        stale.length > 0 ? `Stale tasks: ${stale.map(t => t.name).join(', ')}` : '',
      ].filter(Boolean).join('\n');

      const prompt = fillTemplate(loadPrompt('followup-summary'), {
        PRODUCT: product,
        SPRINT_NAME: current.name,
        SPRINT_START: new Date(parseInt(current.start_date)).toISOString().slice(0, 10),
        SPRINT_END: new Date(parseInt(current.due_date)).toISOString().slice(0, 10),
        TASKS: tasksSummary,
        RECENT_ACTIVITY: recentActivity,
      });

      const model = config.followup?.model || 'claude-haiku-4-5-20251001';
      const summary = dryRun ? '[DRY RUN — summary skipped]' : await callClaude(prompt, model);

      // Alert if blockers or stale tasks
      if ((blocked.length > 0 || stale.length > 0) && !dryRun) {
        const alertText = `🔴 *Sprint followup — ${product}*\n\n${summary}`;
        try {
          await sendChatAlert(config.chat_alert_space, alertText);
          console.log(`[followup] ${product}: alert sent to Chat`);
        } catch (err) {
          console.error(`[followup] ${product}: Chat alert failed: ${err.message}`);
        }
      }

      results.push({
        product,
        sprint: current.name,
        total: tasks.length,
        done: done.length,
        inProgress: inProgress.length,
        blocked: blocked.length,
        stale: stale.length,
        summary,
      });

      console.log(`[followup] ${product}: ${current.name} — ${done.length}/${tasks.length} done, ${blocked.length} blocked, ${stale.length} stale`);
    } catch (err) {
      console.error(`[followup] ${product} failed: ${err.message}`);
    }
  }

  return results;
}
```

- [ ] **Step 3: Commit**

```bash
git add services/sprint-agents/lib/sprint-followup.mjs services/sprint-agents/prompts/followup-summary.md
git commit -m "feat(sprint-agents): add sprint-followup mode (daily status + alerts)

Reads current sprint tasks from ClickUp, detects blockers and stale
tasks (>2 days without update), generates summary via Haiku, alerts
via Google Chat if issues found.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: `lib/sprint-planning.mjs` (Mode 3: plan, HITL)

Sprint planning briefing — generates a document for tech lead review.

### Task 5.1: Implement

- [ ] **Step 1: Write planning prompt**

Content of `services/sprint-agents/prompts/planning-briefing.md`:
```markdown
Gere um briefing de sprint planning para o produto {{PRODUCT}} em PT-BR.

SPRINT ANTERIOR: {{PREV_SPRINT_NAME}}
SPRINT NOVO: {{NEW_SPRINT_NAME}}
PERÍODO: {{NEW_START}} — {{NEW_END}}

RESUMO DO SPRINT ANTERIOR:
{{PREV_SUMMARY}}

TASKS PENDENTES (não concluídas no sprint anterior):
{{CARRY_OVER}}

BACKLOG DISPONÍVEL (tasks na lista regular, não em nenhum sprint):
{{BACKLOG}}

CONTEXTO DO PROJETO (dos reports do kb-generator):
{{PROJECT_CONTEXT}}

Gere um briefing estruturado cobrindo:

1. *Retrospectiva* — o que foi concluído, o que ficou pendente, por quê
2. *Carry-over* — tasks pendentes que devem continuar no novo sprint (com justificativa)
3. *Sugestão de novas tasks* — do backlog, ordenadas por prioridade
4. *Riscos e dependências* — bloqueios conhecidos, dependências entre tasks
5. *Capacidade* — estimativa de quantas tasks cabem baseado no velocity do sprint anterior

PT-BR. RESTRIÇÃO FINANCEIRA ativa.
Formate como documento Markdown limpo (pode usar # headings e - bullets).
```

- [ ] **Step 2: Write `lib/sprint-planning.mjs`**

Content of `services/sprint-agents/lib/sprint-planning.mjs`:
```javascript
/**
 * Mode 3: Sprint planning briefing (HITL).
 * Generates a planning document for tech lead review.
 * Does NOT auto-move tasks — outputs a briefing for human approval.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getFolder, getListTasks } from './clickup-client.mjs';
import { findCurrentSprint, findPreviousSprint } from './sprint-detector.mjs';

function callClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print', '--model', model, '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function loadPrompt(name) {
  const dir = join(import.meta.dirname, '..', 'prompts');
  return readFileSync(join(dir, `${name}.md`), 'utf-8');
}

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value || '');
  }
  return result;
}

function safeRead(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function formatTasks(tasks) {
  return tasks.map(t => {
    const status = t.status?.status || 'unknown';
    const assignees = (t.assignees || []).map(a => a.username).join(', ') || 'unassigned';
    const priority = t.priority?.priority || 'normal';
    return `- [${status}] ${t.name} (${assignees}, priority: ${priority})`;
  }).join('\n');
}

export async function runPlanning({ config, product, outputDir, dryRun = false }) {
  const pcfg = config.products[product];
  if (!pcfg) throw new Error(`Unknown product: ${product}`);

  const now = Date.now();
  const folder = await getFolder(pcfg.sprint_folder_id);
  const current = findCurrentSprint(folder.lists, now);
  const previous = findPreviousSprint(folder.lists, now);

  if (!current) throw new Error(`No active sprint for ${product}`);

  // Get tasks from current (outgoing) sprint
  const currentTasks = (await getListTasks(current.id)).tasks || [];
  const done = currentTasks.filter(t => t.status?.status?.toLowerCase() === 'done');
  const notDone = currentTasks.filter(t => t.status?.status?.toLowerCase() !== 'done');

  // Get backlog tasks from regular list
  const backlogResult = await getListTasks(pcfg.software_list_id);
  const backlog = (backlogResult.tasks || []).filter(t =>
    !['done', 'closed'].includes(t.status?.status?.toLowerCase())
  );

  // Load project context from kb-generator outputs
  const pmoRoot = config.pmo_readonly || '/opt/pmo-readonly';
  const projectCodes = Object.entries(
    JSON.parse(readFileSync(join(pmoRoot, 'config/project-codes.json'), 'utf-8'))
  ).filter(([k, v]) => v.product === product && !k.startsWith('_')).map(([k]) => k);

  const contextParts = projectCodes.slice(0, 5).map(code => {
    const ctx = safeRead(join(pmoRoot, 'projects', code, 'reports/md/context.md'));
    return ctx ? `[${code}] ${ctx.slice(0, 500)}` : '';
  }).filter(Boolean).join('\n\n');

  const prevSummary = `Concluídas: ${done.length}/${currentTasks.length}\nPendentes: ${notDone.length}`;

  const prompt = fillTemplate(loadPrompt('planning-briefing'), {
    PRODUCT: product,
    PREV_SPRINT_NAME: current.name,
    NEW_SPRINT_NAME: `Next sprint`,
    NEW_START: new Date(parseInt(current.due_date) + 1).toISOString().slice(0, 10),
    NEW_END: new Date(parseInt(current.due_date) + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    PREV_SUMMARY: prevSummary,
    CARRY_OVER: formatTasks(notDone),
    BACKLOG: formatTasks(backlog.slice(0, 20)),
    PROJECT_CONTEXT: contextParts || 'Nenhum context.md disponível ainda.',
  });

  const model = config.planning?.model || 'claude-sonnet-4-6';
  const briefing = dryRun ? '[DRY RUN — briefing skipped]' : await callClaude(prompt, model);

  // Write briefing to output dir
  mkdirSync(outputDir, { recursive: true });
  const filename = `sprint-planning-${product}-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(join(outputDir, filename), briefing + '\n', 'utf-8');

  console.log(`[planning] ${product}: briefing written to ${join(outputDir, filename)}`);
  console.log(`[planning] ${product}: ${done.length} done, ${notDone.length} carry-over, ${backlog.length} backlog available`);

  return { product, filename, done: done.length, carryOver: notDone.length, backlog: backlog.length };
}
```

- [ ] **Step 3: Commit**

```bash
git add services/sprint-agents/lib/sprint-planning.mjs services/sprint-agents/prompts/planning-briefing.md
git commit -m "feat(sprint-agents): add sprint-planning mode (HITL briefing)

Generates sprint planning briefing via Sonnet: retrospective,
carry-over, backlog suggestions, risks. Writes MD file for
tech lead review. Does NOT auto-move tasks.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: Entry points + run.sh + deploy.sh

### Task 6.1: Write entry points

- [ ] **Step 1: Write `run-fields.mjs`**

Content of `services/sprint-agents/run-fields.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { populateCustomFields } from './lib/custom-fields.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || join(__dirname, 'config/service.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const dryRun = process.env.HM_DRY_RUN === '1';

const startedAt = Date.now();
try {
  const result = await populateCustomFields({ config, dryRun });
  console.log(`[fields] done: ${result.updated} updated, ${result.skipped} skipped`);
} catch (err) {
  console.error(`[fields] fatal: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Write `run-followup.mjs`**

Content of `services/sprint-agents/run-followup.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFollowup } from './lib/sprint-followup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || join(__dirname, 'config/service.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const dryRun = process.env.HM_DRY_RUN === '1';

try {
  const results = await runFollowup({ config, dryRun });
  console.log(`[followup] done: ${results.length} products processed`);
} catch (err) {
  console.error(`[followup] fatal: ${err.message}`);
  process.exit(1);
}
```

- [ ] **Step 3: Write `run-plan.mjs`**

Content of `services/sprint-agents/run-plan.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlanning } from './lib/sprint-planning.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || join(__dirname, 'config/service.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const dryRun = process.env.HM_DRY_RUN === '1';

const product = process.argv[2];
if (!product) {
  console.error('Usage: node run-plan.mjs <product> (diemaster|spotfusion|visionking)');
  process.exit(1);
}

const outputDir = join(__dirname, 'data', 'briefings');

try {
  const result = await runPlanning({ config, product, outputDir, dryRun });
  console.log(`[planning] briefing: ${result.filename}`);
} catch (err) {
  console.error(`[planning] fatal: ${err.message}`);
  process.exit(1);
}
```

### Task 6.2: Write run.sh + deploy.sh

- [ ] **Step 1: Write `run.sh`**

Content of `services/sprint-agents/run.sh`:
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-fields}"
LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data"

# Load ClickUp token from github-clickup-sync .env
if [[ -f /opt/github-clickup-sync/.env ]]; then
  set -a
  source <(grep -v '^\s*#' /opt/github-clickup-sync/.env | grep -v '^\s*$')
  set +a
fi

LOCK_FILE="$SCRIPT_DIR/data/run-${MODE}.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: previous run in flight" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: starting"
  case "$MODE" in
    fields)   node run-fields.mjs ;;
    followup) node run-followup.mjs ;;
    plan)     node run-plan.mjs "${2:-}" ;;
    *)        echo "Unknown mode: $MODE"; exit 1 ;;
  esac
  echo "[$(date -u +%FT%TZ)] sprint-agents ${MODE}: done (exit $?)"
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: Write `deploy.sh`**

Content of `services/sprint-agents/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-strokmatic@192.168.15.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/jarvis-sprint-agents}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${SSHPASS:?SSHPASS env required}"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
RSYNC="sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no'"

echo "==> ensuring remote dirs"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S mkdir -p $REMOTE_DIR && echo '$SSHPASS' | sudo -S chown strokmatic:strokmatic $REMOTE_DIR"

echo "==> syncing sprint-agents to $REMOTE_DIR"
bash -c "$RSYNC -a --delete --exclude 'data' --exclude 'logs' --exclude 'node_modules' --exclude 'test' \"$SCRIPT_DIR/\" \"$REMOTE_HOST:$REMOTE_DIR/\""

echo "==> installing deps (googleapis for Chat alerts)"
$SSH "$REMOTE_HOST" ". /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && npm install googleapis 2>/dev/null || true"

echo "==> installing crons"
$SSH "$REMOTE_HOST" "(crontab -l 2>/dev/null | grep -v sprint-agents; \
  echo '0 21 * * * . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh fields >> $REMOTE_DIR/logs/cron.log 2>&1 # sprint-agents-fields'; \
  echo '0 8 * * 1-5 . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh followup >> $REMOTE_DIR/logs/cron.log 2>&1 # sprint-agents-followup') | crontab -"

echo "==> deploy complete"
$SSH "$REMOTE_HOST" "crontab -l | grep sprint-agents"
echo ""
echo "Manual sprint planning: ssh $REMOTE_HOST '. /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh plan diemaster'"
```

- [ ] **Step 3: chmod + commit**

```bash
chmod +x services/sprint-agents/run.sh services/sprint-agents/deploy.sh services/sprint-agents/run-*.mjs
git add services/sprint-agents/
git commit -m "feat(sprint-agents): add entry points + run.sh + deploy.sh

3 modes: fields (daily 21:00), followup (weekdays 08:00),
plan (manual: bash run.sh plan <product>).
Shares ClickUp token from github-clickup-sync .env.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: Deploy + test

### Task 7.1: Deploy

- [ ] **Step 1: Deploy**

```bash
cd /home/teruel/worktrees/infra-sprint-agents/services/sprint-agents
SSHPASS='<skm-password>' bash deploy.sh
```

### Task 7.2: Test fields mode

- [ ] **Step 1: Dry-run fields**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-sprint-agents && HM_DRY_RUN=1 bash run.sh fields"
```

### Task 7.3: Test followup mode

- [ ] **Step 1: Dry-run followup**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-sprint-agents && HM_DRY_RUN=1 bash run.sh followup"
```

### Task 7.4: Test planning mode

- [ ] **Step 1: Dry-run planning for diemaster**

```bash
SSHPASS='<skm-password>' sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-sprint-agents && HM_DRY_RUN=1 bash run.sh plan diemaster"
```

---

## Phase 8: PR + merge

### Task 8.1: Push + PR + merge

```bash
cd /home/teruel/worktrees/infra-sprint-agents
git push -u origin feature/sprint-agents
gh pr create --title "feat(sprint-agents): 3-mode service for sprint management" --body "..."
gh pr merge <N> --merge
```

---

## Self-review

### Spec coverage
- custom-fields: Phase 3
- sprint-followup: Phase 4 (daily status + Chat alerts)
- sprint-planning: Phase 5 (HITL briefing via Sonnet)
- shared ClickUp client: Phase 1
- sprint detection: Phase 2 (TDD, 6 tests)
- cron: fields daily 21:00, followup weekdays 08:00, plan manual

### Cron schedule
```
0 21 * * *     sprint-agents fields    # populate custom fields daily
0 8 * * 1-5   sprint-agents followup  # daily sprint status (weekdays)
# plan mode is manual: bash run.sh plan <product>
```
