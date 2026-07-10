---
type: Design Spec
title: OKF Cascade — Journal → Thematic Bundles Consolidation
description: Gated, watermark-driven consolidation of durable knowledge from episodic journal entries into the curated thematic bundles (project layers, KB concepts), with a gardener dispatch per topic.
tags: [jarvis, okf, journal, cascade]
timestamp: 2026-07-10
product: general
status: draft
language: en
---

# OKF Cascade — Journal → Thematic Bundles

**Date:** 2026-07-10
**Status:** Draft — awaiting review
**Builds on:** [2026-07-08-okf-specialists-design.md](2026-07-08-okf-specialists-design.md) (journal bundle, BOOT convention, roster) and [2026-07-04-okf-adoption-design.md](2026-07-04-okf-adoption-design.md) (bundles, `okf` CLI, frontmatter).

## Problem

The journal is **episodic** memory: time-ordered, immutable, ages gracefully.
Thematic bundles (PMO project `knowledge/` layers, KB concept pages,
engineering docs) are **semantic** memory: topic-organized, current-state,
curated. Specialists boot from the 2–3 most recent journal entries plus the
pages they link — so a durable fact that only lives in an entry older than
the boot window is effectively lost, and curated pages silently go stale as
work accumulates in the journal.

Cascade = a **consolidation process** that periodically distills what is
durable from recent entries and merges it into the thematic pages. Without
it the journal becomes a write-only diary; with it, boots stay shallow (few
entries needed) because the pages carry the accumulated state.

## Decision summary

- **Watermark per topic** in `journal/CASCADE.md` — "unabsorbed" is a pure
  filename comparison; journal entries are never edited (immutable episodes).
- **Gardener dispatch per topic**: reads unabsorbed entries + target pages,
  proposes merged edits. Specialists stay read-only; the gardener is a
  separate, write-capable dispatch.
- **Gate:** propose → owner reviews → apply. Same pattern as Drive
  governance. Never auto-apply a rewrite of a curated page.
- **Pendências never cascade** (volatile; they live in the journal and
  ClickUp). Decisions, architecture facts, gotchas, and topology do.
- **Plain-text provenance, no hyperlinks to the journal** from pmo / KB /
  engineering-docs ("Fonte: sessão sealer, 2026-07-08") — the journal is
  private to the JARVIS repo; same one-way rule as the memory bundle.
- **Manual-first cadence**: an in-session skill runs the loop; an optional
  cron only reports backlog, never writes.

## 1. State: `journal/CASCADE.md`

Type `Reference`, one table row per topic (seeded from the roster in
`journal/BOOT.md`; owner-editable):

```markdown
| Tópico | Alvos (páginas) | Última absorvida | Último run | Notas |
|--------|-----------------|------------------|------------|-------|
| sealer | workspaces/strokmatic/pmo/projects/03008/knowledge/index.md | 2026-07-08-sealer.md | 2026-07-12 | — |
| automacao | workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md | — | — | ainda sem run |
```

- **Alvos**: comma-separated repo-relative paths (from `~/JARVIS`) of the
  pages this topic consolidates into — seeded from each specialist's
  `--pages` starter hint; the gardener may propose adding a page to a
  layer, but adding a target row column entry is the owner's edit.
- **Última absorvida**: the exact FILENAME of the newest absorbed entry.
  An entry is unabsorbed iff its filename orders after the watermark under
  the canonical key `(base name, numeric suffix)` — plain lexicographic
  comparison is WRONG for same-day `-N` suffixes (`-` < `.`) and for
  `-10` vs `-2`; `cascade.py` implements this as `entry_key()`, used at
  every comparison site. `—` means never run: everything with the topic's
  tag is unabsorbed.
- Topic ↔ entry matching is by **tag** (first-class tags on the entry,
  same tags the boot searches), not by filename topic — one entry can feed
  several topics (e.g. a sealer entry tagged `automacao` feeds both).

## 2. Tool: `scripts/okf/cascade.py`

Stdlib only, flat module beside `okf.py`, tested in `scripts/okf/tests/`.

