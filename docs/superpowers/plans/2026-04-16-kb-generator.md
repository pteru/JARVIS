# kb-generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `kb-generator` as a daily cron service at `/opt/jarvis-kb-generator/` that detects projects with activity, surgically edits 4 reports per project via LLM, and pushes to PMO repo.

**Architecture:** Node.js ESM. Pure modules (activity-detector, revision-tracker) + I/O modules (context-assembler, report-generator) + orchestrator. Uses `claude --print` for LLM synthesis (legitimate). Shares `_shared/pmo-git.mjs` for git transport. Prompts as separate `.md` files.

**Tech Stack:** Node.js 20+ ESM, `claude --print` (Opus/Sonnet/Haiku), `node:test`, `node:crypto` (hashing), bash, cron.

**Spec reference:** `docs/superpowers/specs/2026-04-16-kb-generator-design.md`

**Repository:** `workspaces/strokmatic/infra/` (strokmatic/infra). Branch `feature/kb-generator` off `master`.

---

## Prerequisites

- `services/_shared/pmo-git.mjs` with `createPmoGit(...)` (exists on master)
- `/home/strokmatic/.secrets/gcp-service-account.json` on server (exists)
- PMO repo SSH push access (exists)
- `claude` CLI on server with Anthropic API key configured (exists)
- `/opt/pmo-readonly/` mirror (exists, fetched every 5min)

---

## Phase 0: Worktree + Scaffolding

### Task 0.1: Create worktree + scaffold

- [ ] **Step 1: Create worktree**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/infra
git fetch origin
git worktree add -b feature/kb-generator /home/teruel/worktrees/infra-kb-generator origin/master
```

- [ ] **Step 2: Scaffold directory structure**

```bash
cd /home/teruel/worktrees/infra-kb-generator
mkdir -p services/kb-generator/{config,lib,prompts,test,data,logs}
touch services/kb-generator/{run.sh,deploy.sh,package.json,index.mjs}
touch services/kb-generator/config/service.json
touch services/kb-generator/lib/{activity-detector,context-assembler,report-generator,revision-tracker,config}.mjs
touch services/kb-generator/prompts/{bootstrap,edit-overview-status-sprint,compress-context}.md
touch services/kb-generator/test/{activity-detector,revision-tracker}.test.mjs
touch services/kb-generator/test/test-integration.mjs
```

- [ ] **Step 3: Write .gitignore**

Content of `services/kb-generator/.gitignore`:
```
data/pmo-clone/
data/state.json
data/last-run.json
data/run.lock
logs/
node_modules/
```

- [ ] **Step 4: Write package.json**

Content of `services/kb-generator/package.json`:
```json
{
  "name": "@strokmatic/kb-generator",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test test/",
    "start": "node index.mjs"
  }
}
```

No npm dependencies — uses only Node built-ins + `_shared/pmo-git.mjs` + `claude` CLI.

- [ ] **Step 5: Commit scaffolding**

```bash
git add services/kb-generator/
git commit -m "feat(kb-generator): scaffold directory structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: `lib/revision-tracker.mjs` (PURE, TDD)

Parse and append revision table in report footer.

**Files:**
- Create: `services/kb-generator/lib/revision-tracker.mjs`
- Create: `services/kb-generator/test/revision-tracker.test.mjs`

### Task 1.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/kb-generator/test/revision-tracker.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRevisionTable, appendRevision, ensureRevisionTable } from '../lib/revision-tracker.mjs';

test('parseRevisionTable extracts entries from existing table', () => {
  const doc = `# Overview\n\nContent here.\n\n## Histórico de revisões\n\n| Data | Fonte | Alterações |\n|---|---|---|\n| 2026-04-15 | Pedro Teruel (manual) | Migração documentada. |\n| 2026-04-10 | kb-generator (auto) | 3 emails incorporados. |\n`;
  const entries = parseRevisionTable(doc);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-04-15');
  assert.equal(entries[0].source, 'Pedro Teruel (manual)');
  assert.equal(entries[1].source, 'kb-generator (auto)');
});

test('parseRevisionTable returns empty array when no table', () => {
  const doc = '# Overview\n\nNo revision table here.\n';
  assert.deepEqual(parseRevisionTable(doc), []);
});

test('appendRevision adds entry to existing table', () => {
  const doc = '# Overview\n\nContent.\n\n## Histórico de revisões\n\n| Data | Fonte | Alterações |\n|---|---|---|\n| 2026-04-10 | kb-generator (auto) | Initial. |\n';
  const result = appendRevision(doc, {
    date: '2026-04-17',
    source: 'kb-generator (auto)',
    changes: 'Status atualizado.',
  });
  assert.ok(result.includes('2026-04-17'));
  assert.ok(result.includes('Status atualizado.'));
  assert.ok(result.includes('2026-04-10')); // preserves old entry
  // New entry should be FIRST (most recent on top)
  const idx17 = result.indexOf('2026-04-17');
  const idx10 = result.indexOf('2026-04-10');
  assert.ok(idx17 < idx10);
});

test('ensureRevisionTable creates table when absent', () => {
  const doc = '# Overview\n\nContent only.\n';
  const result = ensureRevisionTable(doc);
  assert.ok(result.includes('## Histórico de revisões'));
  assert.ok(result.includes('| Data | Fonte | Alterações |'));
});

test('ensureRevisionTable preserves existing table', () => {
  const doc = '# Overview\n\n## Histórico de revisões\n\n| Data | Fonte | Alterações |\n|---|---|---|\n| 2026-04-10 | x | y |\n';
  const result = ensureRevisionTable(doc);
  assert.equal(result, doc); // unchanged
});

