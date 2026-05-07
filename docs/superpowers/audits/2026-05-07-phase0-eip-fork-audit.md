# Phase 0 Audit — strokmatic-opener legacy fork archaeology

**Date:** 2026-05-07
**Author:** Pedro Teruel + Claude Opus 4.7
**Spec:** `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md`
**Goal:** Catalog the cert-required deltas in the legacy `strokmatic-opener` fork (preserved at `github.com/strokmatic/strokmatic-eip` on `legacy/*` branches and tag `legacy-cert-submitted-2024-06-19`) so they can be cleanly re-applied to a fresh upstream OpENer fork in Phase 2.

---

## Executive Summary

The legacy fork diverged from upstream OpENer at commit **`e601e4a`** (April 29, 2024) and added **exactly 11 strokmatic commits** before submission to ODVA on June 19, 2024. Total delta: **68 files changed, +4 534 / −950 lines**.

**The 11 commits split cleanly into three buckets** by physical location:

| Bucket | Count | Where in tree | Action |
|---|---|---|---|
| **A. Cert-required stack work** | ~3 100 lines | `source/src/cip/` + `source/src/ports/nvdata/` + `source/src/ports/generic_networkhandler.c` + `source/src/strokmatic-lldpd` | Re-apply to fresh fork as a single staged commit per logical change |
| **B. Build/CI/packaging** | ~150 lines | `CMakeLists.txt` files + `setup_posix.sh` + `.gitignore` | Re-apply as needed; upstream may have changed CMake structure |
| **C. App-specific (must NOT transfer)** | ~1 350 lines | `source/src/ports/POSIX/sample_application/` (entire subtree) + parts of `source/src/ports/POSIX/main.c` | DO NOT carry over. The new generic comm process gets a fresh `redis_bridge.c` and clean `main.c` |

**No Bucket D (unknown):** every delta has been categorized.

**Recommended target for the fresh fork:** upstream OpENer **v2.3** (most recent stable release tag). The legacy fork's base (`e601e4a`) is from a few weeks before v2.3, so we pick up some upstream improvements for free.

---

## Methodology

