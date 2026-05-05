# SG3 Compliance Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 (GM only) compliance monitor described in `docs/superpowers/specs/2026-05-05-sg3-compliance-monitor-design.md`. A daily cron pipeline ingests data from SG3, the GM contracts Drive folder, and Gmail (label `sg3`), syncs into a Google Sheet (13 abas), then sends a daily compliance report to a Google Chat space with prazos próximos, vencidos, pendências de estado, drift Drive×SG3, and current active liberations.

**Architecture:** Five-stage pipeline (3 parallel collectors → sync → check) modeled on the existing `vk-health` pattern. ESM Node.js scripts in `scripts/sg3-monitor/`. Source-of-truth = Google Sheet. Snapshots persisted per-day under `data/sg3-monitor/{date}/` for audit and graceful degradation. Pure-JS libraries first (testable), then external service integrations.

**Tech Stack:**
- Node.js 20 (ESM, `.mjs`), `node:test` for tests
- `googleapis` for Drive/Sheets/Gmail/Chat (service account at `config/credentials/gcp-service-account.json`)
- `playwright` for SG3 scraping
- `pdftotext` (poppler-utils) for PDF text extraction; `claude --print` as LLM fallback
- Existing helpers: `mcp-servers/lib/google-auth.mjs` (`createGoogleAuth`)
- Notifier: Google Chat (primary), Telegram via `jarvis_stk_alerts_bot` (fallback + escalation)
- Cron entry triggered by `scripts/sg3-monitor/run.sh`

---

## File Structure

**New files:**

```
scripts/sg3-monitor/
  run.sh                          # bash orchestrator (cron entry)
  bootstrap.mjs                   # one-time spike + initial extraction
  collect-sg3.mjs                 # SG3 collector
  collect-drive-contratos.mjs     # Drive collector
  collect-emails.mjs              # Gmail collector
  sync-sheet.mjs                  # snapshots → Sheet
  check-expiries.mjs              # alert engine
  status.mjs                      # CLI: current liberações ativas
  lib/
    google-clients.mjs            # builds Sheets/Drive/Gmail/Chat clients (uses createGoogleAuth)
    sheet-schema.mjs              # tab definitions: columns, types, FK rules
    sheet-client.mjs              # high-level Sheet ops (upsert, validate, read)
    expiry-rules.mjs              # lead-time matching, prazo_efetivo, prazo_liberacao_efetivo
    contract-name-parser.mjs      # filename regex parsers
    contract-pdf-parser.mjs       # PDF text → structured fields
    email-classifier.mjs          # config-driven classifier
    email-extractor.mjs           # claude --print wrapper for LLM extraction
    sg3-client.mjs                # Playwright SG3 wrapper
    notifier.mjs                  # Chat post + Telegram fallback/escalation
    alertas-log.mjs               # dedupe registry
    snapshot-loader.mjs           # load latest available snapshot per source
    config.mjs                    # load + validate config files
    logger.mjs                    # tiny structured logger

config/sg3-monitor/
  config.json
  email-rules.json
  clients/
    gm.json

tests/sg3-monitor/
  unit/
    expiry-rules.test.mjs
    contract-name-parser.test.mjs
    contract-pdf-parser.test.mjs
    email-classifier.test.mjs
    sheet-schema.test.mjs
    alertas-log.test.mjs
  integration/
    sync-sheet.test.mjs
    check-expiries.test.mjs
  fixtures/
    snapshots/                    # canned sg3/drive/email snapshots
    pdfs/                         # text outputs from sample PDFs
    emails/                       # sample email payloads
```

**Modified files:**
- `package.json` (root) — added if missing; defines `npm run sg3:*` scripts and dependencies (`googleapis`, `playwright`).
- `.gitignore` — append entries for `data/sg3-monitor/`, `config/sg3-monitor/clients/gm.json` (contains URLs/selectors not credentials but still environment-specific).

**Files NOT created in Phase 1 (out of scope):**
- MCP server `sg3-monitor`
- Skill `/sg3`
- Any web UI or dashboard

---

## Phase A — Project skeleton & root package.json

### Task 1: Project skeleton

