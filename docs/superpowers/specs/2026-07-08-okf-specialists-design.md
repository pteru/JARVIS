---
type: Design Spec
title: OKF Specialists — Journal Bundle + Topic Specialists (skill + agent)
description: Session-work distillation into a versioned OKF journal bundle, plus per-topic specialists as thin twin wrappers (session skill + dispatchable agent) over a single OKF boot convention.
tags: [jarvis, okf, journal, specialists, agents]
timestamp: 2026-07-08
product: general
status: draft
language: en
---

# OKF Specialists — Journal Bundle + Topic Specialists

**Date:** 2026-07-08
**Status:** Draft — awaiting review
**Builds on:** [2026-07-04-okf-adoption-design.md](2026-07-04-okf-adoption-design.md) (catalog, bundles, `okf` CLI, frontmatter schema)

## Problem

Continuous work today lives in renamed Claude Code sessions (21 named sessions found:
`sealer`, `arcelor-data`, `iris-scds`, `pmo-build`, …) that the owner resumes per
topic. The context lives in the transcript: unbounded growth, unsearchable from other
sessions, dies with the session. What has been distilled into OKF is instantly
retrievable (`okf search`), but *work-in-progress across recent sessions* is not —
resuming a topic means resuming the exact session.

Goal: **topic specialists** that any session can summon, which rehydrate from recent
work in seconds — with OKF as the memory substrate, not the transcript.

## Decision summary (owner-confirmed)

- **Specialist = retrieval convention, not resident memory.** A specialist knows
  *how to boot from OKF*; it owns no state between invocations.
- **Two thin wrappers per specialist (option c):** a session skill
  (`/sealer` — the session becomes the conversation with the specialist) and a
  dispatchable subagent (`sealer-specialist` — any session/orchestrator/cron
  delegates tasks to it). Same boot text in both.
- **Journal bundle in the JARVIS repo, versioned to GitHub** (`pteru/JARVIS`,
  private) — **all topics, including personal ones** (owner decision; the
  alternative of keeping personal topics in the local memory bundle was offered
  and declined). Non-negotiable discipline: **never a secret/credential in a
  journal entry**; `journal/` **excluded from the FORGE distribution build**.
- **No automation hooks now** — journal entries are written by the session-end
  directive (manual-formalized). Hook automation is a future decision.
- **No embeddings/RAG** — `okf search` over distilled entries; transcripts stay
  out of the retrieval path.

## 1. The `journal/` bundle

New top-level directory in the JARVIS repo; 5th bundle in `knowledge/index.md`
(lint scope `**`, entry point `index.md`, remote `pteru/JARVIS`).

Entry = one session work-block, file `journal/YYYY-MM-DD-<topic>.md` (suffix
`-2`, `-3` for same-day same-topic entries):

```yaml
---
type: Session Log
title: 2026-07-08 — okf — governança Drive 03008 executada
description: Uma frase com o resultado principal do bloco de trabalho.
tags: [okf, gdrive, "03008", automacao]   # topic slug first, then project codes AND field tags
timestamp: 2026-07-08
session: okf                           # the named session (or "untitled")
project: "03008"                       # when project-scoped; omit otherwise
product: visionking                    # when applicable
language: pt-BR
---
```

Body (20–40 lines, PT-BR): **Feito** (o que mudou, com commits/SHAs e repos) ·
**Decisões** (e por quê) · **Pendências/próximos passos** · **Links** (páginas OKF
tocadas, specs, drive-plans). It is a distillation, never a transcript dump.

`journal/index.md` regenerated via `okf index journal` (hand descriptions preserved).