test('appendRevision creates table if missing then appends', () => {
  const doc = '# Overview\n\nNo table yet.\n';
  const result = appendRevision(doc, {
    date: '2026-04-17',
    source: 'kb-generator (auto)',
    changes: 'First generation.',
  });
  assert.ok(result.includes('## Histórico de revisões'));
  assert.ok(result.includes('2026-04-17'));
  assert.ok(result.includes('First generation.'));
});
```

- [ ] **Step 2: Run tests (should fail)**

```bash
cd /home/teruel/worktrees/infra-kb-generator/services/kb-generator
npm test
```

### Task 1.2: Implement

- [ ] **Step 1: Write implementation**

Content of `services/kb-generator/lib/revision-tracker.mjs`:
```javascript
/**
 * PURE: parse and append revision table in report markdown footer.
 * Table format:
 * ## Histórico de revisões
 * | Data | Fonte | Alterações |
 * |---|---|---|
 * | 2026-04-17 | kb-generator (auto) | ... |
 */

const TABLE_HEADER = '## Histórico de revisões';
const TABLE_COLUMNS = '| Data | Fonte | Alterações |';
const TABLE_SEP = '|---|---|---|';

export function parseRevisionTable(doc) {
  const headerIdx = doc.indexOf(TABLE_HEADER);
  if (headerIdx === -1) return [];
  const tableSection = doc.slice(headerIdx);
  const lines = tableSection.split('\n');
  const entries = [];
  for (const line of lines) {
    const match = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (match) {
      entries.push({ date: match[1], source: match[2].trim(), changes: match[3].trim() });
    }
  }
  return entries;
}

export function ensureRevisionTable(doc) {
  if (doc.includes(TABLE_HEADER)) return doc;
  const trimmed = doc.trimEnd();
  return `${trimmed}\n\n${TABLE_HEADER}\n\n${TABLE_COLUMNS}\n${TABLE_SEP}\n`;
}