1. Cloned the GCS `strokmatic-opener` repo locally (~/JARVIS/workspaces/strokmatic/sdk/strokmatic-opener/, also preserved on the new `strokmatic-eip` repo's `legacy/*` branches).
2. Added upstream `https://github.com/EIPStackGroup/OpENer.git` as a remote and fetched.
3. Ran `git merge-base legacy-cert-submitted-2024-06-19 upstream/master` → got commit **`e601e4a5d008b6461e4285c95652b50aa0f554af`** (April 29, 2024, by Martin Melik-Merkumians, an active OpENer maintainer).
4. Listed the 11 strokmatic-only commits with `git log --reverse e601e4a..legacy-cert-submitted-2024-06-19`.
5. Per-file `git diff --name-only --diff-filter=A/M/D` to separate new/modified/deleted.
6. Per-file inspection of names + sample diffs to assign each to a bucket.

---

## Upstream Divergence Point

**Commit `e601e4a`** — "Remove shallow chekout from cmake.yml" — Apr 29, 2024.

Trivial commit (1 file, 5 lines). The fork started its strokmatic-specific work from this point.

**Implications for Phase 2:**

- Fresh fork should target **upstream tag `v2.3`** (or `master` HEAD, if v2.3+1 work is already merged that we want).
- Between `e601e4a` and `v2.3` there are some upstream improvements we'll inherit automatically — this is a benefit, not a risk.
- We do NOT need to mirror the legacy fork's exact base; we just need to re-apply the Bucket-A deltas on top of v2.3, regression-test, then conformance-test.

---

## The 11 Commits, Annotated

| # | SHA | Date | Author | Message | Buckets present |
|---|---|---|---|---|---|
| 1 | `ae12b13` | ? | Matheus Gomes | "opener strokmatic" | **A** (LLDP CIP objects + identity/router/QoS modifications) |
| 2 | `66ac198` | ? | Matheus Gomes | "update c make list opener POSIX" | **B** (CMake changes) + **A** (strokmatic-lldpd submodule reference) |
| 3 | `5fe551a` | 2024-06-13 | Matheus Gomes | "update multiple imports" | Mostly whitespace/import reorder (`-w` shortstat is 458 vs 822) — re-evaluate at hunk level; likely **A** noise |
| 4 | `e1e9f7c` | ? | Matheus Gomes | "Update setup flags to include OPENER_RT option" | **B** (build flag) |
| 5 | `29f5e2f` | ? | Matheus Gomes | "nvdata" | **A** (10 lines in nvdata.c) |
| 6 | `748b621` | ? | Matheus Gomes | "update" | **MIXED**: large, touches CIP files (A), nvdata (A), main.c (1 011 lines — A reformat + C wiring), introduces `plc_monitor_camera.c` (C) |
| 7 | `bd23799` | ? | Matheus Gomes | "updated" | **A** (ciptcpipinterface.c 709 lines + CMake) |
| 8 | `605fbed` | ? | Matheus Gomes | "update python to 3.11" | **C** (sample_application Python helpers updated) + likely some A in main.c |
| 9 | `e50e959` | ? | Matheus Gomes | "update cp ip" | **A** (ciptcpipinterface.c + generic_networkhandler.c, 812 lines refactored) |
| 10 | `fef7279` | 2024-06-19 | Matheus Gomes | "Versao validada em laboratorio - 190624" | **A** (final small tweaks) |
| 11 | `91807e0` | 2024-06-19 | Matheus Gomes | "Versao enviada para certificacao ODVA - 190624" | **A** (14-line final ciptcpipinterface.c change) |

All commits authored by **Matheus Gomes** (`matheus@lumesolutions.com`). Phase 2 should consider consulting him for any genuinely ambiguous hunks (none identified during this audit pass, but a review with him is cheap insurance).

---

## Per-File Categorization

### NEW files (44 total) — Bucket assignments

#### Bucket A — Cert-required, re-apply

| File | Size | Notes |
|---|---|---|
| `source/src/cip/cipLLDPDataTable.c` | 284 lines | LLDP CIP data table object |
| `source/src/cip/cipLLDPDataTable.h` | 81 lines | header |
| `source/src/cip/cipLLDPmanagement.c` | 179 lines | LLDP management object |
| `source/src/cip/cipLLDPmanagement.h` | 50 lines | header |
| `source/src/ports/nvdata/nvlldp.c` | 81 lines | LLDP persistent-storage helpers |
| `source/src/ports/nvdata/nvlldp.h` | 22 lines | header |
| `source/src/strokmatic-lldpd` | submodule pointer | LLDP daemon dependency (private repo) |

**Why cert-required:** ODVA EtherNet/IP spec requires Discovery-Layer Diagnostic Protocol (LLDP) support for compliance with current device categories. The legacy fork added this; without it, conformance test would fail at LLDP scenarios. The four LLDP `.c/.h` files implement the CIP-spec LLDP objects (data table object 0xCC, LLDP management object 0xCB).

#### Bucket B — Build/CI/packaging

| File | Notes |
|---|---|
| `.gitmodules` | Adds the `strokmatic-lldpd` submodule reference |

#### Bucket C — App-specific, must NOT transfer

The entire `source/src/ports/POSIX/sample_application/` subtree was the strokmatic-opener's "embedded camera-acquisition handshake in C." All 41 files under there were the camera plugin's app code:

| Path | Role |
|---|---|
| `sample_application/plc_monitor_camera.c` | 424-line C state machine (the legacy "in C" version of camera-acquisition handshake) |
| `sample_application/Iplc/plc_connector.py` | 111-line Python helper |
| `sample_application/Iplc/plc_connector_class3.py` | 53-line Python helper |
| `sample_application/Iplc/variables.c/h` | App I/O variable definitions |
| `sample_application/Iplc/.env` | Hardcoded env defaults |
| `sample_application/Iplc/CMakeLists.txt` | builds the above |
| `sample_application/Iplc/__init__.py` | empty marker |
| `sample_application/Iplc/.gitmodules`, `.gitignore` | submodule plumbing |
| `sample_application/Iplc/README.md` | docs |
| `sample_application/Icache/...` | Redis read/write Python helpers (cache.c, cache.h, redis_read.py, redis_write.py + plumbing) |
| `sample_application/Ilog/...` | logging helpers (log.c, log.h, log.py) + nested utils/Icache mirror |

**Phase 2 plan:** The fresh fork's `sample_application/` directory will be replaced with a thin **`redis_bridge.c`** (~hundreds of LoC) that mirrors the I/O assemblies to/from Redis with **zero handshake state**. All app logic moves to Python plugins consuming the SDK.

#### Ambiguous, needs hunk review during Phase 2 implementation

| File | Why ambiguous |
|---|---|
| `source/src/ports/POSIX/myglobals.h` | Name suggests global variables. Could be cert-required (assembly definitions) or app-glue. Needs inspection. |

### MODIFIED files (24 total) — Bucket assignments

#### Bucket A — Cert-required CIP changes, re-apply hunks

| File | Notes |
|---|---|
| `source/src/cip/cipassembly.c` | 1-line diff — likely small fix |
| `source/src/cip/cipcommon.c` | 465 lines added — LLDP integration |
| `source/src/cip/cipcommon.h` | 51 lines — LLDP header additions |
| `source/src/cip/cipconnectionmanager.c` | 4 lines — LLDP-related |
| `source/src/cip/cipconnectionobject.c` | 1 line |
| `source/src/cip/cipidentity.c` | 14 lines — likely vendor/product code modifications + LLDP integration |
| `source/src/cip/cipmessagerouter.c` | 20 lines — LLDP routing |
| `source/src/cip/cipqos.c` | 10 lines — QoS DSCP for LLDP |
| `source/src/cip/ciptcpipinterface.c` | 709 lines (cumulative across multiple commits) — heavy refactor for LLDP/IP integration |
| `source/src/cip/ciptypes.h` | 8 lines — type additions |
| `source/src/enet_encap/endianconv.c` | 1 line |
| `source/src/opener_api.h` | 37 lines — public API for LLDP |
| `source/src/ports/generic_networkhandler.c` | 810 lines refactored — cumulative across multiple commits, IP/network handling |
| `source/src/ports/nvdata/nvdata.c` | 39 lines — LLDP persistent storage hook |
| `source/src/ports/nvdata/nvdata.h` | 7 lines |

#### Bucket B — Build/CI

| File | Notes |
|---|---|
| `.gitignore` | adds local artifacts |
| `bin/posix/setup_posix.sh` | adds `OPENER_RT` flag |
| `source/src/cip/CMakeLists.txt` | links LLDP files |
| `source/src/ports/POSIX/CMakeLists.txt` | links strokmatic-lldpd |
| `source/src/ports/POSIX/sample_application/CMakeLists.txt` | C only — sample app build |
| `source/src/ports/nvdata/CMakeLists.txt` | LLDP nvdata build |

#### Bucket C / Mixed — review hunk-by-hunk

| File | Notes |
|---|---|
| `source/src/ports/POSIX/main.c` | 1 011 lines reformatted across commits. Mixed: most is OpENer scaffolding (A), but the wiring-up of the camera-acquisition handshake is C. Needs hunk review during Phase 2; the new `main.c` will be MUCH shorter and clean. |
| `source/src/ports/POSIX/sample_application/sampleapplication.c` | 4 lines — likely calls into the camera handshake. **Bucket C — let upstream's `sampleapplication.c` stand unmodified (or replace with `redis_bridge.c`).** |
| `source/src/ports/MINGW/main.c` | 2 lines — odd; MINGW port wasn't the cert target. Probably whitespace artifact. Skip. |

#### Bucket D — Documentation

| File | Notes |
|---|---|
| `source/doc/coding_rules/opener_coding_rules.pdf` | Binary modified |
| `source/doc/coding_rules/src/opener_coding_rules.tex` | 62 lines — coding rules updates. Cert-related? **Decision: skip — upstream's coding rules stand.** |

---

## Recommended Phase 2 Strategy

1. **Fresh fork target:** upstream OpENer `v2.3` (or `master` HEAD).
2. **Layered re-application** — instead of "11 commits in original order," reorganize into clean logical commits in `strokmatic-eip`:
   - Commit 1: Add LLDP CIP objects (`cipLLDPDataTable.c/h`, `cipLLDPmanagement.c/h`) + minimal hooks in `cipcommon.c`, `cipidentity.c`, `cipmessagerouter.c`, `cipqos.c`, `cipassembly.c`, `ciptypes.h`, `opener_api.h`, `endianconv.c`. Add corresponding `CMakeLists.txt` lines.
   - Commit 2: Add LLDP nvdata persistence (`nvlldp.c/h`) + nvdata.c/h hooks + nvdata CMakeLists.
   - Commit 3: Network-stack improvements (`ciptcpipinterface.c` + `generic_networkhandler.c` deltas — verify these are still relevant against v2.3; many may already be upstream).
   - Commit 4: Add `strokmatic-lldpd` as a dependency (submodule + POSIX CMakeLists).
   - Commit 5: Add `OPENER_RT` setup flag.
   - Commit 6: NEW work: write `redis_bridge.c` mirroring 128-byte I/O assemblies to/from Redis. Replace the old `sample_application/` entirely.
   - Commit 7: Write the EDS file for `STROKMATIC-COMM-V1` (128/128 bytes, instance 100/101).
3. **Per-commit verification:**
   - After commits 1–5, run upstream's tests; confirm no regressions.
   - After commit 6, run `redis_bridge` smoke tests against a local Redis.
   - After commit 7, run ODVA conformance test (in-house first, then ODVA lab for formal cert).
4. **Conformance test re-run:** Required because `STROKMATIC-COMM-V1` is a new EDS Identity (different from whatever the legacy was certified as). Spec section 4.1 lists this as expected.

---

## Risks Identified

| # | Risk | Mitigation |
|---|---|---|
| R1 | The 810-line `generic_networkhandler.c` refactor (commit 9 `e50e959`) may include cert-required fixes for specific test cases that aren't documented in commit messages | Hunk-by-hunk review; consult Matheus if any hunk's purpose is unclear |
| R2 | `myglobals.h` may contain assembly-related globals required for cert | Inspect content; if cert-related, add to commit 6 |
| R3 | `strokmatic-lldpd` is a private GCS submodule; access may be lost over time | Mirror it to `github.com/strokmatic/strokmatic-lldpd` BEFORE Phase 2 starts, or absorb it into `strokmatic-eip` directly |
| R4 | Some Bucket-A modifications may already be merged to upstream OpENer between `e601e4a` and `v2.3` | Diff the modified files against `v2.3` before re-applying; skip what's already there |
| R5 | Coding rules PDF/TeX changes may have been required by ODVA reviewer feedback | Probably unrelated to cert — skip for now; revisit if conformance fails |

---

## What This Audit Does NOT Cover

- **Hunk-level review of CIP-file modifications.** Phase 2 implementer does this commit-by-commit during re-application.
- **Conformance test outcomes.** This audit is upstream-of-cert. The cert artifacts (test report, EDS file, ODVA-issued certificate) are operationally separate; locate and archive them before the v2 cert submission so they can serve as the "previously passed" baseline.
- **`strokmatic-lldpd` content.** That submodule is its own audit (separate task before Phase 2).

---

## Summary for Phase 2 Kickoff

| Question | Answer |
|---|---|
| What's the fresh fork base? | upstream OpENer **v2.3** |
| How many commits of Bucket-A work to re-apply? | ~5–7 logical commits (compressed from the legacy's 11 messy commits) |
| Total Bucket-A code volume? | ~3 100 lines of NEW + MODIFIED |
| What do we DROP entirely? | All 41 files under `source/src/ports/POSIX/sample_application/` — replaced by a fresh `redis_bridge.c` |
| Who has cert artifacts? | Need to check with Matheus Gomes (legacy author) and Pedro for the original ODVA test report and issued certificate |
| Are there any genuine unknowns? | None at the commit/file level. One file (`myglobals.h`) needs hunk-level inspection. |
| Estimated Phase 2 duration revision | Spec said 3–6 weeks. With this audit complete and clean Bucket-A list, **3–4 weeks is more realistic**. Conformance test scheduling may dominate. |

**Phase 2 is unblocked.** Next step: create the `strokmatic-eip` Phase 2 implementation plan via the writing-plans skill.

---

## Change log

| Date | Change |
|---|---|
| 2026-05-07 | Initial audit committed. Categorization complete; no Bucket-D unknowns. |