**Safety rails:** (a) no secrets — same rule as the whole repo, but journals are
prose written at speed, so the session-end directive explicitly repeats it;
(b) `build-forge.sh` gains `journal/` in its exclusion list (FORGE must never ship
the owner's work diary); (c) personal-topic entries are the owner's accepted risk
in his private repo — no extra mechanism.

## 2. The boot convention (single source)

One reference file, `journal/BOOT.md` (type: Procedure), containing the canonical
boot steps every specialist embeds or reads:

1. Read `~/JARVIS/knowledge/index.md` (catalog).
2. `python3 ~/JARVIS/scripts/okf/okf.py search <topic-terms> --tag <topic-slug>` —
   collect hits across journal + knowledge-base + pmo + engineering-docs.
3. Read the 2–3 most recent `journal/` hits for the topic (by filename date).
4. Read the knowledge pages those entries link to (project `knowledge/` layers,
   concepts, specs) — progressive disclosure, not exhaustive reading.
5. Only then act. Cite OKF sources in answers.

## 3. Specialist wrappers

Generated from one template pair; per-specialist deltas are: slug, topic terms,
tags, primary bundles/pages, and (for agents) tool restrictions.

- **Skill:** `.claude/skills/<slug>/SKILL.md` — name, description ("Especialista
  em <topic> — carrega contexto OKF recente"), body = boot convention with the
  specialist's terms + "assuma a persona de especialista no tópico; ao final do
  bloco de trabalho, escreva a entrada de journal".
- **Agent:** `.claude/agents/<slug>-specialist.md` — frontmatter `name`,
  `description` (with "use for…" guidance), `tools: Read, Bash, Grep, Glob`
  (read-only default; owner grants write per specialist later if needed),
  `model: sonnet`. System prompt = same boot + "your final message is the
  deliverable returned to the caller; cite OKF sources".

### Two specialist classes (owner-refined, 2026-07-08)

- **Project specialists** boot from one project's `knowledge/` layer + journal
  entries tagged with the project slug.
- **Field specialists** are cross-project: they boot from KB **concept pages** +
  `okf search` by FIELD tag across all bundles. The KB concepts layer
  (integracao-plc, saude-de-producao, …) is precisely their substrate — a field
  specialist is a concept page made conversational.
- The load-bearing mechanism is **tag discipline**: every journal entry carries
  its project tag(s) AND its field tag(s) (e.g. `[sealer, "03008", automacao,
  servo-drive]`). Boot is query-driven — a specialist never loads "everything it
  owns", only the 2–3 entries matching the task at hand — so wide specialists
  (like `pessoal`) route sub-topics without flooding the context window.

### Seed — project specialists

| Slug | Absorbs sessions | Primary OKF base |
|---|---|---|
| `sealer` | sealer | 03008 layer, 11 sealer specs, drive-plan |
| `iris-scds` | iris-scds | 03007 layer, IRIS specs |
| `stellantis` | stellantis | 03010 layer |
| `arcelor` | (client context of arcelor-*) | 03002/03009 layers |
| `sparktest` | sparktest | new project (VK profile) — journal-first + spark-test-controller service docs |
| `mercedes-vk` | mercedes-vk | 03904 — journal-first |
| `smartdie` | smartdie-sjc | 01001 — journal-first |
| `magna` | magna | journal-first — estudo de prospecção (possível novo cliente) |
| `nissan-smyrna` | (no named session yet) | 02008 layer (smartcam, contexto completo) |
| `eip` | (no named session yet) | strokmatic-eip workspace (OpENer C service) — journal-first + repo docs |

### Seed — field specialists (cross-project)

| Slug | Field | Origin sessions | Primary OKF base |
|---|---|---|---|
| `automacao` | Spec/integration of automation components (servo drives, PLCs, GSDML, drive protocols) | distributed across sealer/iris-scds/stellantis | KB concept `integracao-plc`, sealer-axis + IRIS + Stellantis specs, journal by field tag |
| `vk-producao` | VK production monitoring & troubleshooting | arcelor-vpn | KB concept `saude-de-producao`, vk-health, deploy pages |
| `dados-producao` | Backup & data/image structuring (dumps, migrations, DAS, GCS) | arcelor-data | 03002 `dados.md`, migration lessons, journal by field tag |
| `blender` | The Blender tool, cross-project 3D tooling | blender | sdk-blender-tools specs, journal by field tag |
| `gm` | GM norms + SupplyPower platform access (serves VK/DM/SF projects with GM) | supplypower | journal-first + 03007 gm-supplypower material |
| `pmo` | PMO processes, email pipeline, sprints, Drive governance | pmo-build, emails, sprint-helper | KB pmo/processos, governance spec |
| `okf` | The knowledge system itself | okf | catalog, okf specs/plans, this spec |
| `jarvis` | Orchestrator maintenance | jarvis | engineering-docs, orchestrator config |
| `administrativo` | Company administration — RH and, over time, other admin fields (contracts, finance, procurement) | rh | journal-first (company topic, NOT personal) |
| `propriedade-intelectual` | Patents & IP across products (VK 03000 incl. pending "IA Regionalizada" correction; SpotFusion 02000) | — | patent project folders + journal by field tag |
| `pessoal` | Personal topics ROUTER — sub-tags `aeroporto`, `arrendamento`, `amendoim`; boot filters by the task's sub-tag | aeroporto, arrendamento, amendoim | journal-only (versioned per owner decision) |

21 specialists (10 project + 11 field), 42 wrapper files — all template-generated,
so the marginal cost of a specialist is minutes.

### Adding a specialist later (the ratchet)

Dormant projects (01002–01005, 02001–02007, 03001, 03003, 03005/03006, …) and
future fields get specialists **when their first journal entry appears**, via a
generator:

`python3 scripts/okf/new_specialist.py <slug> --class project|field
--terms "<search terms>" --tags "<tag,tag>" [--project "NNNNN"] [--pages <paths>]`

It renders both wrappers from the embedded template pair
(`.claude/skills/<slug>/SKILL.md` + `.claude/agents/<slug>-specialist.md`) and
appends the slug to the roster table in `journal/BOOT.md`. Idempotent (refuses to
overwrite an existing specialist without `--force`). Any session can run it —
or simply ask the `okf` specialist to. Excluded from seeding: `jarvis-39`/`jarvis-f2` (instance
names, not topics) and one accidental rename (`"2. yes, do one more round (Branch)"`).

Open analysis item (owner-invited): which further abstractions inside the arcelor
work generalize (e.g. camera-image lifecycle, burn-in practices) — to be split out
as field specialists when their journal mass justifies it.

## 4. Session-end directive (CLAUDE.md)

The existing "Session Directives" block changes: lessons still go to MEMORY.md and
`docs/lessons-learned.md`, **plus** — for any substantive work block — a
`journal/YYYY-MM-DD-<topic>.md` entry per §1 (with the no-secrets reminder).
`/jarvis` gains nothing new (the catalog already lists the bundle); the boot
convention lives in `journal/BOOT.md`.

## 5. Rollout

1. `journal/` bundle: BOOT.md + index + catalog row + CLAUDE.md directive +
   FORGE exclusion. Seed the first entry by back-filling THIS session's arc
   (OKF adoption → Drive governance → specialists) as the exemplar.
2. Generator (`scripts/okf/new_specialist.py`) + template pair; run it 21× to
   create the 21 skills + 21 agents (10 project + 11 field). Field-specialist
   boots search by FIELD tag across bundles; project boots by project slug/code.
3. **Full back-fill (owner decision):** one journal entry per named session
   (~20 topics), distilled by one agent per session using MECHANICAL extraction
   from the transcript jsonl (user messages + final assistant conclusions via
   script — never a full-transcript read), entry `timestamp` = the session's
   last-activity date (not today), plus a `backfill` tag marking provenance.
   Back-filled entries are snapshots that age gracefully under fresh ones
   (boots read most-recent first). Sample review: 3–4 entries audited against
   their transcripts before accepting the batch. This session's entry is
   written first-hand as the exemplar (no extraction needed).
4. Verify: `okf lint` (journal bundle 100%), one live drill — dispatch
   `sealer-specialist` with a question answerable only from the journal+layer
   (e.g. current drive-plan pendências) and check it cites correctly.

## Out of scope

- Hook-automated journal writing (future decision).
- Embeddings/RAG over transcripts.
- Retro-distilling sessions' FULL history (back-fill is one entry per session —
  its latest state — not an entry per work block of the past).
- Granting write tools to specialist agents (start read-only).
- Migrating personal topics out of the versioned repo (owner accepted the trade-off).

## Testing

- `okf lint` covers the new bundle (frontmatter, index completeness).
- Skill/agent template: dry validation by invoking one skill (`/sealer`) and one
  agent dispatch (drill in §5.4) before declaring done.
- FORGE: run `build-forge.sh` leak-validation step (or its dry mode) to confirm
  `journal/` absent from the artifact.