export function appendRevision(doc, { date, source, changes }) {
  const withTable = ensureRevisionTable(doc);
  const newRow = `| ${date} | ${source} | ${changes} |`;
  // Insert new row right after the separator line (most recent first)
  const sepIdx = withTable.indexOf(TABLE_SEP);
  if (sepIdx === -1) return withTable;
  const insertPos = sepIdx + TABLE_SEP.length;
  const before = withTable.slice(0, insertPos);
  const after = withTable.slice(insertPos);
  return `${before}\n${newRow}${after}`;
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
cd /home/teruel/worktrees/infra-kb-generator
git add services/kb-generator/lib/revision-tracker.mjs services/kb-generator/test/revision-tracker.test.mjs
git commit -m "feat(kb-generator): add revision-tracker with TDD

Pure module: parseRevisionTable, ensureRevisionTable, appendRevision.
Maintains revision history table in report footers.

Tests: 6 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: `lib/activity-detector.mjs` (PURE, TDD)

Compares current index hashes/timestamps vs `last-run.json` to find projects with activity.

**Files:**
- Create: `services/kb-generator/lib/activity-detector.mjs`
- Create: `services/kb-generator/test/activity-detector.test.mjs`

### Task 2.1: Write tests

- [ ] **Step 1: Create test file**

Content of `services/kb-generator/test/activity-detector.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectActivity, computeIndexHash } from '../lib/activity-detector.mjs';

test('no last-run → all projects with indexes are active', () => {
  const currentState = {
    '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 },
    '01001': { drive_hash: 'def', email_count: 3, meeting_count: 2 },
  };
  const result = detectActivity(currentState, null);
  assert.deepEqual(result.sort(), ['01001', '03002']);
});

test('identical state → 0 active projects', () => {
  const state = {
    '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 },
  };
  const result = detectActivity(state, { projects: state });
  assert.deepEqual(result, []);
});

test('drive_hash changed → project active', () => {
  const current = { '03002': { drive_hash: 'NEW', email_count: 10, meeting_count: 5 } };
  const lastRun = { projects: { '03002': { drive_hash: 'OLD', email_count: 10, meeting_count: 5 } } };
  const result = detectActivity(current, lastRun);
  assert.deepEqual(result, ['03002']);
});

test('email_count changed → project active', () => {
  const current = { '03002': { drive_hash: 'abc', email_count: 15, meeting_count: 5 } };
  const lastRun = { projects: { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 } } };
  const result = detectActivity(current, lastRun);
  assert.deepEqual(result, ['03002']);
});

test('meeting_count changed → project active', () => {
  const current = { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 8 } };
  const lastRun = { projects: { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 } } };
  const result = detectActivity(current, lastRun);
  assert.deepEqual(result, ['03002']);
});

test('new project not in last-run → active', () => {
  const current = {
    '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 },
    '01001': { drive_hash: 'new', email_count: 1, meeting_count: 0 },
  };
  const lastRun = { projects: { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5 } } };
  const result = detectActivity(current, lastRun);
  assert.deepEqual(result, ['01001']);
});

test('facts_last_ts changed → project active', () => {
  const current = { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5, facts_last_ts: '2026-04-17T10:00:00Z' } };
  const lastRun = { projects: { '03002': { drive_hash: 'abc', email_count: 10, meeting_count: 5, facts_last_ts: '2026-04-16T10:00:00Z' } } };
  const result = detectActivity(current, lastRun);
  assert.deepEqual(result, ['03002']);
});

test('computeIndexHash returns consistent hash for same content', () => {
  const h1 = computeIndexHash('{"a":1}');
  const h2 = computeIndexHash('{"a":1}');
  assert.equal(h1, h2);
  const h3 = computeIndexHash('{"a":2}');
  assert.notEqual(h1, h3);
});
```

### Task 2.2: Implement

- [ ] **Step 1: Write implementation**

Content of `services/kb-generator/lib/activity-detector.mjs`:
```javascript
/**
 * PURE: detect which projects have activity since last run.
 * Compares current index state (hashes, counts, timestamps)
 * against last-run.json snapshot.
 */
import { createHash } from 'node:crypto';

export function computeIndexHash(content) {
  return createHash('md5').update(content).digest('hex').slice(0, 12);
}

export function detectActivity(currentState, lastRun) {
  const active = [];
  const prev = lastRun?.projects || {};
  for (const [code, current] of Object.entries(currentState)) {
    const last = prev[code];
    if (!last) {
      active.push(code);
      continue;
    }
    if (
      current.drive_hash !== last.drive_hash ||
      current.email_count !== last.email_count ||
      current.meeting_count !== last.meeting_count ||
      current.facts_last_ts !== last.facts_last_ts ||
      current.clickup_snapshot !== last.clickup_snapshot
    ) {
      active.push(code);
    }
  }
  return active;
}
```

- [ ] **Step 2: Run tests + commit**

```bash
npm test
git add services/kb-generator/lib/activity-detector.mjs services/kb-generator/test/activity-detector.test.mjs
git commit -m "feat(kb-generator): add activity-detector with TDD

Pure module: detectActivity compares index hashes/counts/timestamps
vs last-run snapshot. computeIndexHash for Drive index content.

Tests: 8 passing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: `lib/context-assembler.mjs` (I/O)

Aggregates data from all sources for a given project. Similar to jarvis-chat's `project-context.mjs` but produces a larger bundle for LLM report generation.

**Files:**
- Create: `services/kb-generator/lib/context-assembler.mjs`

### Task 3.1: Implement

- [ ] **Step 1: Write implementation**

Content of `services/kb-generator/lib/context-assembler.mjs`:
```javascript
/**
 * Assemble context from all data sources for a given project.
 * Reads: PMO mirror (drive-index, emails, meetings), chat facts, ClickUp state.
 * Returns: structured context object for prompt injection.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { computeIndexHash } from './activity-detector.mjs';

const PMO_ROOT = process.env.PMO_ROOT || '/opt/pmo-readonly';
const FACTS_DIR = process.env.FACTS_DIR || '/opt/jarvis-chat/data/facts';
const CLICKUP_DIR = process.env.CLICKUP_DIR || '/opt/github-clickup-sync';
const MAX_CHARS = 24000;

function safeRead(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function safeJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

export function assembleContext(projectCode, product) {
  const parts = [];
  let totalChars = 0;
  const snapshot = {};

  function add(label, content) {
    if (!content || totalChars >= MAX_CHARS) return;
    const remaining = MAX_CHARS - totalChars;
    const trimmed = content.length > remaining
      ? content.slice(0, remaining) + '\n…[truncated]'
      : content;
    parts.push(`### ${label}\n${trimmed}`);
    totalChars += trimmed.length;
  }

  // 1. Existing reports (for edit mode — LLM needs to see current state)
  const reportsDir = join(PMO_ROOT, 'projects', projectCode, 'reports/md');
  if (existsSync(reportsDir)) {
    try {
      const files = readdirSync(reportsDir)
        .filter(f => f.endsWith('.md'))
        .sort();
      for (const f of files.slice(0, 3)) {
        add(`PMO report: ${f}`, safeRead(join(reportsDir, f)));
      }
    } catch {}
  }

  // 2. Emails (recent 15)
  const emailIdx = safeJson(join(PMO_ROOT, 'projects', projectCode, 'emails/index.json'));
  if (emailIdx) {
    const entries = (emailIdx.entries || []).slice(0, 15);
    snapshot.email_count = emailIdx.message_count || entries.length;
    if (entries.length > 0) {
      const summary = entries.map(e =>
        `[${e.date?.slice(0, 10)}] ${e.sender_name || e.sender_email}: ${e.subject}\n  ${e.snippet?.slice(0, 100) || ''}`
      ).join('\n');
      add(`Emails recentes (${entries.length})`, summary);
    }
  }

  // 3. Drive index
  const driveRaw = safeRead(join(PMO_ROOT, 'projects', projectCode, 'drive-index.json'));
  if (driveRaw) {
    const driveIdx = JSON.parse(driveRaw);
    snapshot.drive_hash = computeIndexHash(driveRaw);
    add(`Drive (${driveIdx.stats?.files || 0} files, ${driveIdx.stats?.folders || 0} folders)`,
      `Gerado: ${driveIdx.generated}\nFolders: ${(driveIdx.sources || []).map(s => s.name).join(', ')}`);
  }

  // 4. Meetings (per product)
  if (product) {
    const meetingIdx = safeJson(join(PMO_ROOT, 'products', product, 'meetings/index.json'));
    if (meetingIdx) {
      const recent = (meetingIdx.meetings || []).slice(0, 8);
      snapshot.meeting_count = (meetingIdx.meetings || []).length;
      if (recent.length > 0) {
        const summary = recent.map(m =>
          `[${m.meeting_date}] ${m.title_clean} (${m.meeting_type})`
        ).join('\n');
        add(`Reuniões recentes (${recent.length})`, summary);
      }
    }
    // Project-level meetings too
    const projMeetingIdx = safeJson(join(PMO_ROOT, 'projects', projectCode, 'meetings/index.json'));
    if (projMeetingIdx) {
      const recent = (projMeetingIdx.meetings || []).slice(0, 5);
      if (recent.length > 0) {
        add(`Reuniões do projeto (${recent.length})`,
          recent.map(m => `[${m.meeting_date}] ${m.title_clean}`).join('\n'));
      }
    }
  }

  // 5. Chat facts (filtered by project_code)
  try {
    if (existsSync(FACTS_DIR)) {
      const factFiles = readdirSync(FACTS_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
      const facts = [];
      for (const ff of factFiles.slice(0, 2)) {
        const lines = readFileSync(join(FACTS_DIR, ff), 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const fact = JSON.parse(line);
            if (fact.source?.project_code === projectCode) {
              facts.push(fact);
            }
          } catch {}
        }
      }
      if (facts.length > 0) {
        snapshot.facts_last_ts = facts[0].extracted_at || null;
        const summary = facts.slice(0, 10).map(f => {
          const text = f.fact || f.content || f.summary || JSON.stringify(f).slice(0, 150);
          return `[${f.extracted_at?.slice(0, 10)}] ${text}`;
        }).join('\n');
        add(`Chat facts (${facts.length})`, summary);
      }
    }
  } catch {}

  // 6. ClickUp tasks
  try {
    if (existsSync(CLICKUP_DIR)) {
      const stateFiles = readdirSync(CLICKUP_DIR).filter(f => f.startsWith('.state-') && f.endsWith('.json'));
      const tasks = [];
      for (const sf of stateFiles) {
        const st = safeJson(join(CLICKUP_DIR, sf));
        if (!st) continue;
        for (const [key, value] of Object.entries(st)) {
          if (!key.startsWith('clickup_task_') || key.includes('_')) continue;
          const issueNum = key.replace('clickup_task_', '');
          const status = st[`clickup_task_${issueNum}_status`] || 'unknown';
          if (status !== 'done') {
            tasks.push(`#${issueNum}: ${status}`);
          }
        }
      }
      if (tasks.length > 0) {
        snapshot.clickup_snapshot = computeIndexHash(JSON.stringify(tasks));
        add(`ClickUp tasks ativas (${tasks.length})`, tasks.slice(0, 20).join('\n'));
      }
    }
  } catch {}

  return {
    context: parts.join('\n\n'),
    totalChars,
    snapshot,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add services/kb-generator/lib/context-assembler.mjs
git commit -m "feat(kb-generator): add context-assembler

Aggregates project data from 6 sources: PMO reports, emails,
drive index, meetings, chat facts, ClickUp tasks. Returns
structured context string + snapshot for activity detection.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: Prompt templates

**Files:**
- Create: `services/kb-generator/prompts/bootstrap.md`
- Create: `services/kb-generator/prompts/edit-overview-status-sprint.md`
- Create: `services/kb-generator/prompts/compress-context.md`

### Task 4.1: Write prompt templates

- [ ] **Step 1: Write `prompts/bootstrap.md`**

Content of `services/kb-generator/prompts/bootstrap.md`:
```markdown
Você é um gerador de relatórios de projeto para a Strokmatic. Gere 3 relatórios em PT-BR com base APENAS no contexto fornecido.

PROJETO: {{PROJECT_CODE}} — {{PROJECT_NAME}}
PRODUTO: {{PRODUCT}}

CONTEXTO DISPONÍVEL:
{{CONTEXT}}

Gere os 3 relatórios abaixo, delimitados exatamente como indicado:

--- REPORT: overview.md ---
Visão geral do projeto: escopo, objetivo, equipe envolvida, estado atual dos componentes, cronograma de alto nível. Baseie-se nos dados disponíveis.

--- REPORT: status.md ---
Status operacional: o que aconteceu recentemente (emails, reuniões, commits, decisões). Foco em fatos concretos dos dados fornecidos.

--- REPORT: sprint.md ---
Sprint atual: tasks ativas, progresso, blockers, próximos passos. Baseie-se nas tasks do ClickUp e nas reuniões recentes.

REGRAS:
- PT-BR sempre
- Baseie-se APENAS no contexto fornecido. Se não houver informação, diga que não há dados disponíveis.
- RESTRIÇÃO FINANCEIRA: NUNCA revele valores de contrato, preços cobrados, margens, propostas comerciais ou faturamento do projeto com o cliente. Informações sobre compras de fornecedores são permitidas.
- Cada relatório deve terminar com:

## Histórico de revisões

| Data | Fonte | Alterações |
|---|---|---|
| {{DATE}} | kb-generator (auto) | Geração inicial do relatório. |
```

- [ ] **Step 2: Write `prompts/edit-overview-status-sprint.md`**

Content of `services/kb-generator/prompts/edit-overview-status-sprint.md`:
```markdown
Você está EDITANDO relatórios de projeto existentes. NÃO reescreva do zero.

PROJETO: {{PROJECT_CODE}} — {{PROJECT_NAME}}
PRODUTO: {{PRODUCT}}

MUDANÇAS DETECTADAS (atividade recente):
{{CONTEXT}}

RELATÓRIOS ATUAIS (edite apenas o que mudou):

--- CURRENT: overview.md ---
{{CURRENT_OVERVIEW}}

--- CURRENT: status.md ---
{{CURRENT_STATUS}}

--- CURRENT: sprint.md ---
{{CURRENT_SPRINT}}

REGRAS:
- Altere APENAS parágrafos afetados pelas mudanças nos dados fornecidos
- Preserve TODO o conteúdo existente que não foi afetado
- Se não há alterações relevantes para um relatório, retorne-o INALTERADO
- Adicione uma linha à tabela "Histórico de revisões" no final de cada relatório modificado: data {{DATE}}, fonte "kb-generator (auto)", e resumo das alterações feitas
- Se o relatório não foi alterado, NÃO adicione linha à tabela
- RESTRIÇÃO FINANCEIRA: NUNCA revele valores de contrato, preços, margens ou faturamento com o cliente
- PT-BR sempre

Retorne os 3 relatórios no formato:

--- REPORT: overview.md ---
(conteúdo completo, editado ou inalterado)

--- REPORT: status.md ---
(conteúdo completo, editado ou inalterado)

--- REPORT: sprint.md ---
(conteúdo completo, editado ou inalterado)
```

- [ ] **Step 3: Write `prompts/compress-context.md`**

Content of `services/kb-generator/prompts/compress-context.md`:
```markdown
Comprima os 3 relatórios abaixo em um digest de ~2000 tokens para consumo de IA (jarvis-chat, agentes). PT-BR.

PROJETO: {{PROJECT_CODE}} — {{PROJECT_NAME}}

--- overview.md ---
{{OVERVIEW}}

--- status.md ---
{{STATUS}}

--- sprint.md ---
{{SPRINT}}

Produza um digest flat (sem headers markdown) focando em:
- Estado atual do projeto (1-2 frases)
- Mudanças recentes mais relevantes
- Bloqueios ou riscos ativos
- Próximos passos concretos
- Decisões pendentes

NÃO inclua tabela de revisão. NÃO use headers (#). Formato paragráfo corrido com quebras de linha simples entre seções.
RESTRIÇÃO FINANCEIRA ativa.
```

- [ ] **Step 4: Commit**

```bash
git add services/kb-generator/prompts/
git commit -m "feat(kb-generator): add prompt templates

3 templates:
- bootstrap.md: first generation (Opus), 3 reports at once
- edit-overview-status-sprint.md: surgical edit (Sonnet/Haiku)
- compress-context.md: context.md digest (Haiku)

All PT-BR, financial restriction, revision table instructions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: `lib/report-generator.mjs` (I/O)

Calls `claude --print` with prompt templates. Handles bootstrap vs edit mode, model selection.

**Files:**
- Create: `services/kb-generator/lib/report-generator.mjs`

### Task 5.1: Implement

- [ ] **Step 1: Write implementation**

Content of `services/kb-generator/lib/report-generator.mjs`:
```javascript
/**
 * Call claude --print with prompt templates to generate/edit reports.
 * Handles bootstrap (Opus) vs edit (Sonnet/Haiku) mode.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'prompts');

const MODELS = {
  bootstrap: 'claude-opus-4-6',
  edit_overview: 'claude-sonnet-4-6',
  edit_status_sprint: 'claude-haiku-4-5-20251001',
  compress: 'claude-haiku-4-5-20251001',
  compress_bootstrap: 'claude-sonnet-4-6',
};

function loadPrompt(name) {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');
}

function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value || '');
  }
  return result;
}

function callClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', model,
      '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function parseReports(output) {
  const reports = {};
  const sections = output.split(/---\s*REPORT:\s*/);
  for (const section of sections) {
    const match = section.match(/^(overview|status|sprint|context)\.md\s*---\s*\n([\s\S]*)/);
    if (match) {
      reports[match[1]] = match[2].trim();
    }
  }
  return reports;
}