**Files:**
- Create: `package.json`
- Create: `scripts/sg3-monitor/lib/logger.mjs`
- Create: `scripts/sg3-monitor/lib/config.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Check whether `/home/teruel/JARVIS/package.json` exists**

```bash
test -f /home/teruel/JARVIS/package.json && echo EXISTS || echo MISSING
```

If EXISTS, read it and add the new scripts/deps without removing anything. If MISSING, create the file shown below.

- [ ] **Step 2: Create or update `package.json`**

If creating fresh:

```json
{
  "name": "jarvis",
  "private": true,
  "type": "module",
  "scripts": {
    "sg3:bootstrap": "node scripts/sg3-monitor/bootstrap.mjs",
    "sg3:run": "bash scripts/sg3-monitor/run.sh",
    "sg3:collect-only": "node scripts/sg3-monitor/run-collectors.mjs",
    "sg3:dry-run": "DRY_RUN=1 bash scripts/sg3-monitor/run.sh",
    "sg3:status": "node scripts/sg3-monitor/status.mjs",
    "sg3:validate": "node scripts/sg3-monitor/sync-sheet.mjs --validate-only",
    "sg3:test": "node --test tests/sg3-monitor/unit tests/sg3-monitor/integration"
  },
  "dependencies": {
    "googleapis": "^144.0.0",
    "playwright": "^1.48.0"
  }
}
```

If file exists, merge the `scripts` and `dependencies` entries above into the existing object — do not change unrelated keys.

- [ ] **Step 3: Install deps**

```bash
cd /home/teruel/JARVIS && npm install
```

Expected: `googleapis` and `playwright` installed. `playwright` install will not auto-download browsers; run `npx playwright install chromium` only when needed (Phase F).

- [ ] **Step 4: Append to `.gitignore`**

```
# SG3 Compliance Monitor
data/sg3-monitor/
config/sg3-monitor/clients/*.json
!config/sg3-monitor/clients/gm.json.example
```

(The exception keeps an example file in git later if we add one.)

- [ ] **Step 5: Create `scripts/sg3-monitor/lib/logger.mjs`**

```js
const ts = () => new Date().toISOString();

export function makeLogger(component) {
  const prefix = (level) => `[${ts()}] [${level}] [${component}]`;
  return {
    info:  (msg, extra) => console.log(prefix('info'),  msg, extra ?? ''),
    warn:  (msg, extra) => console.warn(prefix('warn'), msg, extra ?? ''),
    error: (msg, extra) => console.error(prefix('error'), msg, extra ?? ''),
    debug: (msg, extra) => process.env.DEBUG && console.log(prefix('debug'), msg, extra ?? ''),
  };
}
```

- [ ] **Step 6: Create `scripts/sg3-monitor/lib/config.mjs`**

```js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.env.SG3_HOME ?? resolve(import.meta.dirname, '../../..');

export function loadConfig() {
  const path = resolve(ROOT, 'config/sg3-monitor/config.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function loadEmailRules() {
  const path = resolve(ROOT, 'config/sg3-monitor/email-rules.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function loadClientConfig(clientId) {
  const path = resolve(ROOT, `config/sg3-monitor/clients/${clientId}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function dataDir(date) {
  return resolve(ROOT, 'data/sg3-monitor', date);
}

export const ROOT_DIR = ROOT;
```

- [ ] **Step 7: Commit**

```bash
git -C /home/teruel/JARVIS add package.json package-lock.json .gitignore scripts/sg3-monitor/lib/logger.mjs scripts/sg3-monitor/lib/config.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): project skeleton and config loader"
```

---

## Phase B — Pure-JS libraries (TDD-friendly, no external services)

### Task 2: `lib/expiry-rules.mjs`

Pure logic for lead-time matching, `prazo_efetivo` (cartas), and `prazo_liberacao_efetivo` (alocações).

**Files:**
- Create: `scripts/sg3-monitor/lib/expiry-rules.mjs`
- Test: `tests/sg3-monitor/unit/expiry-rules.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/sg3-monitor/unit/expiry-rules.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTemporal, prazoEfetivoCarta, prazoLiberacaoEfetivo } from '../../../scripts/sg3-monitor/lib/expiry-rules.mjs';

const LEAD_TIMES = {
  aso: [15, 7, 1],
  carta_subcontratacao: [60, 30, 15],
  default: [30, 15, 7],
};

describe('evaluateTemporal', () => {
  it('returns null when no threshold matches', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-06-30', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.equal(r, null);
  });

  it('returns PRAZO when dias_restantes hits a lead time', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-05-12', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'PRAZO', diasRestantes: 7 });
  });

  it('returns VENCIDO when past', () => {
    const r = evaluateTemporal({ tipo: 'aso', dataVencimento: '2026-05-01', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'VENCIDO', diasRestantes: -4 });
  });

  it('falls back to default lead times when tipo not in config', () => {
    const r = evaluateTemporal({ tipo: 'desconhecido', dataVencimento: '2026-06-04', hoje: '2026-05-05', leadTimes: LEAD_TIMES });
    assert.deepEqual(r, { severity: 'PRAZO', diasRestantes: 30 });
  });
});

describe('prazoEfetivoCarta', () => {
  it('returns the smallest of all candidate dates', () => {
    const r = prazoEfetivoCarta({
      cartaVencimento: '2026-12-31',
      contratoFim: '2026-09-30',
      cndsLume: [{ dataVencimento: '2026-06-04' }, { dataVencimento: '2027-01-01' }],
    });
    assert.deepEqual(r, { data: '2026-06-04', motivo: 'CND' });
  });

  it('ignores undefined or null dates', () => {
    const r = prazoEfetivoCarta({
      cartaVencimento: '2026-08-15',
      contratoFim: null,
      cndsLume: [{ dataVencimento: undefined }],
    });
    assert.deepEqual(r, { data: '2026-08-15', motivo: 'carta' });
  });
});

describe('prazoLiberacaoEfetivo', () => {
  it('blocks when declaracao incompleta', () => {
    const r = prazoLiberacaoEfetivo({
      alocacao: { data_vencimento_propria: '2026-12-31' },
      cadastroSg3: { data_vencimento: '2026-12-31' },
      contrato: { data_fim: '2026-12-31' },
      docsColaborador: [{ tipo: 'aso', data_vencimento: '2026-08-01' }],
      docsEmpresaSubcontratada: [],
      cartaSubcontratacao: null,
      aprovacaoJuridico: null,
      declaracaoResponsabilidade: { assinaturas: 'pendente' },
    });
    assert.deepEqual(r, { bloqueada: true, motivo: 'declaracao_responsabilidade incompleta' });
  });

  it('returns the smallest dependency date with description', () => {
    const r = prazoLiberacaoEfetivo({
      alocacao: { data_vencimento_propria: '2026-12-31' },
      cadastroSg3: { data_vencimento: '2026-12-31' },
      contrato: { data_fim: '2026-12-31', id: '5000078790' },
      docsColaborador: [{ tipo: 'aso', data_vencimento: '2026-08-01', colaboradorNome: 'João' }],
      docsEmpresaSubcontratada: [{ tipo: 'cnd_federal', data_vencimento: '2026-06-04', empresaNome: 'Lume' }],
      cartaSubcontratacao: null,
      aprovacaoJuridico: null,
      declaracaoResponsabilidade: { assinaturas: 'completa' },
    });
    assert.equal(r.bloqueada, false);
    assert.equal(r.data, '2026-06-04');
    assert.match(r.bottleneck, /CND Federal Lume/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/expiry-rules.test.mjs
```

Expected: ERR_MODULE_NOT_FOUND for `expiry-rules.mjs`.

- [ ] **Step 3: Implement `lib/expiry-rules.mjs`**

```js
const DAY_MS = 86_400_000;

function diasEntre(hojeIso, vencIso) {
  const hoje = new Date(hojeIso + 'T00:00:00Z');
  const venc = new Date(vencIso + 'T00:00:00Z');
  return Math.round((venc - hoje) / DAY_MS);
}

export function evaluateTemporal({ tipo, dataVencimento, hoje, leadTimes }) {
  const dias = diasEntre(hoje, dataVencimento);
  if (dias < 0) return { severity: 'VENCIDO', diasRestantes: dias };
  const thresholds = leadTimes[tipo] ?? leadTimes.default ?? [30, 15, 7];
  if (thresholds.includes(dias)) return { severity: 'PRAZO', diasRestantes: dias };
  return null;
}

function pickMin(candidates) {
  // candidates: [{ data, motivo }]
  const valid = candidates.filter(c => c.data);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.data.localeCompare(b.data));
  return valid[0];
}

export function prazoEfetivoCarta({ cartaVencimento, contratoFim, cndsLume = [] }) {
  const candidates = [
    { data: cartaVencimento, motivo: 'carta' },
    { data: contratoFim, motivo: 'contrato' },
    ...cndsLume.map(c => ({ data: c.dataVencimento, motivo: 'CND' })),
  ];
  return pickMin(candidates);
}

export function prazoLiberacaoEfetivo({
  alocacao,
  cadastroSg3,
  contrato,
  docsColaborador = [],
  docsEmpresaSubcontratada = [],
  cartaSubcontratacao,
  aprovacaoJuridico,
  declaracaoResponsabilidade,
}) {
  if (declaracaoResponsabilidade && declaracaoResponsabilidade.assinaturas !== 'completa') {
    return { bloqueada: true, motivo: 'declaracao_responsabilidade incompleta' };
  }

  const candidates = [];
  if (alocacao?.data_vencimento_propria) candidates.push({ data: alocacao.data_vencimento_propria, motivo: 'alocação' });
  if (cadastroSg3?.data_vencimento)      candidates.push({ data: cadastroSg3.data_vencimento, motivo: 'cadastro SG3' });
  if (contrato?.data_fim)                candidates.push({ data: contrato.data_fim, motivo: `contrato ${contrato.id ?? ''}`.trim() });
  if (cartaSubcontratacao?.prazo_efetivo) candidates.push({ data: cartaSubcontratacao.prazo_efetivo, motivo: `carta ${cartaSubcontratacao.id ?? ''}`.trim() });
  if (aprovacaoJuridico?.prazo_definido) candidates.push({ data: aprovacaoJuridico.prazo_definido, motivo: 'aprovação jurídico GM' });

  for (const d of docsColaborador) {
    if (d.data_vencimento) {
      const nome = d.colaboradorNome ? ` ${d.colaboradorNome}` : '';
      candidates.push({ data: d.data_vencimento, motivo: `${d.tipo.toUpperCase()}${nome}` });
    }
  }
  for (const d of docsEmpresaSubcontratada) {
    if (d.data_vencimento) {
      const empresa = d.empresaNome ? ` ${d.empresaNome}` : '';
      const tipoFmt = d.tipo.startsWith('cnd_')
        ? 'CND ' + d.tipo.slice(4).replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
        : d.tipo.toUpperCase();
      candidates.push({ data: d.data_vencimento, motivo: `${tipoFmt}${empresa}` });
    }
  }

  const min = pickMin(candidates);
  if (!min) return { bloqueada: false, data: null, bottleneck: 'sem dependências com data' };
  return { bloqueada: false, data: min.data, bottleneck: `${min.motivo} vence ${min.data}` };
}
```

- [ ] **Step 4: Run tests until they pass**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/expiry-rules.test.mjs
```

Expected: all tests pass. If a test fails, fix the implementation — do not change the test unless the test itself is wrong.

- [ ] **Step 5: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/expiry-rules.mjs tests/sg3-monitor/unit/expiry-rules.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): expiry rules library"
```

---

### Task 3: `lib/contract-name-parser.mjs`

Filename classification: contrato GM, DANFE, `VENC -` prefix, templates.

**Files:**
- Create: `scripts/sg3-monitor/lib/contract-name-parser.mjs`
- Test: `tests/sg3-monitor/unit/contract-name-parser.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDriveFile } from '../../../scripts/sg3-monitor/lib/contract-name-parser.mjs';

describe('classifyDriveFile', () => {
  it('detects contrato GM by 5000XXXXXXX pattern', () => {
    const r = classifyDriveFile({ name: '5000078790.pdf', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078790');
    assert.equal(r.statusDrive, 'faturado');
  });

  it('handles "Contrato 5000XXXXXXX" prefix', () => {
    const r = classifyDriveFile({ name: 'Contrato 5000078790.pdf', parentName: 'Aguardando FATURAMENTO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078790');
    assert.equal(r.statusDrive, 'aguardando_faturamento');
  });

  it('handles trailing whitespace and capitalization in extension', () => {
    const r = classifyDriveFile({ name: '5000076749 .PDF', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000076749');
  });

  it('handles "(1)" suffix', () => {
    const r = classifyDriveFile({ name: '5000078138 (1).pdf', parentName: 'GM - CONTRATO FATURADO' });
    assert.equal(r.kind, 'contrato_gm');
    assert.equal(r.contratoId, '5000078138');
  });

  it('classifies DANFE as ignored', () => {
    const r = classifyDriveFile({ name: 'GENERAL MOTORS LTDA - DANFE 52.pdf', parentName: 'Aguardando FATURAMENTO' });
    assert.equal(r.kind, 'danfe');
  });

  it('classifies templates folder children as ignored', () => {
    const r = classifyDriveFile({ name: 'Carta de Subcontratação Prest Serviços.docx', parentName: 'GM - SG3' });
    assert.equal(r.kind, 'template');
  });

  it('parses VENC - DD/MM/AAAA - prefix', () => {
    const r = classifyDriveFile({ name: 'VENC - 03/12/2026 - DECLARAÇÃO DE RESPONSABILIDADE (3)_assinada.pdf', parentName: 'ROOT' });
    assert.equal(r.kind, 'doc_with_venc');
    assert.equal(r.dataVencimento, '2026-12-03');
    assert.match(r.descricao, /DECLARAÇÃO DE RESPONSABILIDADE/);
  });

  it('returns "unknown" for unrecognised files', () => {
    const r = classifyDriveFile({ name: 'random.xlsx', parentName: 'ROOT' });
    assert.equal(r.kind, 'unknown');
  });
});
```

- [ ] **Step 2: Run tests; confirm they fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/contract-name-parser.test.mjs
```

- [ ] **Step 3: Implement `lib/contract-name-parser.mjs`**

```js
const RE_CONTRATO_GM   = /^(?:Contrato\s+)?(5000\d{6,7})\b/i;
const RE_DANFE         = /^GENERAL MOTORS LTDA\s*-\s*DANFE/i;
const RE_VENC_PREFIX   = /^VENC\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(.+?)(_assinada)?\.(pdf|docx|xlsx|xlsm)$/i;

export function classifyDriveFile({ name, parentName }) {
  if (parentName === 'GM - SG3') return { kind: 'template' };
  if (RE_DANFE.test(name))       return { kind: 'danfe' };

  const m = name.match(RE_CONTRATO_GM);
  if (m) {
    return {
      kind: 'contrato_gm',
      contratoId: m[1],
      statusDrive: parentNameToStatus(parentName),
    };
  }

  const v = name.match(RE_VENC_PREFIX);
  if (v) {
    const [, dd, mm, yyyy, descricao] = v;
    return {
      kind: 'doc_with_venc',
      dataVencimento: `${yyyy}-${mm}-${dd}`,
      descricao: descricao.trim(),
    };
  }

  return { kind: 'unknown' };
}

function parentNameToStatus(parentName) {
  if (parentName === 'GM - CONTRATO FATURADO') return 'faturado';
  if (parentName === 'Aguardando FATURAMENTO') return 'aguardando_faturamento';
  return null;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/contract-name-parser.test.mjs
```

Expected: pass. If a regex misses a real-world case from the listed Drive contents (Step 1 fixtures), fix the regex and re-run.

- [ ] **Step 5: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/contract-name-parser.mjs tests/sg3-monitor/unit/contract-name-parser.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): drive filename classifier"
```

---

### Task 4: `lib/sheet-schema.mjs`

Define the 13 tabs: columns, types, FK rules, sync strategy. This is data-only (no I/O), pure-JS.

**Files:**
- Create: `scripts/sg3-monitor/lib/sheet-schema.mjs`
- Test: `tests/sg3-monitor/unit/sheet-schema.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, validateRow, validateForeignKeys } from '../../../scripts/sg3-monitor/lib/sheet-schema.mjs';

describe('TABS', () => {
  it('declares all 13 tabs', () => {
    const names = TABS.map(t => t.name);
    assert.deepEqual(names, [
      'empresas', 'colaboradores', 'pessoas_gm', 'plantas', 'contratos',
      'cadastros_sg3', 'cartas_subcontratacao', 'aprovacoes_email',
      'docs_empresa', 'docs_colaborador', 'declaracoes_responsabilidade',
      'alocacoes', 'contratos_drive',
    ]);
  });

  it('every tab has an "id" column', () => {
    for (const tab of TABS) {
      assert.ok(tab.columns.some(c => c.name === 'id'), `tab ${tab.name} missing id column`);
    }
  });

  it('every tab declares a syncStrategy', () => {
    for (const tab of TABS) {
      assert.ok(tab.syncStrategy, `tab ${tab.name} missing syncStrategy`);
    }
  });
});

describe('validateRow', () => {
  it('rejects bad date', () => {
    const tab = TABS.find(t => t.name === 'docs_colaborador');
    const errors = validateRow(tab, { id: 'x', tipo: 'aso', data_vencimento: '12/05/2026' });
    assert.ok(errors.some(e => /data_vencimento/.test(e)));
  });

  it('rejects unknown enum value', () => {
    const tab = TABS.find(t => t.name === 'docs_empresa');
    const errors = validateRow(tab, { id: 'x', tipo: 'cnd_municipal', data_vencimento: '2026-12-31' });
    assert.ok(errors.some(e => /tipo/.test(e)));
  });

  it('accepts valid row', () => {
    const tab = TABS.find(t => t.name === 'docs_empresa');
    const errors = validateRow(tab, { id: 'lume-pgr-2026', tipo: 'pgr', empresa_id: 'lume', data_vencimento: '2026-12-31' });
    assert.deepEqual(errors, []);
  });
});

describe('validateForeignKeys', () => {
  it('reports broken FK', () => {
    const tabs = TABS;
    const data = {
      empresas: [{ id: 'lume' }],
      colaboradores: [{ id: 'pedro', empresa_id: 'unknown-empresa' }],
    };
    const errors = validateForeignKeys(tabs, data);
    assert.ok(errors.some(e => /empresa_id/.test(e) && /unknown-empresa/.test(e)));
  });
});
```

- [ ] **Step 2: Run tests; confirm fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/sheet-schema.test.mjs
```

- [ ] **Step 3: Implement `lib/sheet-schema.mjs`**

This is the longest pure-JS file. Each tab declares: name, columns (with name, type, enumValues, fk, calculated, manual), and syncStrategy (one of `upsert_dynamic`, `upsert_drive`, `upsert_contratos`, `insert_only`, `read_only`).

```js
// Column types: 'string' | 'date' | 'datetime' | 'enum' | 'csv' | 'bool' | 'integer' | 'url'

const COMMON_META = [
  { name: '_origem', type: 'enum', enumValues: ['sg3','email','drive','manual'] },
  { name: '_atualizado_em', type: 'datetime' },
];

const REVISADO = { name: '_revisado_humano', type: 'bool' };

export const TABS = [
  {
    name: 'empresas',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'razao_social', type: 'string' },
      { name: 'cnpj', type: 'string' },
      { name: 'tipo', type: 'enum', enumValues: ['principal','subcontratada','mei'] },
      { name: 'responsavel_email', type: 'string' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'colaboradores',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'nome_completo', type: 'string' },
      { name: 'cpf', type: 'string' },
      { name: 'empresa_id', type: 'string', fk: 'empresas' },
      { name: 'email', type: 'string' },
      { name: 'telefone', type: 'string' },
      { name: 'ativo', type: 'bool' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'pessoas_gm',
    syncStrategy: 'insert_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'nome', type: 'string' },
      { name: 'email', type: 'string', dedupeKey: true },
      { name: 'telefone', type: 'string' },
      { name: 'tem_user_sg3', type: 'bool' },
      { name: 'papeis', type: 'csv', enumValues: ['responsavel_contrato','responsavel_planta','comprador','juridico'] },
      { name: 'plantas', type: 'csv' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'plantas',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'cliente', type: 'string' },
      { name: 'nome', type: 'string' },
      { name: 'endereco', type: 'string' },
      { name: 'patrimonial_nome', type: 'string' },
      { name: 'patrimonial_email', type: 'string' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'contratos',
    syncStrategy: 'upsert_contratos',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'cliente', type: 'string' },
      { name: 'objeto', type: 'string' },
      { name: 'data_inicio', type: 'date' },
      { name: 'data_fim', type: 'date' },
      { name: 'responsavel_contrato_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'extracao_status', type: 'enum', enumValues: ['auto','manual','falhou'] },
      { name: 'extracao_warnings', type: 'string' },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'cadastros_sg3',
    syncStrategy: 'upsert_dynamic',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'contrato_id', type: 'string', fk: 'contratos' },
      { name: 'planta_id', type: 'string', fk: 'plantas' },
      { name: 'responsavel_planta_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'status_aprovacao', type: 'enum', enumValues: ['pendente','aprovado','vencido'] },
      { name: 'data_aprovacao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'sg3_url', type: 'url' },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'cartas_subcontratacao',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'subcontratada_id', type: 'string', fk: 'empresas' },
      { name: 'contrato_id', type: 'string', fk: 'contratos' },
      { name: 'plantas_cobertas', type: 'csv' },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento_propria', type: 'date' },
      { name: 'assinaturas', type: 'enum', enumValues: ['pendente','strokmatic','strokmatic+sub','completa'] },
      { name: 'aprovacao_comprador_id', type: 'string', fk: 'aprovacoes_email' },
      { name: 'aprovacao_juridico_id', type: 'string', fk: 'aprovacoes_email' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'prazo_efetivo', type: 'date', calculated: true },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'aprovacoes_email',
    syncStrategy: 'insert_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'tipo', type: 'enum', enumValues: ['comprador_gm','juridico_gm','patrimonial','outro_sg3'] },
      { name: 'carta_id', type: 'string', fk: 'cartas_subcontratacao' },
      { name: 'aprovador_id', type: 'string', fk: 'pessoas_gm' },
      { name: 'data_email', type: 'date' },
      { name: 'remetente', type: 'string' },
      { name: 'assunto', type: 'string' },
      { name: 'corpo_resumido', type: 'string' },
      { name: 'prazo_definido', type: 'date' },
      { name: 'gmail_message_id', type: 'string', dedupeKey: true },
      { name: 'gmail_link', type: 'url' },
      { name: 'status', type: 'enum', enumValues: ['aprovado','pendente','rejeitado'] },
      REVISADO,
      ...COMMON_META,
    ],
  },
  {
    name: 'docs_empresa',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'empresa_id', type: 'string', fk: 'empresas' },
      { name: 'tipo', type: 'enum', enumValues: ['pgr','pcmso','cnd_federal','cnd_trabalhista','cnd_fgts','outro'] },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'docs_colaborador',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'tipo', type: 'enum', enumValues: ['aso','nr10','nr35','nr12','outro'] },
      { name: 'data_emissao', type: 'date' },
      { name: 'data_vencimento', type: 'date' },
      { name: 'arquivo_url', type: 'url' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'declaracoes_responsabilidade',
    syncStrategy: 'read_only',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'planta_id', type: 'string', fk: 'plantas' },
      { name: 'data_emissao', type: 'date' },
      { name: 'assinaturas', type: 'enum', enumValues: ['pendente','strokmatic','strokmatic+sub','completa'] },
      { name: 'arquivo_url', type: 'url' },
      { name: 'versao', type: 'integer' },
      { name: 'notas', type: 'string' },
      ...COMMON_META,
    ],
  },
  {
    name: 'alocacoes',
    syncStrategy: 'upsert_dynamic',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'colaborador_id', type: 'string', fk: 'colaboradores' },
      { name: 'cadastro_sg3_id', type: 'string', fk: 'cadastros_sg3' },
      { name: 'data_inicio', type: 'date' },
      { name: 'data_vencimento_propria', type: 'date' },
      { name: 'status_sg3', type: 'enum', enumValues: ['pendente_aprovacao','aprovada','docs_pendentes','liberada','vencida','bloqueada'] },
      { name: 'pendencias_sg3', type: 'csv' },
      { name: 'data_email_patrimonial', type: 'date', manual: true },
      { name: 'decl_resp_id', type: 'string', fk: 'declaracoes_responsabilidade' },
      { name: 'decl_resp_uploaded_sg3', type: 'bool', manual: true },
      { name: 'decl_resp_data_upload_sg3', type: 'date', manual: true },
      { name: 'prazo_liberacao_efetivo', type: 'date', calculated: true },
      { name: 'bottleneck_doc', type: 'string', calculated: true },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
  {
    name: 'contratos_drive',
    syncStrategy: 'upsert_drive',
    columns: [
      { name: 'id', type: 'string', primary: true },
      { name: 'file_name', type: 'string' },
      { name: 'file_url', type: 'url' },
      { name: 'file_mime_type', type: 'string' },
      { name: 'data_criacao', type: 'datetime' },
      { name: 'data_modificacao', type: 'datetime' },
      { name: 'contrato_id', type: 'string', fk: 'contratos', manual: true },
      { name: 'status_drive', type: 'enum', enumValues: ['aguardando_faturamento','faturado'] },
      { name: 'em_sg3', type: 'bool', calculated: true },
      { name: 'notas', type: 'string', manual: true },
      ...COMMON_META,
    ],
  },
];

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRow(tab, row) {
  const errors = [];
  for (const col of tab.columns) {
    const v = row[col.name];
    if (v === undefined || v === null || v === '') continue;
    switch (col.type) {
      case 'date':
        if (!RE_DATE.test(v)) errors.push(`${tab.name}.${col.name}: invalid date "${v}" (expected YYYY-MM-DD)`);
        break;
      case 'enum':
        if (!col.enumValues.includes(v)) errors.push(`${tab.name}.${col.name}: invalid enum "${v}" (expected one of ${col.enumValues.join('|')})`);
        break;
      case 'bool':
        if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') errors.push(`${tab.name}.${col.name}: invalid bool "${v}"`);
        break;
      case 'integer':
        if (!Number.isInteger(Number(v))) errors.push(`${tab.name}.${col.name}: invalid integer "${v}"`);
        break;
      case 'csv':
        if (col.enumValues) {
          const items = String(v).split(',').map(s => s.trim()).filter(Boolean);
          for (const item of items) {
            if (!col.enumValues.includes(item)) errors.push(`${tab.name}.${col.name}: invalid csv item "${item}"`);
          }
        }
        break;
    }
  }
  return errors;
}

export function validateForeignKeys(tabs, data) {
  const errors = [];
  const idIndex = Object.fromEntries(
    Object.entries(data).map(([tab, rows]) => [tab, new Set(rows.map(r => r.id))])
  );
  for (const tab of tabs) {
    const rows = data[tab.name] ?? [];
    for (const col of tab.columns) {
      if (!col.fk) continue;
      const targetIds = idIndex[col.fk] ?? new Set();
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][col.name];
        if (!v) continue;
        if (!targetIds.has(v)) {
          errors.push(`${tab.name}[${i}].${col.name}: FK "${v}" not found in ${col.fk}`);
        }
      }
    }
  }
  return errors;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/sheet-schema.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/sheet-schema.mjs tests/sg3-monitor/unit/sheet-schema.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): sheet schema definitions and validators"
```

---

### Task 5: `lib/email-classifier.mjs`

Pattern matching driven by `email-rules.json` config.

**Files:**
- Create: `scripts/sg3-monitor/lib/email-classifier.mjs`
- Test: `tests/sg3-monitor/unit/email-classifier.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail } from '../../../scripts/sg3-monitor/lib/email-classifier.mjs';

const RULES = {
  master_label: 'sg3',
  classifiers: [
    { type: 'aprovacao_juridico_gm',
      match: { from_pattern: 'marilza', subject_pattern: '(subcontratação|carta)' },
      extracao: { confirmacao_humana: true } },
    { type: 'aprovacao_comprador_gm',
      match: { from_domain: 'gm.com', subject_pattern: '(aprovação|aprovado).*(subcontratação|carta)' } },
    { type: 'email_patrimonial',
      match: { to_pattern: 'patrimonial', from_pattern: 'me' } },
    { type: 'outro_sg3', fallback: true },
  ],
};

describe('classifyEmail', () => {
  it('matches juridico by from + subject', () => {
    const r = classifyEmail({ from: 'marilza@gm.com', to: 'pedro@strokmatic.com', subject: 'Aprovação carta de subcontratação' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'aprovacao_juridico_gm');
  });

  it('falls back to outro_sg3', () => {
    const r = classifyEmail({ from: 'random@example.com', to: 'pedro@strokmatic.com', subject: 'something' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'outro_sg3');
  });

  it('matches email_patrimonial by to + from=me', () => {
    const r = classifyEmail({ from: 'pedro@strokmatic.com', to: 'patrimonial.gravatai@gm.com', subject: 'Liberação de João Silva' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'email_patrimonial');
  });

  it('matches comprador by from_domain + subject', () => {
    const r = classifyEmail({ from: 'comprador@gm.com', to: 'pedro@strokmatic.com', subject: 'Aprovado: carta de subcontratação' }, RULES, { selfFromAddresses: ['pedro@strokmatic.com'] });
    assert.equal(r.type, 'aprovacao_comprador_gm');
  });
});
```

- [ ] **Step 2: Run tests; confirm fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/email-classifier.test.mjs
```

- [ ] **Step 3: Implement `lib/email-classifier.mjs`**

```js
function matches(matcher, email, ctx) {
  const { from, to, subject } = email;
  if (matcher.from_pattern === 'me') {
    if (!ctx.selfFromAddresses?.some(addr => from.toLowerCase().includes(addr.toLowerCase()))) return false;
  } else if (matcher.from_pattern) {
    if (!new RegExp(matcher.from_pattern, 'i').test(from)) return false;
  }
  if (matcher.from_domain && !from.toLowerCase().endsWith('@' + matcher.from_domain.toLowerCase())) return false;
  if (matcher.to_pattern && !new RegExp(matcher.to_pattern, 'i').test(to)) return false;
  if (matcher.subject_pattern && !new RegExp(matcher.subject_pattern, 'i').test(subject)) return false;
  return true;
}

export function classifyEmail(email, rules, ctx = {}) {
  for (const c of rules.classifiers) {
    if (c.fallback) continue;
    if (c.match && matches(c.match, email, ctx)) {
      return { type: c.type, classifier: c };
    }
  }
  const fallback = rules.classifiers.find(c => c.fallback);
  return { type: fallback?.type ?? 'outro_sg3', classifier: fallback };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/email-classifier.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/email-classifier.mjs tests/sg3-monitor/unit/email-classifier.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): email classifier"
```

---

### Task 6: `lib/alertas-log.mjs`

Persistent dedupe registry: prevents the same alert (linha + dias_restantes + dia) from firing twice.

**Files:**
- Create: `scripts/sg3-monitor/lib/alertas-log.mjs`
- Test: `tests/sg3-monitor/unit/alertas-log.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertasLog } from '../../../scripts/sg3-monitor/lib/alertas-log.mjs';

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sg3-')); });

describe('AlertasLog', () => {
  it('records and detects duplicates', () => {
    const log = new AlertasLog(join(tmp, 'log.json'));
    const key = log.keyFor({ linhaId: 'aso-pedro-2026', diasRestantes: 7, dia: '2026-05-05' });
    assert.equal(log.has(key), false);
    log.record(key, { messageId: 'm1' });
    assert.equal(log.has(key), true);
  });

  it('persists across instances', () => {
    const path = join(tmp, 'log.json');
    const a = new AlertasLog(path);
    a.record(a.keyFor({ linhaId: 'x', diasRestantes: 0, dia: '2026-05-05' }), {});
    a.save();
    const b = new AlertasLog(path);
    assert.equal(b.has(b.keyFor({ linhaId: 'x', diasRestantes: 0, dia: '2026-05-05' })), true);
  });
});
```

- [ ] **Step 2: Run tests; confirm fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/alertas-log.test.mjs
```

- [ ] **Step 3: Implement `lib/alertas-log.mjs`**

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class AlertasLog {
  constructor(path) {
    this.path = path;
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  }

  keyFor({ linhaId, diasRestantes, dia }) {
    return `${linhaId}:${diasRestantes}:${dia}`;
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  record(key, payload) {
    this.data[key] = { sent_at: new Date().toISOString(), ...payload };
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/alertas-log.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/alertas-log.mjs tests/sg3-monitor/unit/alertas-log.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): persistent alert dedupe log"
```

---

## Phase C — Configuration files

### Task 7: Author config files

**Files:**
- Create: `config/sg3-monitor/config.json`
- Create: `config/sg3-monitor/email-rules.json`
- Create: `config/sg3-monitor/clients/gm.json.example`

- [ ] **Step 1: Create `config/sg3-monitor/config.json`**

```bash
mkdir -p /home/teruel/JARVIS/config/sg3-monitor/clients
```

Then write the file:

```json
{
  "sheet_id": "",
  "sheet_name": "GM Compliance Monitor — Fase 1",
  "drive_root_folder_id": "1Em95Bq3gOkXrsM_c-r9dPWoV4nthcK-5",
  "google_chat_space": "spaces/AAQAoCUA9zA",
  "telegram_bot_secret_path": "~/.secrets/jarvis-stk-alerts-bot.json",
  "service_account_path": "config/credentials/gcp-service-account.json",
  "impersonate_subject": "pedro@lumesolutions.com",
  "lead_times": {
    "aso": [15, 7, 1],
    "nr10": [15, 7, 1],
    "nr35": [15, 7, 1],
    "nr12": [15, 7, 1],
    "cnd_federal": [15, 7, 1],
    "cnd_trabalhista": [15, 7, 1],
    "cnd_fgts": [15, 7, 1],
    "pgr": [60, 30, 15],
    "pcmso": [60, 30, 15],
    "carta_subcontratacao": [60, 30, 15],
    "aprovacao_juridico": [60, 30, 15],
    "cadastro_sg3": [30, 15, 7],
    "alocacao": [30, 15, 7],
    "default": [30, 15, 7]
  },
  "escalation": {
    "severity": "VENCIDO",
    "age_hours": 72,
    "blocks_alocacao_ativa": true
  },
  "cron": "0 7 * * *",
  "self_from_addresses": ["pedro@strokmatic.com", "pedro@lumesolutions.com"]
}
```

- [ ] **Step 2: Create `config/sg3-monitor/email-rules.json`**

```json
{
  "master_label": "sg3",
  "lookback_days": 365,
  "classifiers": [
    {
      "type": "aprovacao_juridico_gm",
      "match": { "from_pattern": "marilza", "subject_pattern": "(subcontratação|carta)" },
      "extracao": { "fields": ["carta_id", "prazo_definido", "status"], "use_llm_for": ["prazo_definido"] },
      "confirmacao_humana": true
    },
    {
      "type": "aprovacao_comprador_gm",
      "match": { "from_domain": "gm.com", "subject_pattern": "(aprovação|aprovado).*(subcontratação|carta)" },
      "extracao": { "fields": ["carta_id", "status"] }
    },
    {
      "type": "email_patrimonial",
      "match": { "to_pattern": "patrimonial", "from_pattern": "me" },
      "extracao": { "fields": ["alocacao_inferida"], "use_llm_for": ["alocacao_inferida"] }
    },
    {
      "type": "outro_sg3",
      "fallback": true,
      "extracao": { "fields": ["tipo_inferido"], "use_llm_for": ["tipo_inferido"] }
    }
  ]
}
```

- [ ] **Step 3: Create `config/sg3-monitor/clients/gm.json.example`**

```json
{
  "name": "GM",
  "use_api": false,
  "api": {
    "base_url": "",
    "auth": "session_cookie",
    "endpoints": {}
  },
  "playwright": {
    "login_url": "https://<sg3-gm-instance>/login",
    "credentials_secret_path": "~/.secrets/sg3-credentials.json",
    "credentials_keys": ["gm-lume", "gm-strokmatic"],
    "auth_session_dir": "data/sg3-monitor/auth/",
    "scrape_targets": {
      "cadastros_contrato_url": "https://<sg3-gm-instance>/contratos",
      "alocacoes_status_url": "https://<sg3-gm-instance>/alocacoes",
      "alocacoes_pendencias_url": "https://<sg3-gm-instance>/pendencias"
    },
    "selectors": {
      "login_user": "input[name=username]",
      "login_pass": "input[name=password]",
      "login_submit": "button[type=submit]"
    }
  }
}
```

**Multi-login note:** the GM SG3 portal has **separate user accounts per empresa**. Strokmatic e Lume têm logins distintos, e cada login só vê seus próprios colaboradores/alocações. Por isso `credentials_keys` é uma lista — `collect-sg3.mjs` vai iterar todos, abrindo uma sessão Playwright por credencial, e o sync mescla por `id` (união). Cada credencial em `~/.secrets/sg3-credentials.json` carrega `empresa_id` para anotar qual empresa cada colaborador pertence.

The real `gm.json` will be populated by the bootstrap spike (Task 26). The example is committed; the real file is gitignored.

- [ ] **Step 4: Commit**

```bash
git -C /home/teruel/JARVIS add config/sg3-monitor/config.json config/sg3-monitor/email-rules.json config/sg3-monitor/clients/gm.json.example && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): config files"
```

---

## Phase D — Google API clients (shared infrastructure)

### Task 8: `lib/google-clients.mjs`

Builds authenticated Sheets/Drive/Gmail/Chat clients using `createGoogleAuth` from the shared helper.

**Files:**
- Create: `scripts/sg3-monitor/lib/google-clients.mjs`

- [ ] **Step 1: Implement (no test — thin wrapper that just builds clients)**

```js
import { resolve } from 'node:path';
import { google } from 'googleapis';
import { createGoogleAuth } from '../../../mcp-servers/lib/google-auth.mjs';
import { ROOT_DIR } from './config.mjs';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces',
];

export function buildClients(config) {
  const auth = createGoogleAuth({
    credentialsPath: resolve(ROOT_DIR, config.service_account_path),
    scopes: SCOPES,
    subject: config.impersonate_subject,
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive:  google.drive({ version: 'v3', auth }),
    gmail:  google.gmail({ version: 'v1', auth }),
    chat:   google.chat({ version: 'v1', auth }),
  };
}
```

- [ ] **Step 2: Smoke test interactively**

```bash
cd /home/teruel/JARVIS && node --input-type=module -e "
  import('./scripts/sg3-monitor/lib/config.mjs').then(({ loadConfig }) => {
    return import('./scripts/sg3-monitor/lib/google-clients.mjs').then(({ buildClients }) => {
      const cfg = loadConfig();
      const clients = buildClients(cfg);
      console.log('clients ready:', Object.keys(clients));
      return clients.drive.files.list({ pageSize: 1, fields: 'files(id,name)' });
    });
  }).then(r => console.log('drive list ok, files:', r.data.files?.length));
"
```

Expected: `clients ready: [ 'sheets', 'drive', 'gmail', 'chat' ]` and `drive list ok, files: 1`. If auth fails, fix credentials/scopes before proceeding.

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/google-clients.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): google api client builder"
```

---

### Task 9: `lib/sheet-client.mjs`

High-level Sheet operations: read tab, upsert rows, append-only inserts, FK validation pass.

**Files:**
- Create: `scripts/sg3-monitor/lib/sheet-client.mjs`
- Test: `tests/sg3-monitor/integration/sheet-client.test.mjs`

This is the integration boundary; tests for it run only when `SG3_TEST_SHEET_ID` env var is set, so unit-test runs stay fast.

- [ ] **Step 1: Implement `lib/sheet-client.mjs`**

```js
import { TABS } from './sheet-schema.mjs';
import { makeLogger } from './logger.mjs';

const log = makeLogger('sheet-client');

export class SheetClient {
  constructor(sheets, sheetId) {
    this.sheets = sheets;
    this.sheetId = sheetId;
  }

  async readTab(name) {
    const tab = TABS.find(t => t.name === name);
    if (!tab) throw new Error(`unknown tab: ${name}`);
    const range = `${name}!A1:ZZ`;
    const r = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.sheetId, range });
    const [header, ...rows] = r.data.values ?? [[]];
    if (!header) return [];
    return rows.map(row => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
  }

  async readAll() {
    const out = {};
    for (const tab of TABS) out[tab.name] = await this.readTab(tab.name);
    return out;
  }

  async writeRows(name, rows, columns) {
    if (rows.length === 0) return;
    const values = rows.map(r => columns.map(c => r[c] ?? ''));
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: `${name}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async overwriteRow(name, rowIndex0Based, columns, row) {
    const values = [columns.map(c => row[c] ?? '')];
    const rangeRow = rowIndex0Based + 2; // +1 for header, +1 for 1-based
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: `${name}!A${rangeRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  async getColumns(name) {
    const r = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${name}!A1:ZZ1`,
    });
    return r.data.values?.[0] ?? [];
  }
}
```

- [ ] **Step 2: Add an integration test (manual gating)**

Create `tests/sg3-monitor/integration/sheet-client.test.mjs`:

```js
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../../scripts/sg3-monitor/lib/config.mjs';
import { buildClients } from '../../../scripts/sg3-monitor/lib/google-clients.mjs';
import { SheetClient } from '../../../scripts/sg3-monitor/lib/sheet-client.mjs';

const TEST_SHEET_ID = process.env.SG3_TEST_SHEET_ID;

describe('SheetClient', { skip: !TEST_SHEET_ID }, () => {
  let client;
  before(() => {
    const cfg = loadConfig();
    const { sheets } = buildClients(cfg);
    client = new SheetClient(sheets, TEST_SHEET_ID);
  });

  it('reads a tab', async () => {
    const rows = await client.readTab('empresas');
    assert.ok(Array.isArray(rows));
  });
});
```

- [ ] **Step 3: Skip the integration test for now (no test sheet yet). Commit:**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/sheet-client.mjs tests/sg3-monitor/integration/sheet-client.test.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): sheet client wrapper"
```

The integration test runs only when `SG3_TEST_SHEET_ID` is set (after Task 11 creates the test Sheet).

---

## Phase E — Drive collector

### Task 10: `lib/contract-pdf-parser.mjs`

Extracts (responsável, vigência, objeto) from PDF text. `pdftotext` first, regex/heuristic patterns, `claude --print` fallback.

**Files:**
- Create: `scripts/sg3-monitor/lib/contract-pdf-parser.mjs`
- Test: `tests/sg3-monitor/unit/contract-pdf-parser.test.mjs`
- Test fixtures: `tests/sg3-monitor/fixtures/pdfs/sample-contrato.txt`

- [ ] **Step 1: Create a fixture text file**

```bash
mkdir -p /home/teruel/JARVIS/tests/sg3-monitor/fixtures/pdfs
```

Create `tests/sg3-monitor/fixtures/pdfs/sample-contrato.txt` with synthesized text representing what `pdftotext` would output for a typical GM contract:

```
GENERAL MOTORS DO BRASIL LTDA

Contrato de Prestação de Serviços nº 5000078790

Objeto: Implantação de sistema de inspeção visual nas linhas de prensa
da planta de Gravataí.

Vigência:
Início: 01/06/2025
Término: 31/05/2027

Responsável Técnico GM: Carlos Souza
E-mail: carlos.souza@gm.com

Contratada: STROKMATIC ENGENHARIA LTDA
CNPJ: 12.345.678/0001-90
```

- [ ] **Step 2: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFieldsFromText } from '../../../scripts/sg3-monitor/lib/contract-pdf-parser.mjs';

const TEXT = readFileSync(resolve(import.meta.dirname, '../fixtures/pdfs/sample-contrato.txt'), 'utf-8');

describe('extractFieldsFromText', () => {
  it('extracts contrato_id', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.contratoId, '5000078790');
  });

  it('extracts vigência start and end', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.dataInicio, '2025-06-01');
    assert.equal(r.dataFim, '2027-05-31');
  });

  it('extracts responsável GM nome and email', () => {
    const r = extractFieldsFromText(TEXT);
    assert.equal(r.responsavelGmNome, 'Carlos Souza');
    assert.equal(r.responsavelGmEmail, 'carlos.souza@gm.com');
  });

  it('extracts objeto (first sentence after "Objeto:")', () => {
    const r = extractFieldsFromText(TEXT);
    assert.match(r.objeto, /Implantação de sistema de inspeção visual/);
  });

  it('returns warnings for missing fields', () => {
    const r = extractFieldsFromText('just a contract number 5000078790 and nothing else');
    assert.ok(r.warnings.length > 0);
  });
});
```

- [ ] **Step 3: Run tests; confirm fail**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/contract-pdf-parser.test.mjs
```

- [ ] **Step 4: Implement `lib/contract-pdf-parser.mjs`**

```js
import { execFileSync } from 'node:child_process';

const RE_CONTRATO_ID = /\b(5000\d{6,7})\b/;
const RE_VIGENCIA_INICIO = /(?:Início|Inicio|Data de Início)[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_VIGENCIA_FIM    = /(?:Término|Termino|Data de Término|Fim|Data de Fim)[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_RESPONSAVEL_NOME = /(?:Responsável(?: Técnico)?(?: GM)?|Gestor(?: GM)?)[:\s]+([A-Z][A-Za-zÀ-ÿ]+(?:\s+[A-Z][A-Za-zÀ-ÿ]+)+)/i;
const RE_RESPONSAVEL_EMAIL = /(?:E-?mail)[:\s]+([^\s<>()]+@[^\s<>()]+)/i;
const RE_OBJETO_BLOCK = /Objeto[:\s]+([\s\S]+?)(?=\n\s*\n|\bVigência\b|\bResponsável\b)/i;

function dmyToIso(dd, mm, yyyy) {
  return `${yyyy}-${mm}-${dd}`;
}

export function extractFieldsFromText(text) {
  const warnings = [];
  const out = { warnings, extracaoStatus: 'auto' };

  const id = text.match(RE_CONTRATO_ID); out.contratoId = id?.[1] ?? null;
  if (!out.contratoId) warnings.push('contrato_id não encontrado');

  const ini = text.match(RE_VIGENCIA_INICIO);
  out.dataInicio = ini ? dmyToIso(ini[1], ini[2], ini[3]) : null;
  if (!out.dataInicio) warnings.push('data_inicio não encontrada');

  const fim = text.match(RE_VIGENCIA_FIM);
  out.dataFim = fim ? dmyToIso(fim[1], fim[2], fim[3]) : null;
  if (!out.dataFim) warnings.push('data_fim não encontrada');

  const nome = text.match(RE_RESPONSAVEL_NOME);
  out.responsavelGmNome = nome?.[1] ?? null;
  if (!out.responsavelGmNome) warnings.push('responsavel_gm_nome não encontrado');

  const email = text.match(RE_RESPONSAVEL_EMAIL);
  out.responsavelGmEmail = email?.[1] ?? null;
  if (!out.responsavelGmEmail) warnings.push('responsavel_gm_email não encontrado');

  const obj = text.match(RE_OBJETO_BLOCK);
  out.objeto = obj?.[1].trim().replace(/\s+/g, ' ') ?? null;
  if (!out.objeto) warnings.push('objeto não encontrado');

  return out;
}

export function extractTextFromPdf(pdfPath) {
  try {
    const text = execFileSync('pdftotext', [pdfPath, '-layout', '-'], { encoding: 'utf-8' });
    return text;
  } catch (err) {
    return '';
  }
}

export async function parseContractPdf({ pdfPath, claudePrintFallback }) {
  const text = extractTextFromPdf(pdfPath);
  if (text.length >= 500) {
    const r = extractFieldsFromText(text);
    if (r.warnings.length === 0 || !claudePrintFallback) return r;

    // partial extraction: ask claude --print for missing fields
    const filled = await claudePrintFallback({ text, knownFields: r });
    return { ...r, ...filled, extracaoStatus: 'auto' };
  }

  if (claudePrintFallback) {
    const filled = await claudePrintFallback({ pdfPath });
    return { ...filled, extracaoStatus: 'auto' };
  }

  return { warnings: ['pdftotext returned no usable text'], extracaoStatus: 'manual' };
}
```

- [ ] **Step 5: Run tests**

```bash
cd /home/teruel/JARVIS && node --test tests/sg3-monitor/unit/contract-pdf-parser.test.mjs
```

If a regex doesn't match the fixture, adjust the regex (the fixture is a real-world synthesized example) — do not mutate the fixture.

- [ ] **Step 6: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/contract-pdf-parser.mjs tests/sg3-monitor/unit/contract-pdf-parser.test.mjs tests/sg3-monitor/fixtures/pdfs/sample-contrato.txt && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): contract pdf parser with regex extraction"
```

---

### Task 11: `collect-drive-contratos.mjs`

Lists the GM root folder recursively, classifies each file, parses PDFs of contratos, writes `drive-snapshot.json`.

**Files:**
- Create: `scripts/sg3-monitor/collect-drive-contratos.mjs`

- [ ] **Step 1: Implement the collector**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadConfig, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { classifyDriveFile } from './lib/contract-name-parser.mjs';
import { parseContractPdf } from './lib/contract-pdf-parser.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-drive');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function listRecursive(drive, folderId, parentName, acc = []) {
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime, modifiedTime, parents)',
      pageSize: 100,
      pageToken,
    });
    for (const f of r.data.files ?? []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        await listRecursive(drive, f.id, f.name, acc);
      } else {
        acc.push({ ...f, parentName });
      }
    }
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return acc;
}

async function downloadToTmp(drive, fileId) {
  const tmp = mkdtempSync(join(tmpdir(), 'sg3-drive-'));
  const dest = join(tmp, fileId + '.pdf');
  const fs = await import('node:fs');
  const ws = fs.createWriteStream(dest);
  const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await new Promise((res, rej) => {
    r.data.on('end', res).on('error', rej).pipe(ws);
  });
  return dest;
}

async function main() {
  const cfg = loadConfig();
  const { drive } = buildClients(cfg);
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  log.info('listing root folder', { folderId: cfg.drive_root_folder_id });
  const rootFolder = await drive.files.get({ fileId: cfg.drive_root_folder_id, fields: 'name' });
  const files = await listRecursive(drive, cfg.drive_root_folder_id, rootFolder.data.name);
  log.info(`listed ${files.length} files`);

  const contratosDrive = [];
  const docsComVenc = [];
  const ignorados = [];

  for (const f of files) {
    const cls = classifyDriveFile({ name: f.name, parentName: f.parentName });

    if (cls.kind === 'contrato_gm') {
      let extracao = { extracaoStatus: 'manual', warnings: ['parser não executado'] };
      try {
        const pdfPath = await downloadToTmp(drive, f.id);
        extracao = await parseContractPdf({ pdfPath });
      } catch (err) {
        log.warn(`PDF parse failed for ${f.name}`, { err: err.message });
        extracao = { extracaoStatus: 'falhou', warnings: [err.message] };
      }
      contratosDrive.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        file_mime_type: f.mimeType, data_criacao: f.createdTime, data_modificacao: f.modifiedTime,
        contrato_id_inferido: cls.contratoId, status_drive: cls.statusDrive,
        extracao,
      });
    } else if (cls.kind === 'doc_with_venc') {
      docsComVenc.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        data_vencimento_extraida: cls.dataVencimento, descricao: cls.descricao,
      });
    } else if (cls.kind === 'danfe' || cls.kind === 'template') {
      ignorados.push({ file_name: f.name, razao: cls.kind });
    } else {
      contratosDrive.push({
        file_id: f.id, file_name: f.name, file_url: f.webViewLink,
        file_mime_type: f.mimeType, data_criacao: f.createdTime, data_modificacao: f.modifiedTime,
        contrato_id_inferido: null, status_drive: null,
        extracao: { extracaoStatus: 'manual', warnings: ['filename pattern não reconhecido'] },
      });
    }
  }

  const snapshot = {
    collected_at: new Date().toISOString(),
    status: 'ok',
    contratos_drive: contratosDrive,
    docs_com_venc_filename: docsComVenc,
    ignorados,
  };

  const path = resolve(out, 'drive-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, contratos: contratosDrive.length, docsComVenc: docsComVenc.length, ignorados: ignorados.length });
}

main().catch(err => {
  log.error('collect-drive failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

- [ ] **Step 2: Smoke run against the real Drive folder**

```bash
cd /home/teruel/JARVIS && node scripts/sg3-monitor/collect-drive-contratos.mjs $(date +%F)
```

Expected output: `[info] [collect-drive] snapshot written ... contratos: N docsComVenc: 1 ignorados: 5` approximately. Inspect:

```bash
cat /home/teruel/JARVIS/data/sg3-monitor/$(date +%F)/drive-snapshot.json | jq '.contratos_drive | length, .docs_com_venc_filename, .ignorados'
```

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/collect-drive-contratos.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): drive contratos collector"
```

---

## Phase F — Email collector

### Task 12: `lib/email-extractor.mjs`

LLM extraction wrapper that calls `claude --print` with a focused prompt to extract specific fields from email bodies.

**Files:**
- Create: `scripts/sg3-monitor/lib/email-extractor.mjs`

- [ ] **Step 1: Implement (no automated test — uses external LLM)**

```js
import { spawnSync } from 'node:child_process';
import { makeLogger } from './logger.mjs';

const log = makeLogger('email-extractor');

const PROMPT_TEMPLATE = `You are extracting structured data from a Brazilian Portuguese business email.

Email metadata:
- From: {{from}}
- Subject: {{subject}}
- Date: {{date}}

Email body:
"""
{{body}}
"""

Extract the following fields as a single JSON object on one line, with these keys (set value to null if not present):
{{fields}}

Output ONLY the JSON object, no preamble, no markdown fences. Use ISO date format YYYY-MM-DD for any date fields.
`;

const FIELD_SPECS = {
  carta_id: '"carta_id": <string identifier of the subcontracting letter, e.g., "2024-XYZ" or null>',
  prazo_definido: '"prazo_definido": <date the email defines as the validity deadline (YYYY-MM-DD) or null>',
  status: '"status": <one of "aprovado", "pendente", "rejeitado" or null>',
  alocacao_inferida: '"alocacao_inferida": <text describing colaborador and planta mentioned (e.g., "João Silva em Gravataí") or null>',
  tipo_inferido: '"tipo_inferido": <best guess at the email type (e.g., "renovacao_aso", "carta_subcontratacao_pendente") or null>',
};

export function extractWithLlm({ from, subject, date, body, fields }) {
  const fieldLines = fields.map(f => '  ' + (FIELD_SPECS[f] ?? `"${f}": <value or null>`)).join(',\n');
  const prompt = PROMPT_TEMPLATE
    .replace('{{from}}', from)
    .replace('{{subject}}', subject)
    .replace('{{date}}', date)
    .replace('{{body}}', body.slice(0, 10000))
    .replace('{{fields}}', `{\n${fieldLines}\n}`);

  const r = spawnSync('claude', ['--print', '--allowedTools=', '--max-turns=1'], {
    input: prompt,
    encoding: 'utf-8',
    timeout: 60_000,
  });

  if (r.status !== 0) {
    log.warn('claude --print failed', { stderr: r.stderr });
    return Object.fromEntries(fields.map(f => [f, null]));
  }

  try {
    const trimmed = r.stdout.trim();
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON found');
    return JSON.parse(m[0]);
  } catch (err) {
    log.warn('failed to parse LLM JSON', { stdout: r.stdout, err: err.message });
    return Object.fromEntries(fields.map(f => [f, null]));
  }
}
```

- [ ] **Step 2: Smoke test interactively**

```bash
cd /home/teruel/JARVIS && node --input-type=module -e "
  import('./scripts/sg3-monitor/lib/email-extractor.mjs').then(({ extractWithLlm }) => {
    const r = extractWithLlm({
      from: 'marilza.santos@gm.com',
      subject: 'Aprovação Carta Subcontratação 2024-XYZ',
      date: '2026-04-30',
      body: 'Prezado, aprovo a carta de subcontratação 2024-XYZ. Validade até 04/06/2026.',
      fields: ['carta_id', 'prazo_definido', 'status'],
    });
    console.log(JSON.stringify(r, null, 2));
  });
"
```

Expected: a JSON object with `carta_id` close to "2024-XYZ", `prazo_definido` "2026-06-04", `status` "aprovado". Tolerate small variations — the assertion is structural, not exact.

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/email-extractor.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): claude --print email field extractor"
```

---

### Task 13: `collect-emails.mjs`

Reads Gmail with label `sg3`, applies classifier, runs LLM extraction, writes snapshot.

**Files:**
- Create: `scripts/sg3-monitor/collect-emails.mjs`

- [ ] **Step 1: Implement**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { loadConfig, loadEmailRules, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { classifyEmail } from './lib/email-classifier.mjs';
import { extractWithLlm } from './lib/email-extractor.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-emails');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      const nested = decodeBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function header(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseEmailDate(dateStr) {
  // RFC 2822 → ISO date
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const cfg = loadConfig();
  const rules = loadEmailRules();
  const { gmail } = buildClients(cfg);
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  const lookback = rules.lookback_days ?? 365;
  const query = `label:${rules.master_label} newer_than:${lookback}d`;
  log.info('searching gmail', { query });

  // List message ids
  const ids = [];
  let pageToken;
  do {
    const r = await gmail.users.messages.list({ userId: 'me', q: query, pageToken, maxResults: 500 });
    for (const m of r.data.messages ?? []) ids.push(m.id);
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  log.info(`found ${ids.length} messages`);

  const aprovacoes = [];
  for (const id of ids) {
    try {
      const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = m.data.payload?.headers ?? [];
      const email = {
        from: header(headers, 'From'),
        to: header(headers, 'To'),
        subject: header(headers, 'Subject'),
        date: parseEmailDate(header(headers, 'Date')),
        body: decodeBody(m.data.payload),
      };

      const cls = classifyEmail(email, rules, { selfFromAddresses: cfg.self_from_addresses });
      const extracaoCfg = cls.classifier?.extracao ?? {};
      let extracao = {};
      if (extracaoCfg.use_llm_for?.length > 0) {
        extracao = extractWithLlm({
          from: email.from, subject: email.subject, date: email.date, body: email.body,
          fields: extracaoCfg.use_llm_for,
        });
      }

      aprovacoes.push({
        gmail_message_id: id,
        gmail_link: `https://mail.google.com/mail/u/0/#all/${id}`,
        tipo: cls.type,
        data_email: email.date,
        remetente: email.from,
        assunto: email.subject,
        corpo_resumido: email.body.slice(0, 500),
        extracao,
        confirmacao_humana: !!extracaoCfg.confirmacao_humana,
      });
    } catch (err) {
      log.warn(`failed to process message ${id}`, { err: err.message });
    }
  }

  const snapshot = { collected_at: new Date().toISOString(), status: 'ok', aprovacoes_email: aprovacoes };
  const path = resolve(out, 'email-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, aprovacoes: aprovacoes.length });
}

main().catch(err => {
  log.error('collect-emails failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

- [ ] **Step 2: Smoke run (only after you've manually labelled at least one email with `sg3`)**

```bash
cd /home/teruel/JARVIS && node scripts/sg3-monitor/collect-emails.mjs $(date +%F)
cat /home/teruel/JARVIS/data/sg3-monitor/$(date +%F)/email-snapshot.json | jq '.aprovacoes_email | length, .aprovacoes_email[0]'
```

Expected: snapshot file exists; if you have labelled emails, they appear classified.

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/collect-emails.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): gmail collector with classifier and llm extraction"
```

---

## Phase G — SG3 collector

### Task 14: `lib/sg3-client.mjs` — Playwright-only first version

Initial implementation handles the Playwright path only. The API path is added later if discovered during the spike.

**Files:**
- Create: `scripts/sg3-monitor/lib/sg3-client.mjs`

- [ ] **Step 1: Install Playwright Chromium**

```bash
cd /home/teruel/JARVIS && npx playwright install chromium
```

- [ ] **Step 2: Implement**

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';
import { makeLogger } from './logger.mjs';

const log = makeLogger('sg3-client');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export async function withSg3Session(clientConfig, credentialsKey, work) {
  const cfg = clientConfig.playwright;
  const sessionPath = resolve(expandHome(cfg.auth_session_dir), `${credentialsKey}-storage-state.json`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.SG3_HEADLESS !== '0',
  });

  const context = await browser.newContext({
    storageState: existsSync(sessionPath) ? sessionPath : undefined,
  });

  try {
    const page = await context.newPage();

    const result = await tryOrLogin(page, cfg, credentialsKey, async () => work(page));

    await context.storageState({ path: sessionPath });
    return result;
  } finally {
    await browser.close();
  }
}

async function tryOrLogin(page, cfg, credentialsKey, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!/login|auth|unauth|redirect/i.test(err.message)) throw err;
    log.warn('first attempt failed; trying login flow', { err: err.message, credentialsKey });
    await login(page, cfg, credentialsKey);
    return await fn();
  }
}

async function login(page, cfg, credentialsKey) {
  const credsPath = expandHome(cfg.credentials_secret_path);
  if (!existsSync(credsPath)) {
    throw new Error(`credentials file not found at ${credsPath}; cannot auto-login`);
  }
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))[credentialsKey];
  if (!creds) throw new Error(`credentials missing key ${credentialsKey}`);

  await page.goto(cfg.login_url);
  await page.fill(cfg.selectors.login_user, creds.username);
  await page.fill(cfg.selectors.login_pass, creds.password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click(cfg.selectors.login_submit),
  ]);

  // detect MFA placeholder
  if (await page.locator('input[name=mfa]').count() > 0) {
    throw new Error('MFA required — re-run with SG3_HEADLESS=0 and complete the challenge manually');
  }
}

export async function scrapeCadastros(page, urlOrSelector) {
  // Placeholder: real selectors come from spike.
  // Returns { cadastros_sg3: [], colaboradores: [], plantas: [], pessoas_gm: [] }
  log.warn('scrapeCadastros: not yet configured — bootstrap spike must populate selectors');
  return { cadastros_sg3: [], colaboradores: [], plantas: [], pessoas_gm: [] };
}

export async function scrapeAlocacoes(page, urlOrSelector) {
  log.warn('scrapeAlocacoes: not yet configured');
  return { alocacoes: [] };
}
```

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/sg3-client.mjs package-lock.json && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): playwright session wrapper"
```

After the spike (Task 26) the selectors are filled in; the placeholder scrape functions get real implementations. We bake in the contract now and complete it later.

---

### Task 15: `collect-sg3.mjs`

**Files:**
- Create: `scripts/sg3-monitor/collect-sg3.mjs`

- [ ] **Step 1: Implement**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, loadClientConfig, dataDir } from './lib/config.mjs';
import { withSg3Session, scrapeCadastros, scrapeAlocacoes } from './lib/sg3-client.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('collect-sg3');
const argDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function main() {
  const cfg = loadConfig();
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });

  const clientCfg = loadClientConfig('gm');
  const keys = clientCfg.playwright.credentials_keys ?? [];
  const perLogin = [];
  let aggregateStatus = 'ok';

  for (const key of keys) {
    try {
      const partial = await withSg3Session(clientCfg, key, async (page) => {
        const cadastros = await scrapeCadastros(page, clientCfg.playwright.scrape_targets.cadastros_contrato_url);
        const alocacoes = await scrapeAlocacoes(page, clientCfg.playwright.scrape_targets.alocacoes_status_url);
        return { credentialsKey: key, status: 'ok', ...cadastros, ...alocacoes };
      });
      perLogin.push(partial);
    } catch (err) {
      log.error('sg3 scrape failed for credential', { key, err: err.message });
      aggregateStatus = /credentials|mfa|login/i.test(err.message) ? 'auth_expired' : 'failed';
      perLogin.push({ credentialsKey: key, status: aggregateStatus, error: err.message });
    }
  }

  // Merge per-login results by id (union)
  const merged = mergeByPrimary(perLogin, ['cadastros_sg3', 'colaboradores', 'plantas', 'pessoas_gm', 'alocacoes']);

  const snapshot = {
    collected_at: new Date().toISOString(),
    source: 'playwright',
    status: aggregateStatus === 'ok' ? 'ok' : aggregateStatus,
    per_login: perLogin.map(p => ({ credentialsKey: p.credentialsKey, status: p.status, error: p.error })),
    ...merged,
  };

  const path = resolve(out, 'sg3-snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log.info('snapshot written', { path, status: snapshot.status, logins: keys.length });
}

function mergeByPrimary(perLogin, kinds) {
  const out = Object.fromEntries(kinds.map(k => [k, []]));
  for (const p of perLogin) {
    if (p.status !== 'ok') continue;
    for (const kind of kinds) {
      const existing = new Map(out[kind].map(r => [r.id, r]));
      for (const row of (p[kind] ?? [])) {
        const prev = existing.get(row.id);
        if (!prev) { out[kind].push(row); existing.set(row.id, row); }
        else {
          // shallow merge — fill empty fields from new row
          for (const k of Object.keys(row)) if (prev[k] == null || prev[k] === '') prev[k] = row[k];
        }
      }
    }
  }
  return out;
}

main().catch(err => {
  log.error('collect-sg3 fatal', { err: err.message });
  process.exitCode = 1;
});
```

- [ ] **Step 2: Commit (the collector currently produces empty arrays; that's expected pre-spike)**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/collect-sg3.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): sg3 collector skeleton (selectors come from spike)"
```

---

## Phase H — Sync to Sheet

### Task 16: `sync-sheet.mjs`

Reads the 3 snapshots and applies per-tab strategy from `sheet-schema.mjs`.

**Files:**
- Create: `scripts/sg3-monitor/sync-sheet.mjs`
- Create: `scripts/sg3-monitor/lib/snapshot-loader.mjs`

- [ ] **Step 1: Implement `lib/snapshot-loader.mjs`**

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT_DIR } from './config.mjs';

const ROOT = resolve(ROOT_DIR, 'data/sg3-monitor');

function snapshotDir(date) { return resolve(ROOT, date); }

export function readSnapshot(date, kind) {
  const path = resolve(snapshotDir(date), `${kind}-snapshot.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function readSnapshotWithFallback(date, kind, maxBackDays = 7) {
  const today = readSnapshot(date, kind);
  if (today && today.status === 'ok') return { snapshot: today, dateUsed: date };

  const dirs = readdirSync(ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date).sort().reverse();
  for (const d of dirs.slice(0, maxBackDays)) {
    const s = readSnapshot(d, kind);
    if (s && s.status === 'ok') return { snapshot: s, dateUsed: d };
  }
  return { snapshot: today ?? null, dateUsed: today ? date : null };
}
```

- [ ] **Step 2: Implement `sync-sheet.mjs`**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, dataDir } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';
import { TABS, validateRow, validateForeignKeys } from './lib/sheet-schema.mjs';
import { readSnapshotWithFallback, readSnapshot } from './lib/snapshot-loader.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('sync-sheet');
const args = process.argv.slice(2);
const VALIDATE_ONLY = args.includes('--validate-only');
const argDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);

const NOW_ISO = new Date().toISOString();

function nowMeta(origin) { return { _origem: origin, _atualizado_em: NOW_ISO }; }

async function main() {
  const cfg = loadConfig();
  if (!cfg.sheet_id) throw new Error('config.sheet_id missing — run bootstrap first');
  const { sheets } = buildClients(cfg);
  const client = new SheetClient(sheets, cfg.sheet_id);

  // Load existing data first (validate FKs even in dry run)
  const existing = await client.readAll();
  log.info('loaded existing rows', Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v.length])));

  if (VALIDATE_ONLY) {
    const fkErrors = validateForeignKeys(TABS, existing);
    const rowErrors = TABS.flatMap(tab => existing[tab.name]?.flatMap((row, i) => validateRow(tab, row).map(e => `[row ${i + 2}] ${e}`)) ?? []);
    const report = { fk_errors: fkErrors, row_errors: rowErrors };
    console.log(JSON.stringify(report, null, 2));
    if (fkErrors.length + rowErrors.length > 0) process.exitCode = 1;
    return;
  }

  // Load snapshots
  const sg3 = readSnapshotWithFallback(argDate, 'sg3');
  const drive = readSnapshotWithFallback(argDate, 'drive');
  const email = readSnapshotWithFallback(argDate, 'email');

  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });
  const report = {
    started_at: NOW_ISO, sources: {
      sg3:   { status: sg3.snapshot?.status ?? 'missing',   date_used: sg3.dateUsed },
      drive: { status: drive.snapshot?.status ?? 'missing', date_used: drive.dateUsed },
      email: { status: email.snapshot?.status ?? 'missing', date_used: email.dateUsed },
    }, inserted: {}, updated: {}, fk_errors: [], row_errors: [],
  };

  // Apply per-tab merges
  await applySg3(client, existing, sg3.snapshot, report);
  await applyDrive(client, existing, drive.snapshot, report);
  await applyEmail(client, existing, email.snapshot, report);

  // Re-read for final FK validation
  const after = await client.readAll();
  report.fk_errors = validateForeignKeys(TABS, after);

  const path = resolve(out, 'sync-report.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  log.info('sync done', { path, fk_errors: report.fk_errors.length });
}

async function applySg3(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;

  await upsertByPrimary(client, 'cadastros_sg3', snap.cadastros_sg3 ?? [], existing, report,
    ['status_aprovacao', 'data_aprovacao', 'data_vencimento', 'sg3_url', 'responsavel_planta_id']);

  await upsertByPrimary(client, 'alocacoes', snap.alocacoes ?? [], existing, report,
    ['status_sg3', 'pendencias_sg3', 'data_inicio', 'data_vencimento_propria', 'decl_resp_id']);

  await insertOnlyByDedupe(client, 'pessoas_gm', snap.pessoas_gm ?? [], existing, 'email', report);
}

async function applyDrive(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;

  // contratos_drive (upsert by id = file_id)
  const driveRows = (snap.contratos_drive ?? []).map(c => ({
    id: c.file_id,
    file_name: c.file_name,
    file_url: c.file_url,
    file_mime_type: c.file_mime_type,
    data_criacao: c.data_criacao,
    data_modificacao: c.data_modificacao,
    contrato_id: '', // preserved by upsert if already set
    status_drive: c.status_drive ?? '',
    em_sg3: '', // calculated downstream
    notas: '',
    ...nowMeta('drive'),
  }));
  await upsertByPrimary(client, 'contratos_drive', driveRows, existing, report,
    ['file_name', 'file_url', 'file_mime_type', 'data_criacao', 'data_modificacao', 'status_drive']);

  // contratos (upsert by id = contrato_id; only fill empty fields)
  const contratos = (snap.contratos_drive ?? [])
    .filter(c => c.contrato_id_inferido)
    .map(c => ({
      id: c.contrato_id_inferido,
      cliente: 'GM',
      objeto: c.extracao?.objeto ?? '',
      data_inicio: c.extracao?.dataInicio ?? '',
      data_fim: c.extracao?.dataFim ?? '',
      responsavel_contrato_id: '', // resolved later when pessoas_gm is built
      extracao_status: c.extracao?.extracaoStatus ?? 'manual',
      extracao_warnings: (c.extracao?.warnings ?? []).join('; '),
      notas: '',
      ...nowMeta('drive'),
    }));
  await upsertContratos(client, contratos, existing, report);

  // also: when classify-as VENC, prepare suggestions (but don't auto-write to docs_empresa/docs_colaborador since we can't classify ownership)
  // We log them in the report instead so humans can act.
  report.docs_com_venc_filename = (snap.docs_com_venc_filename ?? []).length;
}

async function applyEmail(client, existing, snap, report) {
  if (!snap || snap.status !== 'ok') return;
  const seen = new Set((existing.aprovacoes_email ?? []).map(r => r.gmail_message_id));
  const newRows = (snap.aprovacoes_email ?? []).filter(r => !seen.has(r.gmail_message_id)).map(r => ({
    id: 'email-' + r.gmail_message_id,
    tipo: r.tipo,
    carta_id: '',
    aprovador_id: '',
    data_email: r.data_email ?? '',
    remetente: r.remetente ?? '',
    assunto: r.assunto ?? '',
    corpo_resumido: r.corpo_resumido ?? '',
    prazo_definido: r.extracao?.prazo_definido ?? '',
    gmail_message_id: r.gmail_message_id,
    gmail_link: r.gmail_link ?? '',
    status: r.extracao?.status ?? '',
    _revisado_humano: r.confirmacao_humana ? 'false' : 'true',
    ...nowMeta('email'),
  }));
  if (newRows.length === 0) return;
  const cols = TABS.find(t => t.name === 'aprovacoes_email').columns.map(c => c.name);
  await client.writeRows('aprovacoes_email', newRows, cols);
  report.inserted.aprovacoes_email = newRows.length;
}

async function upsertByPrimary(client, tabName, incoming, existing, report, dynamicCols) {
  const tab = TABS.find(t => t.name === tabName);
  const cols = tab.columns.map(c => c.name);
  const byId = new Map((existing[tabName] ?? []).map((r, i) => [r.id, { row: r, index: i }]));

  let inserted = 0, updated = 0;
  const newRows = [];

  for (const row of incoming) {
    const r = { ...row, ...nowMeta(row._origem ?? 'sg3') };
    if (!byId.has(r.id)) {
      newRows.push(r);
      inserted++;
    } else {
      const { row: existingRow, index } = byId.get(r.id);
      const merged = { ...existingRow };
      for (const col of dynamicCols) merged[col] = r[col] ?? existingRow[col] ?? '';
      merged._atualizado_em = NOW_ISO;
      merged._origem = r._origem ?? merged._origem;
      await client.overwriteRow(tabName, index, cols, merged);
      updated++;
    }
  }

  if (newRows.length > 0) await client.writeRows(tabName, newRows, cols);
  if (inserted) report.inserted[tabName] = (report.inserted[tabName] ?? 0) + inserted;
  if (updated)  report.updated[tabName]  = (report.updated[tabName]  ?? 0) + updated;
}

async function upsertContratos(client, incoming, existing, report) {
  const tab = TABS.find(t => t.name === 'contratos');
  const cols = tab.columns.map(c => c.name);
  const byId = new Map((existing.contratos ?? []).map((r, i) => [r.id, { row: r, index: i }]));

  let inserted = 0, updated = 0;
  const newRows = [];

  for (const row of incoming) {
    if (!byId.has(row.id)) { newRows.push(row); inserted++; continue; }
    const { row: existingRow, index } = byId.get(row.id);
    const merged = { ...existingRow };
    for (const col of cols) {
      if (col === 'notas' || col === 'responsavel_contrato_id' || col.startsWith('_')) continue;
      if (!merged[col]) merged[col] = row[col] ?? '';
    }
    merged._atualizado_em = NOW_ISO;
    await client.overwriteRow('contratos', index, cols, merged);
    updated++;
  }

  if (newRows.length > 0) await client.writeRows('contratos', newRows, cols);
  if (inserted) report.inserted.contratos = (report.inserted.contratos ?? 0) + inserted;
  if (updated)  report.updated.contratos  = (report.updated.contratos  ?? 0) + updated;
}

async function insertOnlyByDedupe(client, tabName, incoming, existing, dedupeKey, report) {
  const tab = TABS.find(t => t.name === tabName);
  const cols = tab.columns.map(c => c.name);
  const seen = new Set((existing[tabName] ?? []).map(r => r[dedupeKey]).filter(Boolean));
  const newRows = incoming.filter(r => r[dedupeKey] && !seen.has(r[dedupeKey])).map(r => ({ ...r, ...nowMeta(r._origem ?? 'sg3') }));
  if (newRows.length > 0) await client.writeRows(tabName, newRows, cols);
  if (newRows.length) report.inserted[tabName] = (report.inserted[tabName] ?? 0) + newRows.length;
}

main().catch(err => {
  log.error('sync-sheet failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

- [ ] **Step 3: Commit (don't run yet — needs Sheet from bootstrap)**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/sync-sheet.mjs scripts/sg3-monitor/lib/snapshot-loader.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): sync-sheet with per-tab merge strategies"
```

---

## Phase I — Notifier

### Task 17: `lib/notifier.mjs`

Posts to Google Chat space (primary) and Telegram (fallback + escalation) via `jarvis_stk_alerts_bot`.

**Files:**
- Create: `scripts/sg3-monitor/lib/notifier.mjs`

- [ ] **Step 1: Implement**

```js
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { makeLogger } from './logger.mjs';

const log = makeLogger('notifier');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export class Notifier {
  constructor({ chat, config }) {
    this.chat = chat;
    this.config = config;
  }

  async postPrimary(text) {
    try {
      const r = await this.chat.spaces.messages.create({
        parent: this.config.google_chat_space,
        requestBody: { text },
      });
      return { ok: true, messageId: r.data.name, channel: 'google_chat' };
    } catch (err) {
      log.warn('google chat post failed; falling back to telegram', { err: err.message });
      const fb = await this.postTelegram(text);
      return { ...fb, primary_failed: err.message };
    }
  }

  async postTelegram(text) {
    const path = expandHome(this.config.telegram_bot_secret_path);
    if (!existsSync(path)) {
      log.error('telegram secret not found', { path });
      return { ok: false, channel: 'telegram', error: 'secret missing' };
    }
    const { token, chat_id } = JSON.parse(readFileSync(path, 'utf-8'));
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r.ok) {
      const errBody = await r.text();
      log.error('telegram send failed', { status: r.status, body: errBody });
      return { ok: false, channel: 'telegram', error: `${r.status} ${errBody}` };
    }
    const data = await r.json();
    return { ok: true, channel: 'telegram', messageId: String(data.result.message_id) };
  }

  async postEscalation(text) {
    return this.postTelegram(`🔥 ESCALATION\n\n${text}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/notifier.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): notifier with chat primary and telegram fallback"
```

You will need a `~/.secrets/jarvis-stk-alerts-bot.json` with `{ "token": "...", "chat_id": "..." }` — the user provides this out-of-band before the first cron run.

---

## Phase J — Alert engine

### Task 18: `check-expiries.mjs` — temporal alerts

The full check engine is large; build it incrementally. Start with temporal alerts only, then add state, drift, and active liberations.

**Files:**
- Create: `scripts/sg3-monitor/check-expiries.mjs`
- Create: `scripts/sg3-monitor/lib/report-builder.mjs`

- [ ] **Step 1: Implement `lib/report-builder.mjs`**

```js
const ICON = {
  PRAZO: '📅',
  VENCIDO: '🔴',
  ESTADO: '🟡',
  DRIFT: '🔎',
  LIBERADO: '✅',
};

export function buildReport({ date, ativas, prazos, vencidos, estado, drift, saude, sheetUrl }) {
  const lines = [];
  lines.push(`🚨 SG3 GM — Daily Compliance Report — ${date}`);
  lines.push('');

  if (ativas?.length > 0) {
    lines.push(`✅ LIBERAÇÕES ATIVAS (${ativas.length})`);
    for (const a of ativas) {
      lines.push(`   • ${a.colaboradorNome} → ${a.plantaNome}    até ${a.prazoEfetivo}  (gargalo: ${a.bottleneck})`);
    }
    lines.push('');
  }

  if (prazos?.length > 0) {
    lines.push('📅 PRAZOS PRÓXIMOS');
    for (const p of prazos) lines.push(`   ⚠️ EM ${p.diasRestantes} DIAS — ${p.titulo}\n      ${p.detalhe}`);
    lines.push('');
  }

  if (vencidos?.length > 0) {
    lines.push('🔴 VENCIDOS');
    for (const v of vencidos) lines.push(`   ❌ ${v.titulo} — vencido há ${Math.abs(v.diasRestantes)} dia(s)\n      ${v.detalhe}`);
    lines.push('');
  }

  if (estado?.length > 0) {
    lines.push('🟡 PENDÊNCIAS DE ESTADO');
    for (const e of estado) lines.push(`   • ${e.titulo}\n      ${e.detalhe}`);
    lines.push('');
  }

  if (drift?.length > 0) {
    lines.push('🔎 DRIFT DRIVE × SG3');
    for (const d of drift) lines.push(`   • ${d.titulo}: ${d.detalhe}`);
    lines.push('');
  }

  lines.push('📊 SAÚDE DO PIPELINE');
  for (const [stage, status] of Object.entries(saude)) {
    const icon = status.ok ? '✅' : '❌';
    lines.push(`   • ${stage}: ${icon} ${status.detalhe}`);
  }
  lines.push('');

  if (sheetUrl) lines.push(`🔗 Sheet: ${sheetUrl}`);

  return lines.join('\n');
}

export function emptyDayMessage(date) {
  return `✅ Tudo OK em ${date}.`;
}
```

- [ ] **Step 2: Implement `check-expiries.mjs`**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { google } from 'googleapis';
import { loadConfig, dataDir, ROOT_DIR } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';
import { TABS } from './lib/sheet-schema.mjs';
import { evaluateTemporal, prazoEfetivoCarta, prazoLiberacaoEfetivo } from './lib/expiry-rules.mjs';
import { Notifier } from './lib/notifier.mjs';
import { AlertasLog } from './lib/alertas-log.mjs';
import { buildReport, emptyDayMessage } from './lib/report-builder.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('check-expiries');
const args = process.argv.slice(2);
const argDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
const MOCK_TODAY = args.find(a => a.startsWith('--mock-today='))?.split('=')[1];
const DRY_RUN = process.env.DRY_RUN === '1';

function hojeIso() {
  return MOCK_TODAY ?? new Date().toISOString().slice(0, 10);
}

function temporalAlerts(rows, tipo, leadTimes, hoje, titleFn, detailFn) {
  const out = { prazos: [], vencidos: [] };
  for (const row of rows) {
    if (!row.data_vencimento && !row.prazo_definido && !row.prazo_efetivo && !row.data_vencimento_propria) continue;
    const venc = row.data_vencimento ?? row.prazo_definido ?? row.prazo_efetivo ?? row.data_vencimento_propria;
    const r = evaluateTemporal({ tipo: tipo(row), dataVencimento: venc, hoje, leadTimes });
    if (!r) continue;
    const item = {
      diasRestantes: r.diasRestantes,
      titulo: titleFn(row),
      detalhe: detailFn(row),
      linhaId: `${row.__tabName}:${row.id}`,
    };
    if (r.severity === 'PRAZO')   out.prazos.push(item);
    if (r.severity === 'VENCIDO') out.vencidos.push(item);
  }
  return out;
}

async function main() {
  const cfg = loadConfig();
  const clients = buildClients(cfg);
  const client = new SheetClient(clients.sheets, cfg.sheet_id);
  const data = await client.readAll();
  const hoje = hojeIso();
  log.info('checking', { hoje });

  // Annotate with tab name for alert ids
  for (const tab of TABS) for (const r of data[tab.name] ?? []) r.__tabName = tab.name;

  const empresasById         = new Map((data.empresas ?? []).map(r => [r.id, r]));
  const colaboradoresById    = new Map((data.colaboradores ?? []).map(r => [r.id, r]));
  const plantasById          = new Map((data.plantas ?? []).map(r => [r.id, r]));
  const contratosById        = new Map((data.contratos ?? []).map(r => [r.id, r]));
  const cadastrosById        = new Map((data.cadastros_sg3 ?? []).map(r => [r.id, r]));
  const declaracoesByPair    = new Map((data.declaracoes_responsabilidade ?? []).map(r => [`${r.colaborador_id}-${r.planta_id}`, r]));
  const cartasByContrato     = mapByMany(data.cartas_subcontratacao ?? [], 'contrato_id');
  const cndsLumeByEmpresa    = mapByMany(data.docs_empresa ?? [], 'empresa_id');
  const docsColabByColab     = mapByMany(data.docs_colaborador ?? [], 'colaborador_id');
  const aprovacoesByCarta    = mapByMany(data.aprovacoes_email ?? [], 'carta_id');

  // Pre-compute prazo_efetivo for cartas, then write back
  const cartasCalc = computeCartasPrazoEfetivo(data, cndsLumeByEmpresa, contratosById);
  await writeBackPrazoEfetivo(client, data, cartasCalc);

  // 1. Temporal alerts
  const temporals = collectTemporal(data, cfg.lead_times, hoje);

  // 2. State alerts
  const estado = collectEstado(data, declaracoesByPair, hoje);

  // 3. Active liberations
  const ativas = computeAtivas({
    data, cadastrosById, contratosById, colaboradoresById, plantasById,
    cartasByContrato, cndsLumeByEmpresa, docsColabByColab, declaracoesByPair, aprovacoesByCarta, empresasById,
  });
  await writeBackPrazoLiberacao(client, data, ativas);

  // 4. Drift
  const drift = collectDrift(data);

  // 5. Health
  const saude = readSaude(argDate);

  // Dedupe and emit
  const logPath = resolve(ROOT_DIR, 'data/sg3-monitor/alertas-log.json');
  const dedupe = new AlertasLog(logPath);
  const allTemporal = [...temporals.prazos, ...temporals.vencidos];
  const fresh = allTemporal.filter(a => !dedupe.has(dedupe.keyFor({ linhaId: a.linhaId, diasRestantes: a.diasRestantes, dia: hoje })));

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.sheet_id}/edit`;
  const isEmpty = fresh.length + estado.length + drift.length + ativas.length === 0;
  const report = isEmpty ? emptyDayMessage(hoje) : buildReport({
    date: hoje,
    ativas,
    prazos: fresh.filter(a => a.diasRestantes >= 0),
    vencidos: fresh.filter(a => a.diasRestantes < 0),
    estado,
    drift,
    saude,
    sheetUrl,
  });

  // Persist last report locally
  const out = dataDir(argDate);
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'last-report.md'), report);

  if (DRY_RUN) {
    log.info('DRY_RUN — not posting');
    console.log(report);
    return;
  }

  const notifier = new Notifier({ chat: clients.chat, config: cfg });
  const result = await notifier.postPrimary(report);
  log.info('posted', result);

  for (const a of fresh) {
    dedupe.record(dedupe.keyFor({ linhaId: a.linhaId, diasRestantes: a.diasRestantes, dia: hoje }), {
      messageId: result.messageId, channel: result.channel,
    });
  }
  dedupe.save();

  // Escalation
  const escalators = temporals.vencidos.filter(v => /alocacao/.test(v.linhaId)).slice(0, 5);
  if (escalators.length > 0 && cfg.escalation) {
    await notifier.postEscalation(escalators.map(e => `❌ ${e.titulo} — ${e.detalhe}`).join('\n'));
  }
}

function mapByMany(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function collectTemporal(data, leadTimes, hoje) {
  const out = { prazos: [], vencidos: [] };
  const push = ({ prazos, vencidos }) => { out.prazos.push(...prazos); out.vencidos.push(...vencidos); };

  push(byTab(data.docs_colaborador ?? [], 'docs_colaborador',
    (r) => r.tipo, leadTimes, hoje,
    r => `${(r.tipo || '').toUpperCase()} de ${r.colaborador_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.docs_empresa ?? [], 'docs_empresa',
    (r) => r.tipo, leadTimes, hoje,
    r => `${(r.tipo || '').toUpperCase()} ${r.empresa_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.cartas_subcontratacao ?? [], 'cartas_subcontratacao',
    () => 'carta_subcontratacao', leadTimes, hoje,
    r => `Carta de subcontratação ${r.id}`,
    r => `Prazo efetivo: ${r.prazo_efetivo || r.data_vencimento_propria}`));

  push(byTab(data.aprovacoes_email ?? [], 'aprovacoes_email',
    (r) => r.tipo === 'juridico_gm' ? 'aprovacao_juridico' : 'default', leadTimes, hoje,
    r => `Aprovação ${r.tipo} (email ${r.assunto})`,
    r => `Prazo: ${r.prazo_definido}`));

  push(byTab(data.cadastros_sg3 ?? [], 'cadastros_sg3',
    () => 'cadastro_sg3', leadTimes, hoje,
    r => `Cadastro SG3 contrato ${r.contrato_id} planta ${r.planta_id}`,
    r => `Vence: ${r.data_vencimento}`));

  push(byTab(data.alocacoes ?? [], 'alocacoes',
    () => 'alocacao', leadTimes, hoje,
    r => `Alocação ${r.colaborador_id} × ${r.cadastro_sg3_id}`,
    r => `Vence: ${r.data_vencimento_propria}`));

  return out;
}

function byTab(rows, tabName, tipoFn, leadTimes, hoje, titleFn, detailFn) {
  const out = { prazos: [], vencidos: [] };
  for (const row of rows) {
    if (row.snooze_until && row.snooze_until > hoje) continue;
    const venc = row.data_vencimento ?? row.prazo_efetivo ?? row.data_vencimento_propria ?? row.prazo_definido;
    if (!venc) continue;
    const r = evaluateTemporal({ tipo: tipoFn(row), dataVencimento: venc, hoje, leadTimes });
    if (!r) continue;
    const item = {
      diasRestantes: r.diasRestantes,
      titulo: titleFn(row),
      detalhe: detailFn(row),
      linhaId: `${tabName}:${row.id}`,
    };
    (r.severity === 'PRAZO' ? out.prazos : out.vencidos).push(item);
  }
  return out;
}

function collectEstado(data, declaracoesByPair, hoje) {
  const out = [];
  const cadastrosById = new Map((data.cadastros_sg3 ?? []).map(r => [r.id, r]));

  for (const a of (data.alocacoes ?? [])) {
    const cad = cadastrosById.get(a.cadastro_sg3_id);
    if (a.status_sg3 === 'aprovada' && a.pendencias_sg3) {
      out.push({
        titulo: `Alocação ${a.colaborador_id} × ${a.cadastro_sg3_id} aprovada com pendências`,
        detalhe: `Pendências: ${a.pendencias_sg3}`,
      });
    }
    if (a.status_sg3 === 'liberada' && !a.data_email_patrimonial) {
      out.push({
        titulo: `Alocação ${a.colaborador_id} × ${a.cadastro_sg3_id} liberada sem email à patrimonial`,
        detalhe: `Planta ${cad?.planta_id ?? '?'} — enviar email à patrimonial`,
      });
    }
    if (a.decl_resp_uploaded_sg3 === 'false' && a.decl_resp_id) {
      const decl = (data.declaracoes_responsabilidade ?? []).find(d => d.id === a.decl_resp_id);
      if (decl?.assinaturas === 'completa') {
        out.push({
          titulo: `Declaração de responsabilidade pronta mas não enviada ao SG3`,
          detalhe: `Alocação ${a.id} — fazer upload da decl_resp_id ${a.decl_resp_id}`,
        });
      }
    }
  }

  for (const d of (data.declaracoes_responsabilidade ?? [])) {
    if (d.assinaturas !== 'completa') {
      const dependentes = (data.alocacoes ?? []).filter(a => a.decl_resp_id === d.id && (a.status_sg3 === 'aprovada' || a.status_sg3 === 'docs_pendentes'));
      if (dependentes.length > 0) {
        out.push({
          titulo: `Declaração ${d.id} ainda em ${d.assinaturas}`,
          detalhe: `${dependentes.length} alocação(ões) ativas dependem dela`,
        });
      }
    }
  }

  return out;
}

function computeCartasPrazoEfetivo(data, cndsLumeByEmpresa, contratosById) {
  const out = new Map();
  for (const c of (data.cartas_subcontratacao ?? [])) {
    const cnds = (cndsLumeByEmpresa.get(c.subcontratada_id) ?? [])
      .filter(d => d.tipo.startsWith('cnd_'))
      .map(d => ({ dataVencimento: d.data_vencimento }));
    const contrato = contratosById.get(c.contrato_id);
    const r = prazoEfetivoCarta({
      cartaVencimento: c.data_vencimento_propria,
      contratoFim: contrato?.data_fim,
      cndsLume: cnds,
    });
    if (r) out.set(c.id, r);
  }
  return out;
}

async function writeBackPrazoEfetivo(client, data, cartasCalc) {
  const tabName = 'cartas_subcontratacao';
  const cols = TABS.find(t => t.name === tabName).columns.map(c => c.name);
  const rows = data[tabName] ?? [];
  for (let i = 0; i < rows.length; i++) {
    const calc = cartasCalc.get(rows[i].id);
    if (!calc) continue;
    if (rows[i].prazo_efetivo === calc.data) continue;
    rows[i] = { ...rows[i], prazo_efetivo: calc.data, _atualizado_em: new Date().toISOString() };
    await client.overwriteRow(tabName, i, cols, rows[i]);
  }
}

function computeAtivas(ctx) {
  const out = [];
  const cadastrosById = ctx.cadastrosById;
  const cartasByContrato = ctx.cartasByContrato;
  const aprovacoesByCarta = ctx.aprovacoesByCarta;

  for (const a of (ctx.data.alocacoes ?? [])) {
    if (a.status_sg3 !== 'liberada') continue;

    const cad = cadastrosById.get(a.cadastro_sg3_id);
    const contrato = ctx.contratosById.get(cad?.contrato_id);
    const colaborador = ctx.colaboradoresById.get(a.colaborador_id);
    const planta = ctx.plantasById.get(cad?.planta_id);
    const decl = ctx.declaracoesByPair.get(`${a.colaborador_id}-${cad?.planta_id}`);
    const carta = cartasByContrato.get(cad?.contrato_id)?.[0];
    const aprovacaoJur = carta ? (aprovacoesByCarta.get(carta.id) ?? []).find(e => e.tipo === 'juridico_gm') : null;
    const docsColaborador = (ctx.docsColabByColab.get(a.colaborador_id) ?? []).map(d => ({ ...d, colaboradorNome: colaborador?.nome_completo }));
    const docsEmpresa = colaborador?.empresa_id !== 'strokmatic'
      ? (ctx.cndsLumeByEmpresa.get(colaborador?.empresa_id) ?? [])
      : [];
    const docsEmpresaNamed = docsEmpresa.map(d => ({ ...d, empresaNome: ctx.empresasById.get(d.empresa_id)?.razao_social }));

    const r = prazoLiberacaoEfetivo({
      alocacao: a,
      cadastroSg3: cad,
      contrato,
      docsColaborador,
      docsEmpresaSubcontratada: docsEmpresaNamed,
      cartaSubcontratacao: carta,
      aprovacaoJuridico: aprovacaoJur,
      declaracaoResponsabilidade: decl,
    });

    if (r.bloqueada) continue;
    out.push({
      alocacaoId: a.id,
      colaboradorNome: colaborador?.nome_completo ?? a.colaborador_id,
      plantaNome: planta?.nome ?? cad?.planta_id,
      prazoEfetivo: r.data ?? '?',
      bottleneck: r.bottleneck,
    });
  }

  return out.sort((x, y) => (x.prazoEfetivo ?? '').localeCompare(y.prazoEfetivo ?? ''));
}

async function writeBackPrazoLiberacao(client, data, ativas) {
  const tabName = 'alocacoes';
  const cols = TABS.find(t => t.name === tabName).columns.map(c => c.name);
  const rows = data[tabName] ?? [];
  const byId = new Map(ativas.map(a => [a.alocacaoId, a]));
  for (let i = 0; i < rows.length; i++) {
    const calc = byId.get(rows[i].id);
    if (!calc) continue;
    if (rows[i].prazo_liberacao_efetivo === calc.prazoEfetivo && rows[i].bottleneck_doc === calc.bottleneck) continue;
    rows[i] = { ...rows[i], prazo_liberacao_efetivo: calc.prazoEfetivo, bottleneck_doc: calc.bottleneck, _atualizado_em: new Date().toISOString() };
    await client.overwriteRow(tabName, i, cols, rows[i]);
  }
}

function collectDrift(data) {
  const out = [];
  const semMap = (data.contratos_drive ?? []).filter(r => !r.contrato_id);
  if (semMap.length > 0) out.push({ titulo: `${semMap.length} contrato(s) no Drive sem mapeamento`, detalhe: semMap.map(r => `"${r.file_name}"`).join(', ') });

  const contratoIds = new Set((data.contratos ?? []).map(r => r.id));
  const cadastrosByContrato = new Set((data.cadastros_sg3 ?? []).map(r => r.contrato_id));
  const semCadastro = [...contratoIds].filter(id => !cadastrosByContrato.has(id));
  if (semCadastro.length > 0) out.push({ titulo: `${semCadastro.length} contrato(s) sem cadastro_sg3`, detalhe: semCadastro.join(', ') });

  const driveContratoIds = new Set((data.contratos_drive ?? []).map(r => r.contrato_id).filter(Boolean));
  const cadastroSemDrive = (data.cadastros_sg3 ?? []).filter(r => !driveContratoIds.has(r.contrato_id));
  if (cadastroSemDrive.length > 0) out.push({ titulo: `${cadastroSemDrive.length} cadastro(s) SG3 sem PDF no Drive`, detalhe: cadastroSemDrive.map(r => r.contrato_id).join(', ') });

  return out;
}

function readSaude(argDate) {
  const tryRead = (kind) => {
    const p = resolve(ROOT_DIR, 'data/sg3-monitor', argDate, `${kind}-snapshot.json`);
    if (!existsSync(p)) return { ok: false, detalhe: 'snapshot ausente' };
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    return j.status === 'ok' ? { ok: true, detalhe: 'ok' } : { ok: false, detalhe: j.status ?? 'falha' };
  };
  return {
    'SG3 collect': tryRead('sg3'),
    'Drive collect': tryRead('drive'),
    'Email collect': tryRead('email'),
  };
}

main().catch(err => {
  log.error('check-expiries failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/check-expiries.mjs scripts/sg3-monitor/lib/report-builder.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): check-expiries with temporal, state, drift and ativas"
```

---

## Phase K — Bootstrap

### Task 19: `bootstrap.mjs`

Creates the Sheet, runs the spike, performs the initial data load, writes a gap report.

**Files:**
- Create: `scripts/sg3-monitor/bootstrap.mjs`

- [ ] **Step 1: Implement**

```js
#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadConfig, ROOT_DIR } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { TABS } from './lib/sheet-schema.mjs';
import { makeLogger } from './lib/logger.mjs';

const log = makeLogger('bootstrap');

async function ensureSheet(sheetsApi, drive, cfg) {
  if (cfg.sheet_id) {
    log.info('sheet_id already set in config; skipping creation');
    return cfg.sheet_id;
  }

  log.info('creating new spreadsheet');
  const r = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title: cfg.sheet_name },
      sheets: TABS.map(tab => ({
        properties: { title: tab.name },
        data: [{ rowData: [{ values: tab.columns.map(c => ({ userEnteredValue: { stringValue: c.name } })) }] }],
      })),
    },
  });
  const sheetId = r.data.spreadsheetId;
  log.info('spreadsheet created', { sheetId });

  // Persist sheet_id back to config.json
  const configPath = resolve(ROOT_DIR, 'config/sg3-monitor/config.json');
  const updated = { ...cfg, sheet_id: sheetId };
  writeFileSync(configPath, JSON.stringify(updated, null, 2));
  log.info('config.json updated with sheet_id');

  return sheetId;
}

async function shareSheet(driveApi, sheetId, emails) {
  for (const email of emails) {
    try {
      await driveApi.permissions.create({
        fileId: sheetId,
        requestBody: { role: 'writer', type: 'user', emailAddress: email },
        sendNotificationEmail: false,
      });
      log.info('shared with', { email });
    } catch (err) {
      log.warn('share failed', { email, err: err.message });
    }
  }
}

async function main() {
  const cfg = loadConfig();
  const { sheets, drive, gmail } = buildClients(cfg);

  // 1. Sheet
  const sheetId = await ensureSheet(sheets, drive, cfg);
  await shareSheet(drive, sheetId, [cfg.impersonate_subject]);
  log.info('sheet ready', { url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });

  // 2. SG3 spike — note for the operator
  log.info('next: run the SG3 spike manually to populate config/sg3-monitor/clients/gm.json. ' +
           'Open Chrome DevTools on the SG3 portal, observe network calls, and either: ' +
           '(a) configure use_api=true with endpoints; or (b) configure Playwright with selectors. ' +
           'See clients/gm.json.example for the schema.');

  if (!existsSync(resolve(ROOT_DIR, 'config/sg3-monitor/clients/gm.json'))) {
    log.warn('gm.json not yet populated — extraction skipped. Re-run bootstrap after spike.');
    return;
  }

  // 3-5. Run the 3 collectors
  const today = new Date().toISOString().slice(0, 10);
  for (const script of ['collect-sg3.mjs', 'collect-drive-contratos.mjs', 'collect-emails.mjs']) {
    log.info(`running ${script}`);
    const r = spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor', script), today], { stdio: 'inherit' });
    if (r.status !== 0) log.warn(`${script} exited non-zero`);
  }

  // 6. Sync
  log.info('running sync-sheet.mjs');
  spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor/sync-sheet.mjs'), today], { stdio: 'inherit' });

  // 7. Gap report
  await writeGapReport(today, sheets, sheetId);
}

async function writeGapReport(today, sheetsApi, sheetId) {
  const out = resolve(ROOT_DIR, 'data/sg3-monitor/bootstrap');
  mkdirSync(out, { recursive: true });
  // Read all tabs and compute gaps
  const r = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: TABS.map(t => `${t.name}!A1:ZZ`),
  });

  const data = {};
  r.data.valueRanges.forEach((vr, i) => {
    const [header, ...rows] = vr.values ?? [[]];
    data[TABS[i].name] = rows.map(row => Object.fromEntries((header ?? []).map((h, j) => [h, row[j] ?? ''])));
  });

  const gaps = [];
  for (const c of (data.colaboradores ?? [])) {
    const asos = (data.docs_colaborador ?? []).filter(d => d.colaborador_id === c.id && d.tipo === 'aso');
    if (asos.length === 0) gaps.push(`- Colaborador ${c.id} sem ASO em docs_colaborador`);
  }
  for (const p of (data.plantas ?? [])) {
    if (!p.patrimonial_email) gaps.push(`- Planta ${p.id} sem patrimonial_email`);
  }
  for (const e of (data.empresas ?? [])) {
    if (e.tipo === 'subcontratada' || e.tipo === 'mei') {
      const cnds = (data.docs_empresa ?? []).filter(d => d.empresa_id === e.id && d.tipo.startsWith('cnd_'));
      if (cnds.length === 0) gaps.push(`- Empresa ${e.id} (${e.tipo}) sem CNDs cadastradas`);
    }
    if (e.tipo === 'principal' || e.tipo === 'subcontratada') {
      const pgr = (data.docs_empresa ?? []).find(d => d.empresa_id === e.id && d.tipo === 'pgr');
      const pcmso = (data.docs_empresa ?? []).find(d => d.empresa_id === e.id && d.tipo === 'pcmso');
      if (!pgr) gaps.push(`- Empresa ${e.id} sem PGR`);
      if (!pcmso) gaps.push(`- Empresa ${e.id} sem PCMSO`);
    }
  }
  for (const pg of (data.pessoas_gm ?? [])) {
    if (!pg.email) gaps.push(`- pessoas_gm ${pg.id} sem email`);
    if (!pg.papeis) gaps.push(`- pessoas_gm ${pg.id} sem papeis declarados`);
  }

  const md = [
    `# SG3 Bootstrap Gap Report — ${today}`, '',
    `Lacunas detectadas (${gaps.length}). Preencha manualmente na Sheet:`, '',
    ...gaps,
  ].join('\n');
  writeFileSync(resolve(out, 'gap-report.md'), md);
  log.info('gap report written', { count: gaps.length });
}

main().catch(err => {
  log.error('bootstrap failed', { err: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run bootstrap to create the Sheet**

```bash
cd /home/teruel/JARVIS && node scripts/sg3-monitor/bootstrap.mjs
```

Expected (first run, before spike): a Sheet is created, shared with `pedro@lumesolutions.com`, the `config.json` gets a `sheet_id`, and the script exits with a warning that `clients/gm.json` is missing. Open the Sheet URL printed and verify the 13 tabs exist.

- [ ] **Step 3: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/bootstrap.mjs config/sg3-monitor/config.json && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): bootstrap orchestrator (creates sheet + gap report)"
```

---

## Phase L — CLI status command

### Task 20: `status.mjs`

CLI that reads the Sheet and prints a tabular `liberações ativas` view to stdout.

**Files:**
- Create: `scripts/sg3-monitor/status.mjs`

- [ ] **Step 1: Implement**

```js
#!/usr/bin/env node
import { loadConfig } from './lib/config.mjs';
import { buildClients } from './lib/google-clients.mjs';
import { SheetClient } from './lib/sheet-client.mjs';

async function main() {
  const cfg = loadConfig();
  const { sheets } = buildClients(cfg);
  const client = new SheetClient(sheets, cfg.sheet_id);
  const ativas = (await client.readTab('alocacoes'))
    .filter(a => a.status_sg3 === 'liberada')
    .sort((x, y) => (x.prazo_liberacao_efetivo ?? '').localeCompare(y.prazo_liberacao_efetivo ?? ''));

  if (ativas.length === 0) {
    console.log('(sem liberações ativas)');
    return;
  }

  const colaboradores = await client.readTab('colaboradores');
  const cadastros = await client.readTab('cadastros_sg3');
  const plantas = await client.readTab('plantas');
  const colMap = Object.fromEntries(colaboradores.map(c => [c.id, c]));
  const cadMap = Object.fromEntries(cadastros.map(c => [c.id, c]));
  const plaMap = Object.fromEntries(plantas.map(p => [p.id, p]));

  console.log(`Liberações ativas (${ativas.length})\n`);
  for (const a of ativas) {
    const colNome = colMap[a.colaborador_id]?.nome_completo ?? a.colaborador_id;
    const cad = cadMap[a.cadastro_sg3_id];
    const plaNome = plaMap[cad?.planta_id]?.nome ?? cad?.planta_id;
    const prazo = a.prazo_liberacao_efetivo || '?';
    const bottleneck = a.bottleneck_doc || '?';
    console.log(`  ${colNome.padEnd(28)} → ${plaNome.padEnd(20)} até ${prazo}  (${bottleneck})`);
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 2: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/status.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): npm run sg3:status cli"
```

---

## Phase M — Orchestrator and cron

### Task 21: `run.sh` orchestrator

**Files:**
- Create: `scripts/sg3-monitor/run.sh`

- [ ] **Step 1: Create**

```bash
#!/bin/bash
# SG3 Compliance Monitor — Orchestrator
# Runs the daily pipeline: 3 collectors in parallel, then sync, then check.
set -uo pipefail   # NOT -e: collector failures must not abort the whole pipeline

ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/JARVIS}"
DATE=$(date +%F)
OUT="$ORCHESTRATOR_HOME/data/sg3-monitor/$DATE"
LOG_DIR="$ORCHESTRATOR_HOME/logs"
mkdir -p "$OUT" "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [run] $*" | tee -a "$LOG_DIR/sg3-monitor.log"; }

cd "$ORCHESTRATOR_HOME"

log "starting collectors in parallel"
node scripts/sg3-monitor/collect-sg3.mjs              "$DATE" > "$OUT/sg3.log"   2>&1 &
node scripts/sg3-monitor/collect-drive-contratos.mjs  "$DATE" > "$OUT/drive.log" 2>&1 &
node scripts/sg3-monitor/collect-emails.mjs           "$DATE" > "$OUT/email.log" 2>&1 &
wait
log "collectors done"

log "syncing sheet"
node scripts/sg3-monitor/sync-sheet.mjs "$DATE" > "$OUT/sync.log" 2>&1 || log "sync exited non-zero"

log "checking expiries"
node scripts/sg3-monitor/check-expiries.mjs "$DATE" > "$OUT/check.log" 2>&1 || log "check exited non-zero"

log "done"
```

- [ ] **Step 2: Make executable, smoke run dry**

```bash
chmod +x /home/teruel/JARVIS/scripts/sg3-monitor/run.sh && \
DRY_RUN=1 bash /home/teruel/JARVIS/scripts/sg3-monitor/run.sh
```

Expected: collectors run (sg3 produces auth_expired or empty if no spike), sync runs, check produces report in DRY_RUN mode (printed to check.log).

- [ ] **Step 3: Add `run-collectors.mjs` for `npm run sg3:collect-only`**

Create `scripts/sg3-monitor/run-collectors.mjs`:

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT_DIR } from './lib/config.mjs';

const date = new Date().toISOString().slice(0, 10);
for (const script of ['collect-sg3.mjs', 'collect-drive-contratos.mjs', 'collect-emails.mjs']) {
  spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor', script), date], { stdio: 'inherit' });
}
```

- [ ] **Step 4: Commit**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/run.sh scripts/sg3-monitor/run-collectors.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): bash orchestrator and collect-only runner"
```

---

### Task 22: Add cron entry

**Files:**
- Modify: `(user crontab)` — manual

- [ ] **Step 1: Confirm with user before installing the cron**

Output to user:

> Pronto pra instalar. Vou adicionar a entrada cron `0 7 * * * /home/teruel/JARVIS/scripts/sg3-monitor/run.sh`. Confirma?

- [ ] **Step 2: After confirmation, install**

```bash
( crontab -l 2>/dev/null | grep -v 'sg3-monitor/run.sh' ; echo '0 7 * * * /home/teruel/JARVIS/scripts/sg3-monitor/run.sh' ) | crontab -
crontab -l | grep sg3-monitor
```

Expected: the new line is listed.

- [ ] **Step 3: No commit needed — crontab is host state, not in repo**

---

## Phase N — SG3 spike (operator-driven, in plan for tracking)

### Task 23: SG3 spike + selector population

This task is performed once by the operator. The plan documents the procedure so it doesn't get lost.

**Files:**
- Modify: `config/sg3-monitor/clients/gm.json` (gitignored)
- Modify: `scripts/sg3-monitor/lib/sg3-client.mjs` (real `scrapeCadastros` and `scrapeAlocacoes` implementations)

- [ ] **Step 1: Investigate API in browser**

Open Chrome DevTools → Network tab on the SG3 GM portal. Log in, navigate the cadastros/alocações/status screens, and observe XHR/fetch calls:
- If endpoints returning JSON exist with predictable URLs, copy their paths into `clients/gm.json`'s `api.endpoints` object and set `use_api: true`.
- If only HTML pages render server-side, set `use_api: false` and collect URLs and CSS selectors for the Playwright path.

- [ ] **Step 2: Save credentials**

Create `~/.secrets/sg3-credentials.json` (mode 600):

```json
{ "gm": { "username": "<user>", "password": "<pass>" } }
```

- [ ] **Step 3: Create `config/sg3-monitor/clients/gm.json`**

Copy `clients/gm.json.example` to `clients/gm.json` and fill in real values. If `use_api: true`, fill in `api.base_url` and `endpoints`. If false, fill in `playwright.login_url`, `scrape_targets.*`, and `selectors.*`.

- [ ] **Step 4: Implement real `scrapeCadastros` and `scrapeAlocacoes`**

Replace the placeholders in `scripts/sg3-monitor/lib/sg3-client.mjs` with concrete Playwright (or fetch-based, if API exists) implementations that return:

```js
{
  cadastros_sg3: [{ id, contrato_id, planta_id, responsavel_planta_id, status_aprovacao, data_aprovacao, data_vencimento, sg3_url, _origem: 'sg3' }],
  colaboradores: [{ id, nome_completo, cpf, empresa_id, _origem: 'sg3' }],
  plantas: [{ id, cliente: 'GM', nome, _origem: 'sg3' }],
  pessoas_gm: [{ id, nome, email, tem_user_sg3: true, papeis: 'responsavel_planta', plantas, _origem: 'sg3' }],
  alocacoes: [{ id, colaborador_id, cadastro_sg3_id, status_sg3, pendencias_sg3, data_inicio, data_vencimento_propria, _origem: 'sg3' }],
}
```

The exact selectors/URLs depend on the spike outcome. Use the contract above as the function's return shape — sync-sheet.mjs already consumes it.

- [ ] **Step 5: Smoke run**

```bash
cd /home/teruel/JARVIS && node scripts/sg3-monitor/collect-sg3.mjs $(date +%F)
cat /home/teruel/JARVIS/data/sg3-monitor/$(date +%F)/sg3-snapshot.json | jq '.status, .cadastros_sg3 | length'
```

Expected: status `ok`, non-zero cadastros count.

- [ ] **Step 6: Re-run bootstrap to populate the Sheet for the first time**

```bash
cd /home/teruel/JARVIS && node scripts/sg3-monitor/bootstrap.mjs
```

The bootstrap detects `clients/gm.json` is now present, runs all 3 collectors, syncs the Sheet, and produces a gap report. Open the Sheet to fill remaining manual fields (PGR/PCMSO, Lume CNDs, cartas, etc.).

- [ ] **Step 7: Commit only the sg3-client.mjs changes (gm.json is gitignored)**

```bash
git -C /home/teruel/JARVIS add scripts/sg3-monitor/lib/sg3-client.mjs && \
  git -C /home/teruel/JARVIS commit -m "feat(sg3): real sg3 scrape implementation post-spike"
```

---

## Self-Review Notes

After writing this plan, I checked it against the spec:

**Spec coverage:**
- §1 Context/objective: covered by overall scope.
- §2 Architecture: Phase A (skeleton), Phase D (clients), Phases E/F/G (collectors), H (sync), J (alerts), M (orchestrator). ✓
- §2.1 Layout: Task 1 establishes; subsequent tasks fill. ✓
- §2.2 JARVIS reuse: `mcp-servers/lib/google-auth.mjs` reused in Task 8; vk-health pattern echoed in run.sh (Task 21). ✓
- §3.2 13 tabs: Task 4 (`sheet-schema.mjs`) declares all 13. Bootstrap (Task 19) creates them. ✓
- §3.3 Files outside Sheet: snapshots in `data/sg3-monitor/{date}/`, alertas-log.json (Task 6), gap-report (Task 19). ✓
- §4.1 collect-sg3: Task 14 + 15 + 23 (spike). ✓
- §4.2 collect-drive: Tasks 10 + 11. ✓
- §4.3 collect-emails: Tasks 12 + 13. ✓
- §4.4 sync-sheet: Task 16. ✓
- §5.2 Temporal/state/active/drift evaluations: Task 18. ✓
- §5.3 Dedupe: Task 6 + integration in Task 18. ✓
- §5.4 Mensagem format: Task 18 (`report-builder.mjs`). ✓
- §5.5 Routing: Task 17 (notifier). ✓
- §6 Bootstrap: Task 19. ✓
- §7 Manual entry: enabled by Sheet structure (Task 4 + 19). ✓
- §8 Failure handling: Task 15 (sg3 status field), Task 16 (sync-sheet missing snapshot fallback via Task 16's snapshot-loader), Task 18 (read saude). ✓
- §9 Tests: unit tests Tasks 2/3/4/5/6/10. Integration smoke runs documented in Tasks 11/13/15/19/23. ✓
- §10.8 CLI status: Task 20. ✓
- §10.9 Cron: Tasks 21/22. ✓
- §10.10 Snooze: implemented in Task 18 (`row.snooze_until > hoje` check). ✓

**Placeholders:** none of the "TBD/TODO/handle edge cases" anti-patterns. Real selectors for SG3 are filled by the spike (Task 23) — the contract is documented in Task 14.

**Type consistency:** function signatures used in Task 18 (`evaluateTemporal`, `prazoEfetivoCarta`, `prazoLiberacaoEfetivo`) match Task 2's exports. `SheetClient.overwriteRow(name, rowIndex0Based, columns, row)` matches its declaration in Task 9.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-sg3-compliance-monitor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