- `cascade.py status` — for each CASCADE.md row: count + list of unabsorbed
  entry filenames (tag match via frontmatter, date/name > watermark).
  Exit 0 always; `--quiet` prints only topics with backlog.
- `cascade.py briefing <topic>` — emits the gardener's input to stdout:
  the topic's target page paths, then the full text of each unabsorbed
  entry (newest last). No LLM logic; pure assembly.
- `cascade.py mark <topic> <entry-filename>` — advances the watermark and
  stamps "Último run" with the date passed via `--date YYYY-MM-DD`
  (explicit, keeps the tool deterministic). Refuses to move the watermark
  backwards.

## 3. The gardener flow (per topic, gated)

1. Controller runs `cascade.py briefing <topic>` → dispatches one gardener
   agent with: the briefing, the target pages' current content, and the
   triage rules below.
2. Gardener produces **proposed page edits** (edits the target pages in the
   working tree, uncommitted — or a diff report when the owner prefers to
   read first; both satisfy the gate).
3. Triage rules (what goes where):

| From the journal | Cascades to | Never |
|---|---|---|
| Decisions + rationale | project layer decision/architecture page | — |
| Architecture/topology/config facts | project layer reference page | — |
| Cross-project gotchas & lessons | KB concept page | — |
| Status, pendências, next steps | — | never (volatile) |
| Personal-topic content (`pessoal` tags) | — | never (journal-only by design) |

4. Owner reviews → apply: commit in the TARGET repo per its conventions
   (PMO: rebase before push, update the `overview.md` "Histórico de
   Mudanças" when a page under a project changes; KB: `okf index` the
   touched dir; never `git add -A`).
5. `cascade.py mark <topic> <newest-entry> --date <today>` + commit
   CASCADE.md in JARVIS.

Provenance format inside cascaded content: `(Fonte: sessão <name>,
YYYY-MM-DD)` — plain text, no link.

## 4. Entry points & cadence

- **Skill `/okf-cascade [topic]`**: no arg → show `status` and let the
  owner pick; with arg → run the §3 loop in-session (the owner IS the
  gate). Generated by hand (one skill, not per-topic).
- **Optional cron (report-only)**: weekly `cascade.py status --quiet`
  piped to the existing notifier when a topic has ≥3 unabsorbed entries
  or its oldest unabsorbed entry is >14 days old. Never writes; never
  dispatches. Deferred until the manual loop has run a few times.
- Specialists' encerramento text is unchanged — writing the journal entry
  remains the only session-end duty; cascade is a separate, batched act.

## 5. Rollout

1. `cascade.py` + tests; seed `journal/CASCADE.md` from the roster with
   targets from the 21 wrappers' `--pages` hints (topics without a starter
   page get `—` targets and are skipped by `status` with a note).
2. Pilot: `sealer` (densest topic — back-fill + live entries) through the
   full gated loop; measure that the 03008 layer absorbs the decisions and
   that the entry count needed at boot stays at 2–3.
3. Second pass: one field topic (`automacao`) to validate the KB-concept
   path and multi-topic entries (tag-based matching).
4. Remaining topics: on demand via `/okf-cascade`, nudged by `status`.

## Out of scope

- Auto-apply without the owner gate (revisit only after several clean runs).
- Editing or annotating journal entries (immutability; absorption state
  lives only in CASCADE.md).
- Embeddings/semantic matching — tag discipline is the router.
- Back-propagation (bundle → journal) and journal compaction/archiving.
- Granting write tools to the 21 specialists.

## Testing

- `cascade.py` unit tests (fixture journal + CASCADE.md): unabsorbed
  detection incl. same-day `-2` suffix ordering and `—` (never-run) rows;
  tag-based multi-topic matching; `mark` refuses backward moves; briefing
  contains entries newest-last.
- Pilot acceptance (§5.2): owner-approved diff lands in the 03008 layer,
  `okf lint pmo --strict` stays clean, watermark advanced, provenance
  present, zero hyperlinks to `journal/` in the changed pages.