export async function generateReports({ projectCode, projectName, product, context, existingReports, date }) {
  const isBootstrap = !existingReports;
  const vars = {
    PROJECT_CODE: projectCode,
    PROJECT_NAME: projectName,
    PRODUCT: product,
    CONTEXT: context,
    DATE: date,
    CURRENT_OVERVIEW: existingReports?.overview || '',
    CURRENT_STATUS: existingReports?.status || '',
    CURRENT_SPRINT: existingReports?.sprint || '',
  };

  // Call 1: generate/edit overview + status + sprint
  const promptName = isBootstrap ? 'bootstrap' : 'edit-overview-status-sprint';
  const model = isBootstrap ? MODELS.bootstrap : MODELS.edit_overview;
  const prompt = fillTemplate(loadPrompt(promptName), vars);
  const output = await callClaude(prompt, model);
  const reports = parseReports(output);

  if (!reports.overview && !reports.status && !reports.sprint) {
    throw new Error('LLM returned no parseable reports');
  }

  return {
    overview: reports.overview || existingReports?.overview || '',
    status: reports.status || existingReports?.status || '',
    sprint: reports.sprint || existingReports?.sprint || '',
    isBootstrap,
  };
}

export async function generateContext({ projectCode, projectName, overview, status, sprint, isBootstrap }) {
  const vars = {
    PROJECT_CODE: projectCode,
    PROJECT_NAME: projectName,
    OVERVIEW: overview,
    STATUS: status,
    SPRINT: sprint,
  };
  const prompt = fillTemplate(loadPrompt('compress-context'), vars);
  const model = isBootstrap ? MODELS.compress_bootstrap : MODELS.compress;
  const output = await callClaude(prompt, model);
  return output;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/kb-generator/lib/report-generator.mjs
git commit -m "feat(kb-generator): add report-generator (claude --print wrapper)

Handles bootstrap (Opus) vs edit (Sonnet/Haiku) mode. Loads prompt
templates from prompts/*.md, fills variables, parses delimited output
into individual reports. Two-call pipeline: Call 1 generates 3 reports,
Call 2 compresses into context.md.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6: `lib/config.mjs` + `config/service.json`

### Task 6.1: Write config

- [ ] **Step 1: Write `config/service.json`**

Content of `services/kb-generator/config/service.json`:
```json
{
  "pmo_repo": {
    "url": "git@github.com:teruelskm/pmo.git",
    "branch": "master",
    "clone_path": "/opt/jarvis-kb-generator/data/pmo-clone",
    "commit_author_name": "JARVIS kb-generator",
    "commit_author_email": "jarvis-kb-generator@strokmatic.internal"
  },
  "pmo_readonly": "/opt/pmo-readonly",
  "project_codes_path": "config/project-codes.json",
  "output_path_template": "projects/{code}/reports/md",
  "facts_dir": "/opt/jarvis-chat/data/facts",
  "clickup_dir": "/opt/github-clickup-sync"
}
```

### Task 6.2: Write config loader

- [ ] **Step 1: Implement `lib/config.mjs`**

Content of `services/kb-generator/lib/config.mjs`:
```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadConfig(configPath) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!cfg.pmo_repo?.url) throw new Error('service.json: pmo_repo.url required');
  return cfg;
}

export function loadProjectCodes(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const projects = [];
  for (const [code, data] of Object.entries(raw)) {
    if (code.startsWith('_') || typeof data !== 'object' || data === null) continue;
    projects.push({ code, ...data });
  }
  return projects;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/kb-generator/config/service.json services/kb-generator/lib/config.mjs
git commit -m "feat(kb-generator): add config loader + service.json

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7: `index.mjs` orchestrator + integration smoke

### Task 7.1: Implement orchestrator

- [ ] **Step 1: Write `index.mjs`**

Content of `services/kb-generator/index.mjs`:
```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPmoGit } from '../_shared/pmo-git.mjs';
import { loadConfig, loadProjectCodes } from './lib/config.mjs';
import { assembleContext } from './lib/context-assembler.mjs';
import { detectActivity, computeIndexHash } from './lib/activity-detector.mjs';
import { generateReports, generateContext } from './lib/report-generator.mjs';
import { appendRevision } from './lib/revision-tracker.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HM_DATA_DIR || join(__dirname, 'data');
const CONFIG_PATH = process.env.HM_CONFIG_PATH || join(__dirname, 'config/service.json');
const STATE_PATH = join(DATA_DIR, 'state.json');
const LAST_RUN_PATH = join(DATA_DIR, 'last-run.json');

const DRY_RUN = process.env.HM_DRY_RUN === '1';
const SKIP_PUSH = process.env.HM_SKIP_PUSH === '1';
const ONLY_PROJECT = process.env.HM_ONLY_PROJECT || null;

function writeState({ startedAt, status, exitCode, details }) {
  mkdirSync(DATA_DIR, { recursive: true });
  const state = {
    service: 'kb-generator',
    last_run: new Date().toISOString(),
    last_status: status,
    duration_ms: Date.now() - startedAt,
    exit_code: exitCode,
    details,
  };
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, STATE_PATH);
}

function loadLastRun() {
  try { return JSON.parse(readFileSync(LAST_RUN_PATH, 'utf-8')); } catch { return null; }
}

function saveLastRun(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${LAST_RUN_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, LAST_RUN_PATH);
}

function safeRead(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

async function main() {
  const startedAt = Date.now();
  const details = {
    projects_detected_active: 0,
    projects_updated: 0,
    projects_bootstrapped: 0,
    projects_skipped_error: 0,
    reports_written: 0,
    llm_calls: 0,
    git_commit_sha: null,
    pushed: false,
  };

  let cfg;
  try {
    cfg = loadConfig(CONFIG_PATH);
  } catch (err) {
    console.error('[kb-generator] fatal: config load failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details });
    process.exit(1);
  }

  // Set env vars for context-assembler
  process.env.PMO_ROOT = process.env.PMO_ROOT || cfg.pmo_readonly;
  process.env.FACTS_DIR = process.env.FACTS_DIR || cfg.facts_dir;
  process.env.CLICKUP_DIR = process.env.CLICKUP_DIR || cfg.clickup_dir;

  const pmoGit = createPmoGit({
    url: cfg.pmo_repo.url,
    branch: cfg.pmo_repo.branch,
    clonePath: cfg.pmo_repo.clone_path,
    author: { name: cfg.pmo_repo.commit_author_name, email: cfg.pmo_repo.commit_author_email },
  });

  try {
    await pmoGit.cloneOrPull();
  } catch (err) {
    console.error('[kb-generator] fatal: pmo clone/pull failed', err.message);
    writeState({ startedAt, status: 'failed', exitCode: 1, details });
    process.exit(1);
  }

  const projectCodesPath = join(cfg.pmo_readonly, cfg.project_codes_path);
  const allProjects = loadProjectCodes(projectCodesPath);

  // Build current state for activity detection
  const currentState = {};
  for (const project of allProjects) {
    const { snapshot } = assembleContext(project.code, project.product);
    if (Object.keys(snapshot).length > 0) {
      currentState[project.code] = snapshot;
    }
  }

  const lastRun = loadLastRun();
  let activeProjects = detectActivity(currentState, lastRun);
  details.projects_detected_active = activeProjects.length;

  if (ONLY_PROJECT) {
    activeProjects = activeProjects.filter(c => c === ONLY_PROJECT);
    if (activeProjects.length === 0) activeProjects = [ONLY_PROJECT]; // force
  }

  console.log(`[kb-generator] ${activeProjects.length} projects with activity: ${activeProjects.join(', ') || 'none'}`);

  const date = new Date().toISOString().slice(0, 10);
  const updatedProjects = [];

  for (const code of activeProjects) {
    const project = allProjects.find(p => p.code === code);
    if (!project) continue;

    try {
      const { context } = assembleContext(code, project.product);

      // Load existing reports from PMO clone
      const reportsDir = join(cfg.pmo_repo.clone_path, cfg.output_path_template.replace('{code}', code));
      const existingOverview = safeRead(join(reportsDir, 'overview.md'));
      const existingStatus = safeRead(join(reportsDir, 'status.md'));
      const existingSprint = safeRead(join(reportsDir, 'sprint.md'));
      const existingReports = (existingOverview || existingStatus || existingSprint)
        ? { overview: existingOverview, status: existingStatus, sprint: existingSprint }
        : null;

      // Call 1: generate/edit 3 reports
      console.log(`[kb-generator] ${code}: ${existingReports ? 'editing' : 'bootstrapping'}...`);
      const reports = await generateReports({
        projectCode: code,
        projectName: project.name,
        product: project.product,
        context,
        existingReports,
        date,
      });
      details.llm_calls++;

      if (reports.isBootstrap) details.projects_bootstrapped++;

      // Call 2: compress to context.md
      const contextMd = await generateContext({
        projectCode: code,
        projectName: project.name,
        overview: reports.overview,
        status: reports.status,
        sprint: reports.sprint,
        isBootstrap: reports.isBootstrap,
      });
      details.llm_calls++;

      if (!DRY_RUN) {
        mkdirSync(reportsDir, { recursive: true });
        for (const [name, content] of Object.entries(reports)) {
          if (name === 'isBootstrap' || !content) continue;
          writeFileSync(join(reportsDir, `${name}.md`), content + '\n', 'utf-8');
          details.reports_written++;
        }
        writeFileSync(join(reportsDir, 'context.md'), contextMd + '\n', 'utf-8');
        details.reports_written++;
      }

      updatedProjects.push(code);
      details.projects_updated++;
      console.log(`[kb-generator] ${code}: ${details.reports_written} reports written`);
    } catch (err) {
      console.error(`[kb-generator] ${code} failed:`, err.message);
      details.projects_skipped_error++;
    }
  }

  if (!DRY_RUN && updatedProjects.length > 0) {
    const msg = `chore(kb-generator): daily update — ${updatedProjects.length} projects\n\nUpdated: ${updatedProjects.join(', ')}\n`;
    const committed = await pmoGit.commitAll(msg);
    if (committed) {
      details.git_commit_sha = (await pmoGit.headSha()).slice(0, 7);
      if (!SKIP_PUSH) {
        try {
          await pmoGit.push();
          details.pushed = true;
        } catch (err) {
          console.error('[kb-generator] push failed:', err.message);
        }
      }
    }
  }

  // Save current state as last-run for next cycle's delta detection
  saveLastRun({ last_run: new Date().toISOString(), projects: currentState });

  let status = 'success';
  if (details.projects_skipped_error > 0) status = 'partial';
  writeState({ startedAt, status, exitCode: 0, details });
  process.exit(0);
}

main().catch(err => {
  console.error('[kb-generator] uncaught:', err);
  process.exit(1);
});
```

### Task 7.2: Write integration smoke

- [ ] **Step 1: Create `test/test-integration.mjs`**

Content of `services/kb-generator/test/test-integration.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = dirname(__dirname);

function setupFakePmoRemote() {
  const remote = mkdtempSync(join(tmpdir(), 'pmo-remote-'));
  execSync('git init --bare', { cwd: remote });
  const seed = mkdtempSync(join(tmpdir(), 'pmo-seed-'));
  execSync('git init -b master', { cwd: seed });
  execSync('git config user.email "seed@test.internal"', { cwd: seed });
  execSync('git config user.name "seed"', { cwd: seed });
  mkdirSync(join(seed, 'config'));
  writeFileSync(join(seed, 'config/project-codes.json'), JSON.stringify({
    '99999': { name: 'Test Project', product: 'visionking' },
  }), 'utf-8');
  execSync('git add .', { cwd: seed });
  execSync('git commit -m "seed"', { cwd: seed });
  execSync(`git remote add origin ${remote}`, { cwd: seed });
  execSync('git push origin master', { cwd: seed });
  return remote;
}

test('integration: DRY_RUN produces state.json', async () => {
  const remote = setupFakePmoRemote();
  const dataDir = mkdtempSync(join(tmpdir(), 'kb-data-'));
  const cloneDir = join(dataDir, 'pmo-clone');
  const pmoReadonly = mkdtempSync(join(tmpdir(), 'pmo-ro-'));
  mkdirSync(join(pmoReadonly, 'config'));
  writeFileSync(join(pmoReadonly, 'config/project-codes.json'), JSON.stringify({
    '99999': { name: 'Test', product: 'visionking' },
  }), 'utf-8');

  const cfgDir = mkdtempSync(join(tmpdir(), 'kb-cfg-'));
  writeFileSync(join(cfgDir, 'service.json'), JSON.stringify({
    pmo_repo: { url: remote, branch: 'master', clone_path: cloneDir,
      commit_author_name: 'test', commit_author_email: 'test@test.internal' },
    pmo_readonly: pmoReadonly,
    project_codes_path: 'config/project-codes.json',
    output_path_template: 'projects/{code}/reports/md',
    facts_dir: '/nonexistent',
    clickup_dir: '/nonexistent',
  }), 'utf-8');

  const result = spawnSync('node', ['index.mjs'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      HM_DATA_DIR: dataDir,
      HM_CONFIG_PATH: join(cfgDir, 'service.json'),
      HM_DRY_RUN: '1',
      HM_SKIP_PUSH: '1',
      PMO_ROOT: pmoReadonly,
    },
    encoding: 'utf-8',
    timeout: 30000,
  });

  const statePath = join(dataDir, 'state.json');
  assert.ok(existsSync(statePath), `state.json missing: stdout=${result.stdout?.slice(0, 200)}, stderr=${result.stderr?.slice(0, 200)}`);
  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  assert.equal(state.service, 'kb-generator');
});
```

- [ ] **Step 2: Commit**

```bash
git add services/kb-generator/index.mjs services/kb-generator/test/test-integration.mjs
git commit -m "feat(kb-generator): add orchestrator + integration smoke

Pipeline: loadConfig → pmo cloneOrPull → assembleContext per project
→ detectActivity → generateReports (Call 1) → generateContext (Call 2)
→ write reports → commitAll + push → saveLastRun → state.json.

Env flags: HM_DRY_RUN, HM_SKIP_PUSH, HM_ONLY_PROJECT.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8: Shell scaffolding

### Task 8.1: run.sh + deploy.sh

- [ ] **Step 1: Write `run.sh`**

Content of `services/kb-generator/run.sh`:
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/logs/run-$(date -u +%Y-%m-%d).log"
mkdir -p "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data"

LOCK_FILE="$SCRIPT_DIR/data/run.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -u +%FT%TZ)] kb-generator: previous run in flight, skipping" >> "$LOG_FILE"
  exit 0
fi

{
  echo "[$(date -u +%FT%TZ)] kb-generator: starting"
  node index.mjs
  echo "[$(date -u +%FT%TZ)] kb-generator: done (exit $?)"
} >> "$LOG_FILE" 2>&1
```

- [ ] **Step 2: Write `deploy.sh`**

Content of `services/kb-generator/deploy.sh`:
```bash
#!/bin/bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-strokmatic@192.168.15.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/jarvis-kb-generator}"
CRON_SCHEDULE="${CRON_SCHEDULE:-30 23 * * *}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${SSHPASS:?SSHPASS env required}"

SSH="sshpass -e ssh -o StrictHostKeyChecking=no"
RSYNC="sshpass -e rsync -e 'ssh -o StrictHostKeyChecking=no'"

echo "==> ensuring remote dirs"
$SSH "$REMOTE_HOST" "echo '$SSHPASS' | sudo -S mkdir -p $REMOTE_DIR && echo '$SSHPASS' | sudo -S chown strokmatic:strokmatic $REMOTE_DIR"

echo "==> syncing kb-generator to $REMOTE_DIR"
bash -c "$RSYNC -a --delete --exclude 'data' --exclude 'logs' --exclude 'node_modules' --exclude 'test' \"$SCRIPT_DIR/\" \"$REMOTE_HOST:$REMOTE_DIR/\""

echo "==> installing cron"
$SSH "$REMOTE_HOST" "crontab -l 2>/dev/null | grep -v 'kb-generator' > /tmp/cron.new; echo '$CRON_SCHEDULE . /home/strokmatic/.nvm/nvm.sh && cd $REMOTE_DIR && bash run.sh >> $REMOTE_DIR/logs/cron.log 2>&1 # kb-generator' >> /tmp/cron.new; crontab /tmp/cron.new"

echo "==> deploy complete"
$SSH "$REMOTE_HOST" "crontab -l | grep kb-generator"
```

- [ ] **Step 3: chmod + commit**

```bash
chmod +x services/kb-generator/run.sh services/kb-generator/deploy.sh
git add services/kb-generator/run.sh services/kb-generator/deploy.sh
git commit -m "feat(kb-generator): add run.sh + deploy.sh

run.sh: flock guard, daily log rotation.
deploy.sh: rsync, sudo mkdir, cron 30 23 * * *.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9: Deploy + dry-run

### Task 9.1: Deploy

- [ ] **Step 1: Deploy**

```bash
cd /home/teruel/worktrees/infra-kb-generator/services/kb-generator
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" bash deploy.sh
```

### Task 9.2: Dry-run single project

- [ ] **Step 1: Run DRY_RUN for 03002**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-kb-generator && HM_DRY_RUN=1 HM_ONLY_PROJECT=03002 node index.mjs 2>&1 | tail -20"
```

- [ ] **Step 2: Check state.json**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 "cat /opt/jarvis-kb-generator/data/state.json"
```

### Task 9.3: Real run single project

- [ ] **Step 1: Run for 03002 (no DRY_RUN)**

```bash
SSHPASS="$(cat ~/.secrets/vk-ssh-password)" sshpass -e ssh strokmatic@192.168.15.2 ". /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-kb-generator && HM_ONLY_PROJECT=03002 node index.mjs 2>&1 | tail -20"
```

- [ ] **Step 2: Verify reports in PMO**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/pmo
git pull origin master
ls projects/03002/reports/md/
cat projects/03002/reports/md/overview.md | head -30
```

- [ ] **Step 3: Check revision table**

```bash
tail -10 projects/03002/reports/md/overview.md
```

---

## Phase 10: Health-monitor + PR

### Task 10.1: Register in health-monitor

Add to server's health-monitor config:
```json
{
  "name": "kb-generator",
  "state_file": "/opt/jarvis-kb-generator/data/state.json",
  "cadence_minutes": 1440,
  "staleness_factor": 1.05,
  "alert_on_partial": true,
  "added_at": "<NOW>"
}
```

### Task 10.2: Push + PR

```bash
cd /home/teruel/worktrees/infra-kb-generator
git push -u origin feature/kb-generator
gh pr create --title "feat(kb-generator): daily project report generator" --body "..."
gh pr merge <N> --merge
```

---

## Self-review checkpoints

### Spec coverage
- §1 resumo → Phase 7 orchestrator
- §4.2 tree → Phase 0 scaffolding
- §4.3 modules → Phases 1-6
- §4.4 flow → Phase 7 orchestrator
- §5 models → Phase 5 report-generator MODELS constant
- §6 prompts → Phase 4
- §7 activity detection → Phase 2 + Phase 3 snapshot
- §8 output → Phase 7 writes
- §9 errors → Phase 7 try/catch per project
- §10 tests → Phases 1-2 TDD + Phase 7 smoke
- §11 rollout → Phases 9-10

### Type consistency
- `assembleContext(code, product)` returns `{context, totalChars, snapshot}` — used in both activity detection and report generation
- `detectActivity(currentState, lastRun)` returns `string[]` of active project codes
- `generateReports({...})` returns `{overview, status, sprint, isBootstrap}`
- `generateContext({...})` returns `string` (context.md content)
- `appendRevision(doc, {date, source, changes})` returns updated doc string
- `parseReports(output)` returns `{overview?, status?, sprint?}` parsed from delimited LLM output
