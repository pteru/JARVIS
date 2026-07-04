---
type: Design Spec
title: OKF Adoption — Federated Knowledge Bundles
description: Adopt the Open Knowledge Format (OKF v0.1) across all four JARVIS knowledge stores, federated as independent bundles under a single root catalog.
tags: [jarvis, knowledge, okf, pmo, knowledge-base]
timestamp: 2026-07-04
status: active
language: en
---

# OKF Adoption — Federated Knowledge Bundles

**Date:** 2026-07-04
**Status:** Active — implemented 2026-07-04 (see plan amendments)
**References:**
- [OKF v0.1 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [cole-medin-ai-coding](https://github.com/coleam00/cole-medin-ai-coding) (worked example: concepts layer + stdlib CLI)

## Problem

Strokmatic/JARVIS knowledge lives in four stores with four different conventions, none
self-describing and none linked:

| Store | Contents | Gap |
|---|---|---|
| PMO `projects/` (repo `teruelskm/pmo`) | 27 project folders of raw material (emails, meetings, reference, reports); only 02008 has a `context.md` | No curated layer, no metadata, no indexes |
| `knowledge-base` repo (`teruelskm/knowledge-base`) | 128 curated PT-BR pages, `INDEX.md`, product taxonomy | Metadata in blockquotes, not machine-parseable; no cross-project concept pages |
| `docs/superpowers/` (JARVIS repo) | ~50 dated design specs + plans (SSOT) | Discoverable only by filename; no metadata |
| Claude memory dir (`~/.claude/projects/-home-teruel-JARVIS/memory/`) | 107 fact files | Already quasi-OKF (YAML frontmatter + `MEMORY.md` index); missing top-level `type` |

Consequences: cross-project questions ("what do we know about camera acquisition across
VK projects?") require grep and tribal knowledge; `/pmo` probes hardcoded filenames;
the KB chat bot retrieves over unstructured chunks; dispatched agents have no
knowledge entry point.

## Decision summary

Adopt **OKF v0.1** as the shared convention for all four stores, structured as
**federated bundles with a root catalog** (Approach A of three considered):

- Each store becomes an independent OKF bundle **in place** — no content moves,
  no repo consolidation. Preserves repo boundaries, git history, audiences
  (KB is colleague-facing PT-BR; specs are engineering-facing), and the existing
  "docs/superpowers is SSOT for specs" rule.
- A thin **root catalog** in the JARVIS repo lists all bundles and is the single
  entry point for agents and humans.
- Cross-cutting **concept pages** live in the knowledge-base repo and link across
  projects and specs (the cole-medin `concepts/` pattern).
- **Migration is an incremental ratchet**: new content conforms from day one;
  existing content is migrated scripted-where-cheap (KB) or opportunistically
  (PMO projects, specs, memories).
- PMO projects get a **curated layer only**: raw artifacts stay untouched; small
  `knowledge/` concept pages summarize and point to them via `resource`.

Rejected alternatives:
- **B — KB repo as single hub**: pulls project knowledge away from where it is
  authored; violates specs-SSOT rule; requires bulk moves contradicting the ratchet.
- **C — convention only, no catalog**: cheapest, but delivers no cross-project
  discovery — the primary goal.

Consumers this must serve (all four, per requirements): interactive Claude sessions
(`/pmo`, `/jarvis`), dispatched/autonomous agents, the KB chat bot (Google Chat RAG),
and humans browsing GitHub.

## 1. Architecture

### Bundles

| Bundle | Root | Remote |
|---|---|---|
| `pmo` | `workspaces/strokmatic/pmo/` | `teruelskm/pmo` |
| `knowledge-base` | `workspaces/strokmatic/knowledge-base/` | `teruelskm/knowledge-base` |
| `engineering-docs` | `docs/superpowers/` | `pteru/JARVIS` |
| `memory` | `~/.claude/projects/-home-teruel-JARVIS/memory/` | (local only) |

### Root catalog

New file `knowledge/index.md` at the JARVIS repo root. Frontmatter declares
`okf_version: "0.1"`. Body is one table: **bundle name → local path → remote URL →
entry point → one-line description**. This table is also the URL→path mapping used
to resolve cross-bundle links locally.

Every consumer starts here: skills read it, dispatched agents receive its path in
workspace context, humans click through it on GitHub.

### Concepts layer

`knowledge-base/concepts/` holds cross-cutting theme pages (`type: Concept`), e.g.
`aquisicao-de-cameras.md`, `integracao-plc.md`, `deflectometria.md`,
`saude-de-producao.md`. Each concept: what it is, which projects touch it, links to
the relevant project knowledge pages, deep-dives, and specs. Concepts are the
"across projects" access path.

## 2. Frontmatter schema

One convention for all bundles. OKF core fields plus Strokmatic extensions
(extensions are permitted by OKF §frontmatter; consumers must preserve unknown keys):

```yaml
---
type: Lesson Learned          # REQUIRED (OKF). Open vocabulary, see below.
title: Câmeras 03002 — dimensionamento
description: Uma frase que resume a página.
tags: [visionking, cameras, "03002"]
resource: https://drive.google.com/...   # optional: canonical URI of underlying asset
timestamp: 2026-07-04                    # ISO 8601, last substantive update
project: "03002"              # extension — 5-digit code, ALWAYS quoted
product: visionking           # extension — diemaster | spotfusion | visionking | sdk | general
language: pt-BR               # extension — pt-BR | en
status: active                # extension (specs/plans) — draft | active | superseded | done
---
```

Suggested `type` vocabulary (not enforced; unknown types always tolerated):
`Project Context`, `Technical Report`, `Meeting Notes`, `Decision`, `Lesson Learned`,
`Procedure`, `Design Spec`, `Implementation Plan`, `Concept`, `Reference`, `Deep-Dive`.

Conformance rule (OKF §9): every non-reserved `.md` file in a bundle has parseable
YAML frontmatter with non-empty `type`. During the ratchet, non-conformant legacy
files are reported by the linter, never rejected by consumers.

## 3. Indexes, logs, links

- **`index.md` per directory** (progressive disclosure): markdown link list, one line
  of description per entry. Descriptions are hand-curated; completeness (no missing
  or dead entries) is checked mechanically by `okf lint` and repaired by `okf index`.
  `knowledge-base/INDEX.md` is renamed to `index.md` (OKF reserved name; case matters).
- **`log.md`: not used.** Existing Keep-a-Changelog `CHANGELOG.md` conventions stay.
  OKF makes `log.md` optional; duplicating history would violate YAGNI.
- **Intra-bundle links:** bundle-absolute paths, per OKF recommendation:
  `[texto](/produtos/visionking/banco-de-dados.md)`.
- **Cross-bundle links:** the target's **GitHub URL** (e.g.
  `https://github.com/teruelskm/knowledge-base/blob/master/concepts/aquisicao-de-cameras.md`).
  Readable for humans on either repo; agents resolve to local paths via the catalog
  table. Memory-bundle content is never linked *to* from public bundles (local-only,
  may contain private context); memory files may link *out* to anything.
- **Broken links warn, never fail** (OKF permissive consumption).

## 4. Per-store adoption

### PMO (`pmo` bundle)

- `projects/<code>/knowledge/` — curated concept pages + `index.md`. Pages are
  authored **as needed** (no empty scaffolds). Typical pages: `contexto.md`
  (`type: Project Context`), `decisoes.md`, `licoes.md`, `relatorio-tecnico.md`.
- Raw material (emails/, meetings/, reference/, xlsx, CAD, drive-index) is untouched;
  knowledge pages point into it via `resource` frontmatter or body links.
- Bundle-level `pmo/index.md`: all projects with code, name, product, status.
- First migration example: `02008/.claude/context.md` content moves to
  `02008/knowledge/contexto.md` (with frontmatter). `.claude/context.md` remains as a
  thin pointer file so the current `/pmo` flow keeps working during transition.
- Pilot project: **03002** (richest folder, current operational focus).

### knowledge-base

- **Scripted frontmatter injection** across all 128 pages — the one bulk migration,
  justified because the format is uniform: `title` from H1, `timestamp` from the
  "Última atualização" blockquote, `type`/`product` from folder path,
  `language: pt-BR`. Blockquote metadata lines are kept in the body (harmless,
  human-friendly).
- `INDEX.md` → `index.md`; per-directory `index.md` files generated.
- New `concepts/` directory seeded with 3–5 pages drawn from real cross-project
  themes (câmeras, PLC, deflectometria, saúde de produção).
- KB `CHANGELOG.md` records the migration.

### engineering-docs (`docs/superpowers/`)

- **Ratchet only.** New specs/plans include frontmatter (`type: Design Spec` /
  `Implementation Plan`, `project`, `status`). Existing docs gain frontmatter when
  next touched.
- `specs/index.md` and `plans/index.md` generated initially by `okf index`,
  descriptions curated over time.
- This spec file itself is the first conformant example.

### memory

- New/updated memories add a top-level `type:` mirroring `metadata.type`
  (both kept — the harness memory format specifies `metadata.type`; OKF requires
  top-level `type`). No bulk rewrite.
- `MEMORY.md` remains the session-loaded index (OKF `index.md` is optional; a
  reserved-name index is not required for conformance).

## 5. Tooling — `okf` CLI

`scripts/okf/okf.py`, **Python stdlib only** (no venv, no dependencies — the
cole-medin `okf-cli.py` pattern). Frontmatter parsing uses a minimal built-in
YAML-subset parser (flat keys, strings, lists) — sufficient for the schema above.

| Command | Behavior |
|---|---|
| `okf lint [bundle]` | Frontmatter parses; `type` non-empty; index completeness; link check (warn-only). Outputs conformance % per bundle — **the ratchet metric**. Exit 0 unless invoked with `--strict`. |
| `okf search <terms> [--tag --type --project --product --bundle]` | Keyword search over frontmatter + body across all bundles listed in the catalog. |
| `okf index <dir>` | Regenerate an `index.md` listing: add missing entries, drop dead ones, **preserve hand-written descriptions**. |
| `okf catalog` | Print the bundle table from the root catalog. |

Bundle discovery: the CLI reads `knowledge/index.md` (catalog) — no hardcoded paths.

## 6. Consumer integration

- **`/pmo`**: reads `projects/<code>/knowledge/index.md` first; falls back to today's
  file probing for unmigrated projects.
- **`/jarvis`**: adds one line — the root catalog path.
- **KB chat bot**: frontmatter becomes chunk metadata; `concepts/` pages are prime
  retrieval targets. Rewiring the RAG indexer is a **follow-up task**, out of scope
  for this spec's implementation plan.
- **Dispatched agents**: workspace context generation includes the catalog pointer.
- **JARVIS CLAUDE.md**: short convention note — knowledge pages carry OKF
  frontmatter; new specs/plans/KB pages must conform.

## 7. Migration order & success criteria

Order of operations:

1. Convention doc (this spec) + root catalog + `okf` CLI.
2. KB scripted frontmatter injection + `index.md` rename + generated indexes
   (biggest cheap win).
3. 03002 pilot `knowledge/` layer.
4. Seed `concepts/` pages (3–5).
5. Ratchet everything else opportunistically; `okf lint` wired into
   `/system-cleanup` so conformance drift stays visible.

**Success criteria:**

- An agent answers a cross-project question (e.g. camera acquisition across VK
  projects) by walking catalog → concept → project pages, without grep.
- `/pmo 03002` loads the curated knowledge layer.
- `okf lint` conformance % trends upward release over release with no dedicated
  migration campaign.

## Out of scope

- Rewiring the KB chat bot RAG indexer (follow-up).
- Embeddings, databases, or any serving infrastructure (explicitly anti-goals of OKF).
- Bulk migration of PMO projects, existing specs, or memories.
- Renaming/moving raw PMO material.

## Testing

- CLI: unit tests for the frontmatter parser, lint rules, and index regeneration
  (description preservation is the critical regression case), plus a fixture bundle.
- KB injection script: dry-run mode with diff output; run against a fixture copy in
  tests; idempotency check (running twice changes nothing).
- Consumer changes (`/pmo` fallback) verified manually on one migrated (02008/03002)
  and one unmigrated project.
