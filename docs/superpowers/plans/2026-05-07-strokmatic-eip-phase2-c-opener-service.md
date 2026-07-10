---
type: Implementation Plan
title: strokmatic-eip Phase 2 — Generic Certified C OpENer Service Implementation Plan
description: This plan covers Phase 2 only. Phase 0 (archaeology) is complete. Phases 3 (lab integration with full stack) and 4 (customer cutover) are separate plans.
timestamp: 2026-05-07
---

# strokmatic-eip Phase 2 — Generic Certified C OpENer Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the certified C-side comm-layer process for `strokmatic-eip`. Fresh fork of upstream OpENer at `e601e4a` (April 2024 — the legacy fork's merge-base; `v2.3` was attempted first but failed to build on modern GCC, see Revision section below), re-apply the Bucket-A cert-required deltas catalogued in the Phase 0 audit, add a new `redis_bridge.c` that mirrors a 128-byte I/O assembly to/from Redis with zero application logic, write an EDS for `STROKMATIC-COMM-V1`, and prepare for ODVA conformance test (CT) submission.

**Architecture:** OpENer C process running as the EtherNet/IP Class 1 adapter (the device, not the scanner). On every PLC scan cycle, mirror the input assembly bytes to `io:in:<plc_key>` Redis key, and read `io:out:<plc_key>` to populate the output assembly bytes. Fixed 128-byte assemblies. The first 16 bytes of each assembly form a "header lane" — comm-layer-owned heartbeat counter, status flags, and EDS identity hash. Plugins live in separate Python repos and consume Redis via `strokmatic-comm-sdk`; this layer is plugin-agnostic.

**Tech Stack:** C99, OpENer EIPStack (upstream pinned at `e601e4a`, April 2024), CMake, Linux POSIX (the cert target), `lldpd` (via `strokmatic-lldpd` submodule), `hiredis` (Redis C client), Docker for build & deployment, ODVA Conformance Test tool for verification.

**Spec:** `docs/superpowers/specs/2026-05-07-strokmatic-eip-generic-communicator-design.md`
**Phase 0 audit:** `docs/superpowers/audits/2026-05-07-phase0-eip-fork-audit.md`
**Cert artifacts (Drive folder):** https://drive.google.com/drive/u/0/folders/1Bnjg_QsZKAKum84sX9xJc05PaEVh-KkC

This plan covers Phase 2 only. Phase 0 (archaeology) is complete. Phases 3 (lab integration with full stack) and 4 (customer cutover) are separate plans.

---

## ⚠️ Revision 2026-05-07 — Plan partially executed; halted for revision

Phase 2 execution started 2026-05-07 and produced commits up through `3ce3087` (Tasks 0–3 complete). Halted at Task 4 because the build broke in ways the plan had not anticipated:

| Issue surfaced during execution | Plan gap |
|---|---|
| **Upstream OpENer v2.3 doesn't build on modern GCC** (10+ default `-fno-common`) — link-time multiple-definition errors on `g_current_active_tcp_socket`, `g_time_value`, `g_ethernet_link`, etc., declared without `extern` in headers | Phase 0 audit and Task 1 chose v2.3 as the fresh-fork base WITHOUT smoke-building it on the dev environment. v2.3 (March 2019) predates GCC 10's default change. **New target: `e601e4a`** (April 2024, the legacy fork's merge-base). |
| **LLDP CIP files include `json-c`, `lldpctl`, `lldpd-structs.h`** with build-wiring needed in top-level POSIX `CMakeLists.txt` (~50 lines: `find_library(LLDPCTL_LIBRARY)`, `find_path(LLDPCTL_INCLUDE_DIR)`, compat-dir include, json-c discovery, feature-test macros for `IFNAMSIZ`/`ETHER_ADDR_LEN`) | Original Task 7 ("build flags") compressed all this into ~10 lines. **Task 7 is replaced by Task 7-new which catalogues every legacy POSIX CMakeLists hunk.** |
| **Legacy POSIX CMakeLists has `find_package(PythonLibs)` + `target_link_libraries(OpENer ${PYTHON_LIBRARIES})`** — the legacy C process embedded Python | Spec says "C contains zero application logic"; legacy violated this. Phase 2 design decision: drop Python embedding entirely. Validate that no Bucket-A C code actually calls into Python (likely the embedding was for the `sample_application/Iplc/*.py` helpers we're removing in Task 8). |

### Revision actions taken in the plan

- Added Task 0.5 (smoke-build the upstream base before declaring it the target).
- Task 1 now vendors **`e601e4a`** instead of `v2.3` (force-push master).
- Task 7 expanded to fully catalog legacy POSIX CMakeLists deltas (json-c, lldpctl, compat-dir, feature-test macros).
- Task 8 ("Remove sample_application") now also verifies no remaining Python references in CMakeLists / source after removal.
- Task 9 (redis_bridge.c) explicitly states: NO Python embedding, NO Python helpers.

### What execution produced before halting

| Phase 2 Task | Status | Commit on `master` of `strokmatic/strokmatic-eip` | Notes |
|---|---|---|---|
| P2.0 — cert/README.md identity decisions | ✅ done | `f66adda` | Solid; no revision needed. |
| P2.1 — vendor upstream OpENer v2.3 | ⚠️ **needs redo with `e601e4a`** | `fccd7db` (tagged `upstream-v2.3-import`) | Master will be force-pushed when Task 1 reruns with the new base. Tag is preserved for archaeology. |
| P2.2 — strokmatic-lldpd submodule | ✅ done | `ef975b6` | Submodule pin and `.gitmodules` are base-independent; survives the v2.3→e601e4a re-vendor. |
| P2.3 — LLDP CIP source files | ✅ done | `3ce3087` | Files are legacy/strokmatic-only; survive the re-vendor. CMakeLists.txt edit may need rework after Task 7-new lands the build wiring. |

`master` is in a known-broken state (build fails). When execution resumes, the operator decides:
- **(a) Hard reset master to `f66adda` (cert/README.md only) and re-execute Tasks 1–3 cleanly with `e601e4a`** — cleanest history, ~10 min replay cost.
- **(b) Add a fix-up commit on top of `3ce3087` that swaps the v2.3 import for `e601e4a`** — preserves the linear history we already have, but the diff is enormous (effectively re-vendoring).

Recommend (a) for clean cert-evidence story.

---

---

## Scope

**IN:**
- `strokmatic/strokmatic-eip` repo populated on `master` with: upstream OpENer `e601e4a` base, Bucket-A cert-required changes re-applied as logical commits, `strokmatic-lldpd` as submodule, new `redis_bridge.c`, new clean `main.c`, EDS file for `STROKMATIC-COMM-V1`, Dockerfile, GitHub Actions CI for build smoke-test
- In-house conformance test against the ODVA CT tool, with results that improve on the CT20 baseline (the April 2024 internal run had 48 errors → must drop to 0 errors before ODVA submission)
- Documentation (README + CERTIFICATION.md) in the repo

**OUT (deferred to Phase 3 and beyond):**
- Real PLC integration testing on a lab cell (Phase 3 — needs Phase 1 plugin too)
- ODVA lab cert submission (paid + scheduled separately)
- VK / DM product variants (only after SpotFusion uses the new comm layer)
- Operations runbook for deployment

---

## Cert Context (from CT20 Apr 2024 internal run)

Critical input from `Summary_report_CT20.txt` in the cert artifacts folder:

| Field | Legacy (cert'd June 2024) value | New `STROKMATIC-COMM-V1` plan |
|---|---|---|
| Vendor ID | `9876` (Strokmatic's ODVA-issued ID) | **same — `9876`** (vendor doesn't change) |
| Device Type | `0x002b` (Generic Device) | **same — `0x002b`** |
| Product Code | `0x0018` | **NEW — TBD via ODVA assignment** (see Task 0 below) |
| Serial Number | `0x00006688` | **same OR auto-derived from MAC** (decide in Task 0) |
| Major / Minor Revision | TBD from cert artifacts | **start at 1.0** |
| Input Assembly | TBD from legacy EDS | **instance 100, 128 bytes** |
| Output Assembly | TBD from legacy EDS | **instance 101, 128 bytes** |
| LLDP CIP support | Required (Object 0xCB Mgmt + 0xCC Data Table) | **required, port from legacy** |
| LLDP Identification TLV | "required from November 2024" — was warning in CT20 | **must support** (cert ran Apr 2024 before TLV was mandatory; new submission will be after Nov 2024) |

**Specific CT20 errors to AVOID in v2:**
- `Attribute data value incorrect attr 2` on Ethernet Link Object instances
- `Attribute size in bytes invalid attr 6` on Ethernet Link Object instances
- `STC Error: Unexpected fail to the implemented service` (multiple instances)
- `Error Response is unexpected, Srv Code x11` (some marked `[RESOLVIDO]` in legacy notes — verify the fix carries over)
- `Newly added LLDP instances are not removed after a Reset/Power cycle`

These failure modes will be the regression-test backstop during in-house CT runs.

---

## File Structure

Working tree: `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip/` (local clone of `github.com/strokmatic/strokmatic-eip`).

After Phase 2, repo layout:

```
strokmatic-eip/
├── .git/                                # already exists; legacy/* branches preserved
├── .gitmodules                          # NEW — references strokmatic-lldpd
├── .github/workflows/build.yml          # NEW — CI smoke test
├── README.md                            # already exists from scaffold; updated
├── CERTIFICATION.md                     # NEW — recert trigger documentation
├── deps/
│   └── strokmatic-lldpd/                # NEW git submodule → github.com/strokmatic/strokmatic-lldpd
├── source/                              # vendored from upstream OpENer e601e4a
│   ├── src/
│   │   ├── cip/
│   │   │   ├── cipLLDPDataTable.{c,h}   # NEW (re-applied from legacy Bucket A)
│   │   │   ├── cipLLDPmanagement.{c,h}  # NEW (re-applied)
│   │   │   ├── cipassembly.c            # MODIFIED (LLDP hooks)
│   │   │   ├── cipcommon.{c,h}          # MODIFIED (LLDP hooks)
│   │   │   ├── cipidentity.c            # MODIFIED (Vendor/Product/Type updates)
│   │   │   ├── cipmessagerouter.c       # MODIFIED (LLDP routing)
│   │   │   ├── cipqos.c                 # MODIFIED (LLDP QoS)
│   │   │   ├── ciptcpipinterface.c      # MODIFIED (network stack improvements)
│   │   │   ├── ciptypes.h               # MODIFIED (LLDP types)
│   │   │   ├── CMakeLists.txt           # MODIFIED (link new files)
│   │   │   └── ...                      # other upstream files unchanged
│   │   ├── enet_encap/
│   │   │   └── endianconv.c             # MODIFIED (small fix)
│   │   ├── opener_api.h                 # MODIFIED (LLDP API)
│   │   ├── ports/
│   │   │   ├── POSIX/
│   │   │   │   ├── main.c               # NEW — clean replacement (no app logic)
│   │   │   │   ├── redis_bridge.{c,h}   # NEW — the Redis I/O mirror
│   │   │   │   ├── CMakeLists.txt       # MODIFIED (links lldpd, hiredis, redis_bridge)
│   │   │   │   └── sample_application/  # REMOVED entirely (the legacy camera handshake)
│   │   │   ├── nvdata/
│   │   │   │   ├── nvlldp.{c,h}         # NEW (re-applied from legacy)
│   │   │   │   ├── nvdata.{c,h}         # MODIFIED (LLDP storage hook)
│   │   │   │   └── CMakeLists.txt       # MODIFIED
│   │   │   └── generic_networkhandler.c # MODIFIED (network handler improvements)
│   ├── CMakeLists.txt                   # upstream
│   └── doc/                             # upstream
├── eds/
│   └── STROKMATIC-COMM-V1.eds           # NEW
├── cert/
│   ├── EDS_REVISION                     # NEW — single source of truth for revision
│   └── README.md                        # NEW — pointer to Drive cert folder
├── Dockerfile                           # NEW
└── docker-compose.yml                   # NEW
```

---

## Tasks

### Task 0: Pre-flight — confirm Identity values + ODVA Product Code assignment

**Files:** none (decision artifact: a markdown note in the repo)

This is a process task, not code. It produces decisions that downstream tasks depend on.

- [ ] **Step 1: Locate legacy EDS file**

The legacy `2024-2_EtherNetIP_REVIEW_COPY.zip` in the Drive cert folder contains the submitted cert package. Download and extract:

```bash
mkdir -p /tmp/legacy-cert-package
cd /tmp/legacy-cert-package
# Download via gh-drive script or browser (zip is 27MB)
# Extract; locate the .eds file
```

Inspect the EDS to confirm: Vendor ID, Device Type, Product Code, assembly instance numbers and sizes, identity attribute values.

- [ ] **Step 2: Decide the new Product Code**

Two options, choose one:
- **(a)** Reuse Product Code `0x0018` (the legacy value). Pros: no new ODVA application. Cons: the certified device family stays one product; `STROKMATIC-COMM-V1` would technically be a major revision of the same product.
- **(b)** Apply for a new Product Code via ODVA (form on https://www.odva.org/). Pros: clean separation between legacy strokmatic-opener and new strokmatic-eip; can co-exist in the field. Cons: takes 1–4 weeks; admin overhead.

**Recommended:** **(b) new Product Code.** The strokmatic-eip is architecturally a different product (no app logic baked in; pluggable). Co-existence with legacy in the field is a real Phase 4 requirement during cutover. The 1–4 week ODVA turnaround can run in parallel with all subsequent tasks; only the final EDS write needs the assigned code.

- [ ] **Step 3: Document decisions**

Create `cert/README.md`:

```markdown
# Certification Tracking

## Cert artifacts

The original cert evidence (CT20 reports, EDS, ODVA membership, deviations) lives in the
Drive folder: https://drive.google.com/drive/u/0/folders/1Bnjg_QsZKAKum84sX9xJc05PaEVh-KkC

## Identity values

| Field | Value | Source |
|---|---|---|
| Vendor ID | 9876 | Strokmatic's ODVA-issued vendor ID |
| Device Type | 0x002B | Generic Device per CIP Vol 1 |
| Product Code | TBD (applied 2026-MM-DD, assigned 2026-MM-DD) | New ODVA application for STROKMATIC-COMM-V1 |
| Serial Number | derived from primary MAC at boot | `mac[3..5]` packed as uint32 |
| Revision (Major.Minor) | 1.0 | Initial release of strokmatic-eip |
| EDS Identity Hash | computed by build, stored in cert/EDS_REVISION | See Task 7 |

## Recert triggers

See CERTIFICATION.md.
```

- [ ] **Step 4: Submit the ODVA Product Code application (if option b chosen)**

This is operational work outside the agent's scope. Track the ticket; downstream tasks proceed without it (Task 7 EDS write is the only blocker).

- [ ] **Step 5: Commit the decisions**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
mkdir -p cert
# write cert/README.md with the content above
git add cert/README.md
git commit -m "docs(cert): document identity decisions for STROKMATIC-COMM-V1"
```

---

### Task 0.5 (NEW 2026-05-07): Smoke-build the upstream base BEFORE vendoring

Don't trust assumed-stable tags. Verify the chosen upstream commit builds on the dev environment with no strokmatic deltas before declaring it the fork target.

**Files:** none (verification only)

- [ ] **Step 1: Clone upstream OpENer to a scratch dir**

```bash
mkdir -p /tmp/eip-base-smoke
cd /tmp/eip-base-smoke
git clone https://github.com/EIPStackGroup/OpENer.git base
cd base
git checkout e601e4a   # legacy's merge-base; April 2024
```

- [ ] **Step 2: Attempt a clean build**

```bash
mkdir build && cd build
cmake -DCMAKE_C_COMPILER=gcc -DOpENer_PLATFORM:STRING="POSIX" -DCMAKE_BUILD_TYPE:STRING="Debug" -DBUILD_SHARED_LIBS:BOOL=OFF ../source
make -j 2>&1 | tee build.log
ls src/ports/POSIX/OpENer  # confirms binary exists
```

- [ ] **Step 3: Decide**

- If build succeeds → `e601e4a` is the new fork target. Proceed to Task 1.
- If build fails → check error class. If `-fno-common` errors, try adding `-DCMAKE_C_FLAGS=-fcommon`. If that succeeds, document the workaround. If not, try a newer commit (`upstream/master` HEAD, or commits between `e601e4a` and master that fix the issue).
- Record the chosen base SHA + any compile flags needed → write to `cert/UPSTREAM_BASE.md` (commit in Task 1).

This task SHOULD have happened in Phase 0 audit. Documenting here so it isn't skipped on the next re-plan.

---

### Task 1: Vendor upstream OpENer `e601e4a` onto master (REVISED — was v2.3)

**Files:**
- Modify: working tree of `master` (will become a copy of upstream at the chosen base SHA)
- Create: `source/` directory tree from upstream
- Create: `cert/UPSTREAM_BASE.md` documenting the chosen base + any required compile flags

- [ ] **Step 1: Hard reset master to the cert/README.md commit**

If executing for the first time:

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git fetch origin
git checkout master
```

If recovering from the v2.3-vendor mis-execution (commits `fccd7db` onward), reset:

```bash
git reset --hard f66adda   # cert/README.md is the last "clean" master commit
```

**WARNING — destructive.** Confirm with user before resetting if any work-in-progress commits exist on top of `3ce3087`.

- [ ] **Step 2: Add upstream OpENer as a remote (idempotent)**

```bash
git remote add upstream https://github.com/EIPStackGroup/OpENer.git 2>&1 || echo "(already added)"
git fetch upstream --tags
git fetch upstream master:refs/remotes/upstream/master
```

Confirm `e601e4a` is reachable:

```bash
git show e601e4a --stat | head -3
```

- [ ] **Step 3: Pull upstream `e601e4a` tree contents into master**

We don't merge upstream's commit history — that would pollute the linear strokmatic-eip story. Instead, take a snapshot, while preserving our `README.md` + `cert/`:

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
mkdir -p /tmp/strokmatic-eip-master-preserve
cp README.md /tmp/strokmatic-eip-master-preserve/README.md
cp -r cert /tmp/strokmatic-eip-master-preserve/cert

git read-tree --reset e601e4a
git checkout-index --all --force

# Restore preserved files (overwriting upstream's README.md with ours)
cp /tmp/strokmatic-eip-master-preserve/README.md README.md
mkdir -p cert
cp -r /tmp/strokmatic-eip-master-preserve/cert/. cert/

git add -A
git commit -m "vendor: import upstream OpENer e601e4a (preserve README + cert/)"
git tag upstream-e601e4a-import
```

Also write `cert/UPSTREAM_BASE.md` with the smoke-build outcome from Task 0.5:

```markdown
# Upstream Base

| Field | Value |
|---|---|
| Upstream repo | https://github.com/EIPStackGroup/OpENer |
| Pinned commit | e601e4a5d008b6461e4285c95652b50aa0f554af (April 29, 2024) |
| Why this commit | Legacy strokmatic-opener fork's merge-base. Builds clean on modern GCC (verified Task 0.5). Newest commit before legacy's strokmatic-only commits start. |
| Required compile flags (if any) | (record from Task 0.5 outcome) |
| Tag preserving the import | `upstream-e601e4a-import` |
```

`git add cert/UPSTREAM_BASE.md && git commit --amend --no-edit` to fold it into the import commit.

- [ ] **Step 4: Verify the imported tree**

```bash
ls source/src/cip/ | head
ls source/src/ports/POSIX/ | head
cat source/CMakeLists.txt | head -10
```

Expected: standard OpENer layout; `source/src/ports/POSIX/main.c` exists.

- [ ] **Step 5: Push to GitHub**

```bash
git push origin master --force-with-lease
git push origin upstream-e601e4a-import
```

(`--force-with-lease` because we are rewriting the broken `fccd7db..3ce3087` history. The legacy/* branches and the tag `upstream-v2.3-import` are unaffected — keep the v2.3 import tag in place as archaeological evidence of the failed attempt.)

---

### Task 2: Add strokmatic-lldpd as a submodule under deps/

**Files:**
- Create: `.gitmodules` (NEW)
- Create: `deps/strokmatic-lldpd/` (submodule)

- [ ] **Step 1: Add the submodule**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
mkdir -p deps
git submodule add git@github.com:strokmatic/strokmatic-lldpd.git deps/strokmatic-lldpd
git config -f .gitmodules submodule.deps/strokmatic-lldpd.branch master
```

- [ ] **Step 2: Pin to a known-good commit**

```bash
cd deps/strokmatic-lldpd
git checkout master
# Currently HEAD is the strokmatic commit on top of upstream lldpd. Use it.
SHA=$(git rev-parse HEAD)
echo "Pinning lldpd at $SHA"
cd ../..
git add deps/strokmatic-lldpd .gitmodules
git commit -m "deps: pin strokmatic-lldpd at $SHA"
```

- [ ] **Step 3: Verify the submodule clones cleanly from a fresh checkout**

```bash
cd /tmp
rm -rf eip-test
git clone --recurse-submodules git@github.com:strokmatic/strokmatic-eip.git eip-test
ls eip-test/deps/strokmatic-lldpd/README.md
```

Expected: README is visible (the lldpd README we saw during R3).

- [ ] **Step 4: Push**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git push origin master
```

---

### Task 3: Re-apply Bucket-A — LLDP CIP objects (cipLLDPDataTable + cipLLDPmanagement)

**Files:**
- Create: `source/src/cip/cipLLDPDataTable.c` (~284 lines)
- Create: `source/src/cip/cipLLDPDataTable.h` (~81 lines)
- Create: `source/src/cip/cipLLDPmanagement.c` (~179 lines)
- Create: `source/src/cip/cipLLDPmanagement.h` (~50 lines)
- Modify: `source/src/cip/CMakeLists.txt` (add the four files)

- [ ] **Step 1: Diff against upstream e601e4a to verify these files don't already exist there**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
ls source/src/cip/ | grep -i lldp || echo "(not present — re-apply needed)"
```

Expected: no LLDP files in the e601e4a import. Phase 0 audit Risk R4 was that some Bucket-A may already be upstream; this confirms the LLDP additions are still strokmatic-only.

- [ ] **Step 2: Copy the LLDP files from the legacy/master branch**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git show legacy/master:source/src/cip/cipLLDPDataTable.c > source/src/cip/cipLLDPDataTable.c
git show legacy/master:source/src/cip/cipLLDPDataTable.h > source/src/cip/cipLLDPDataTable.h
git show legacy/master:source/src/cip/cipLLDPmanagement.c > source/src/cip/cipLLDPmanagement.c
git show legacy/master:source/src/cip/cipLLDPmanagement.h > source/src/cip/cipLLDPmanagement.h
```

(`legacy/master` here is the branch we created in earlier session, preserving the GCS strokmatic-opener history. The cert tag `legacy-cert-submitted-2024-06-19` is also valid.)

- [ ] **Step 3: Inspect for `[RESOLVIDO]`-class CT20 issues**

The CT20 report flagged behaviors that needed fixing. Read each LLDP file and check:
- Does `cipLLDPDataTable.c` correctly support 8 LLDP instances (the CT20 errors at instances 2-8)?
- Does it implement the Identification TLV (CT20 warned this becomes mandatory November 2024)?
- Does the Reset/Power-cycle behavior remove newly added instances?

If any of these are NOT in the legacy file, document gaps as TODO in a separate `cert/CT20_FOLLOWUPS.md` (don't fix in this commit — that's a Phase 2.5 task).

- [ ] **Step 4: Update `source/src/cip/CMakeLists.txt`**

Read `source/src/cip/CMakeLists.txt` — find the `target_sources(...)` or `set(SRC ...)` block that lists CIP source files. Add `cipLLDPDataTable.c` and `cipLLDPmanagement.c` (the `.h` files don't need explicit listing).

If the legacy CMakeLists already had this addition, copy it:

```bash
diff source/src/cip/CMakeLists.txt <(git show legacy/master:source/src/cip/CMakeLists.txt) || true
```

Apply only the LLDP-listing diff (not unrelated changes).

- [ ] **Step 5: Build to verify no compilation errors**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
mkdir -p build && cd build
cmake -DCMAKE_C_COMPILER=gcc -DOpENer_PLATFORM:STRING="POSIX" -DCMAKE_BUILD_TYPE:STRING="Debug" -DBUILD_SHARED_LIBS:BOOL=OFF ../source
make -j 2>&1 | tail -30
```

Expected: build fails because LLDP CIP code references hooks in `cipcommon.c`, `cipidentity.c`, etc. that we haven't added yet. **That's fine for this task** — Task 4 adds the hooks.

If the build fails with errors that are NOT about missing LLDP hooks (e.g., syntax errors in the LLDP files themselves), debug and fix.

- [ ] **Step 6: Commit**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git add source/src/cip/cipLLDPDataTable.c source/src/cip/cipLLDPDataTable.h \
        source/src/cip/cipLLDPmanagement.c source/src/cip/cipLLDPmanagement.h \
        source/src/cip/CMakeLists.txt
git commit -m "feat(cip): add LLDP Data Table and LLDP Management CIP objects (re-applied from legacy)"
```

---

### Task 4: Re-apply Bucket-A — LLDP hooks in core CIP files

**Files:**
- Modify: `source/src/cip/cipcommon.c` (LLDP integration)
- Modify: `source/src/cip/cipcommon.h`
- Modify: `source/src/cip/cipidentity.c` (vendor/product code if changing)
- Modify: `source/src/cip/cipmessagerouter.c` (LLDP routing)
- Modify: `source/src/cip/cipqos.c` (LLDP QoS handling)
- Modify: `source/src/cip/cipassembly.c` (small fix)
- Modify: `source/src/cip/ciptypes.h` (LLDP types)
- Modify: `source/src/opener_api.h` (LLDP public API)
- Modify: `source/src/enet_encap/endianconv.c` (small fix)

- [ ] **Step 1: For each file, capture the per-file diff between upstream e601e4a and legacy**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
for f in cipcommon.c cipcommon.h cipidentity.c cipmessagerouter.c cipqos.c cipassembly.c ciptypes.h; do
  echo "=== $f ==="
  git diff upstream-e601e4a-import legacy/master -- source/src/cip/$f | head -100
  echo "..."
done
git diff upstream-e601e4a-import legacy/master -- source/src/opener_api.h | head -100
git diff upstream-e601e4a-import legacy/master -- source/src/enet_encap/endianconv.c
```

This produces ~9 per-file deltas. Each represents what the legacy added on top of (an older base of) upstream.

- [ ] **Step 2: Apply each delta to the e601e4a-imported files**

For each file, use `git checkout legacy/master -- source/src/cip/<file>` then manually back out anything that was upstream-only (since `e601e4a` may differ slightly from the legacy's exact merge-base). The cleanest path:

```bash
# For each file, three-way merge: take legacy version as the work, then re-apply only the strokmatic deltas
git checkout legacy/master -- source/src/cip/cipcommon.c
# Inspect: does this break upstream e601e4a changes that came after the legacy fork?
git diff upstream-e601e4a-import source/src/cip/cipcommon.c | head -50
# If the diff shows *only* LLDP-related changes, keep. If it accidentally reverts upstream improvements, manually re-apply only the LLDP hunks.
```

This is judgment-call work per file. The Phase 0 audit Risk R1 (810-line `generic_networkhandler.c` may have undocumented cert-required hunks) and R4 (some legacy changes already upstream) come into play here.

**Conservative rule:** when in doubt, prefer the upstream e601e4a version of upstream-style code (function bodies, error handling) and overlay only the LLDP-specific additions (new structs, new function declarations, new switch cases for LLDP class IDs).

- [ ] **Step 3: Build incrementally**

After each file is updated, attempt a build:

```bash
cd build && make -j 2>&1 | grep -E "error|warning" | head -20
```

The build will progressively fail-less as more hooks land. Aim for a clean compile after this whole task.

- [ ] **Step 4: Commit per logical group**

```bash
# Commit 1: cipcommon + cipidentity + opener_api (the core hooks)
git add source/src/cip/cipcommon.c source/src/cip/cipcommon.h source/src/cip/cipidentity.c source/src/opener_api.h
git commit -m "feat(cip): wire LLDP into cipcommon, cipidentity, opener_api"

# Commit 2: cipmessagerouter + cipqos + cipassembly + ciptypes (the routing surface)
git add source/src/cip/cipmessagerouter.c source/src/cip/cipqos.c source/src/cip/cipassembly.c source/src/cip/ciptypes.h
git commit -m "feat(cip): LLDP routing, QoS, assembly hooks + type additions"

# Commit 3: endianconv (small fix)
git add source/src/enet_encap/endianconv.c
git commit -m "fix(enet_encap): legacy endian fix"
```

- [ ] **Step 5: Build to confirm clean compile**

```bash
cd build && make -j 2>&1 | tail -10
```

Expected: no errors. Warnings OK for now.

---

### Task 5: Re-apply Bucket-A — LLDP nvdata persistence

**Files:**
- Create: `source/src/ports/nvdata/nvlldp.c` (~81 lines)
- Create: `source/src/ports/nvdata/nvlldp.h` (~22 lines)
- Modify: `source/src/ports/nvdata/nvdata.c` (LLDP storage hook)
- Modify: `source/src/ports/nvdata/nvdata.h`
- Modify: `source/src/ports/nvdata/CMakeLists.txt`

- [ ] **Step 1: Copy `nvlldp.c/h` from legacy**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git show legacy/master:source/src/ports/nvdata/nvlldp.c > source/src/ports/nvdata/nvlldp.c
git show legacy/master:source/src/ports/nvdata/nvlldp.h > source/src/ports/nvdata/nvlldp.h
```

- [ ] **Step 2: Apply `nvdata.c/h` and CMakeLists deltas**

```bash
git diff upstream-e601e4a-import legacy/master -- source/src/ports/nvdata/nvdata.c | head -60
# Apply only the LLDP-related hooks (look for nvlldp_* function calls or LLDP-tagged blocks)
```

Open the file and add the hooks manually if the diff shows other unrelated changes.

```bash
git diff upstream-e601e4a-import legacy/master -- source/src/ports/nvdata/nvdata.h
git diff upstream-e601e4a-import legacy/master -- source/src/ports/nvdata/CMakeLists.txt
```

- [ ] **Step 3: Build to verify**

```bash
cd build && make -j 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add source/src/ports/nvdata/
git commit -m "feat(nvdata): LLDP persistent storage (nvlldp + hooks)"
```

---

### Task 6: Re-apply Bucket-A — network stack improvements (ciptcpipinterface, generic_networkhandler)

**Files:**
- Modify: `source/src/cip/ciptcpipinterface.c`
- Modify: `source/src/ports/generic_networkhandler.c`

These two files were the largest legacy changes (~709 + ~810 lines). **Phase 0 audit Risk R1** is most relevant here.

- [ ] **Step 1: Diff against e601e4a**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git diff upstream-e601e4a-import legacy/master -- source/src/cip/ciptcpipinterface.c | wc -l
git diff upstream-e601e4a-import legacy/master -- source/src/ports/generic_networkhandler.c | wc -l
```

Get a sense of total delta size.

- [ ] **Step 2: Inspect per-hunk and decide each**

```bash
git diff upstream-e601e4a-import legacy/master -- source/src/cip/ciptcpipinterface.c | less
```

For each hunk, classify:
- **A1 (cert-required)**: changes that look like LLDP integration, IP-stack fixes, attribute corrections (e.g., the CT20 errors about Attribute 2 / 6 sizes) → re-apply
- **A2 (refactor noise)**: whitespace, indentation, function reordering → DROP (use e601e4a's version)
- **A3 (genuinely new behavior)**: anything not obviously cert-required → consult Matheus Gomes (the legacy author at lumesolutions.com) before deciding

If hunks are unclear, leave a `// TODO[strokmatic-eip Phase 2 R1]: review with Matheus` comment and proceed.

- [ ] **Step 3: Apply A1 hunks to the e601e4a-imported files**

Manually patch `ciptcpipinterface.c` and `generic_networkhandler.c` with the cert-required hunks.

- [ ] **Step 4: Build + run-pass test against upstream's own examples**

```bash
cd build && make -j 2>&1 | tail -10
# If there's an upstream sample app that we kept (e.g. POSIX/sample_application/sampleapplication.c), run it against the ODVA CT in passive mode
```

The e601e4a upstream `sampleapplication.c` is still present (we drop it in Task 8 when we add `redis_bridge.c`). Use it as a smoke target here.

- [ ] **Step 5: Commit**

```bash
git add source/src/cip/ciptcpipinterface.c source/src/ports/generic_networkhandler.c
git commit -m "feat(net): re-apply cert-required network stack improvements"
```

---

### Task 7: Re-apply Bucket-B — full POSIX build wiring (REVISED 2026-05-07 — was "build flags")

**Files:**
- Modify: `bin/posix/setup_posix.sh` (add `OPENER_RT` flag)
- Modify: `.gitignore` (extend with build artifacts)
- Modify: `source/src/ports/POSIX/CMakeLists.txt` (link strokmatic-lldpd, json-c, lldpctl, compat-dir; remove Python embedding)
- Modify: `source/CMakeLists.txt` (top-level — feature-test macros if not already present)

> **Why this is bigger than originally scoped.** During the v2.3 attempt we discovered the LLDP CIP files (cipLLDPDataTable.c, cipLLDPmanagement.c, nvlldp.c) include `<json-c/json.h>`, `<lldpctl.h>`, `"lldpd-structs.h"` (relative path), and use `IFNAMSIZ` / `ETHER_ADDR_LEN` macros that require `_DEFAULT_SOURCE` / `_GNU_SOURCE` feature-test macros. The legacy POSIX CMakeLists has ~50 lines of `find_library` / `find_path` / `target_include_directories` / `target_link_libraries` / `target_compile_definitions` to stitch this together. Original Task 7 compressed all this into one bullet — that under-specification is what halted execution at the link stage.

> **Python embedding decision (NEW):** legacy POSIX CMakeLists also has `find_package(PythonLibs)` and `target_link_libraries(OpENer ${PYTHON_LIBRARIES})`. This was for the legacy `sample_application/Iplc/*.py` helpers (camera handshake), which we drop in Task 8. **Spec-compliant decision: do NOT carry Python embedding into strokmatic-eip.** Drop those CMake hunks entirely. Validate in Task 8 that no Bucket-A C code calls `Py_*` symbols.

- [ ] **Step 1: Capture the legacy POSIX CMakeLists delta vs. e601e4a**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git diff upstream-e601e4a-import legacy/master -- source/src/ports/POSIX/CMakeLists.txt > /tmp/posix-cmakelists-delta.diff
wc -l /tmp/posix-cmakelists-delta.diff
less /tmp/posix-cmakelists-delta.diff
```

Categorize each hunk into one of:

| Category | Action |
|---|---|
| **B1 — lldpd linkage** (`find_library(LLDPCTL_LIBRARY lldpctl)`, `find_path(LLDPCTL_INCLUDE_DIR lldpctl.h)`, include `deps/strokmatic-lldpd/include/`, link `${LLDPCTL_LIBRARY}`) | RE-APPLY |
| **B2 — json-c discovery** (`pkg_check_modules(JSONC REQUIRED json-c)` or `find_package(JSON-C)`, include + link) | RE-APPLY |
| **B3 — compat-dir** (include path for `lldpd-structs.h`, e.g. `deps/strokmatic-lldpd/src/`) | RE-APPLY |
| **B4 — feature-test macros** (`add_compile_definitions(_DEFAULT_SOURCE _GNU_SOURCE)` or top-level `-D_GNU_SOURCE`) | RE-APPLY |
| **B5 — sample_application subdir add** (`add_subdirectory(sample_application)`) | DROP (Task 8 removes the dir) |
| **B6 — Python embedding** (`find_package(PythonLibs ...)`, `target_link_libraries(... ${PYTHON_LIBRARIES})`, `target_include_directories(... ${PYTHON_INCLUDE_DIRS})`) | **DROP** (spec violation; legacy only) |
| **B7 — refactor noise** (variable renames, indentation) | DROP (use upstream form) |

Annotate `/tmp/posix-cmakelists-delta.diff` inline as a tracking artifact (you can save the annotated file to `cert/POSIX_CMAKE_DELTA_REVIEW.md` for the cert paper trail).

- [ ] **Step 2: Author the new POSIX CMakeLists.txt manually**

Edit `source/src/ports/POSIX/CMakeLists.txt`. Start from the e601e4a-imported version (already on master) and add only the B1–B4 categories above. Below is the expected shape of the Bucket-B additions; tune to match upstream's exact target name (`OpENer` vs `OpENer_POSIX`).

```cmake
# --- B4: feature-test macros (must come before any system includes) ---
add_compile_definitions(_DEFAULT_SOURCE _GNU_SOURCE)

# --- B2: json-c (used by cipLLDPDataTable.c, cipLLDPmanagement.c) ---
find_package(PkgConfig REQUIRED)
pkg_check_modules(JSONC REQUIRED json-c)

# --- B1: lldpctl (the client library shipped by strokmatic-lldpd) ---
find_library(LLDPCTL_LIBRARY
    NAMES lldpctl
    PATHS ${CMAKE_SOURCE_DIR}/../deps/strokmatic-lldpd/src/lib
          ${CMAKE_SOURCE_DIR}/../deps/strokmatic-lldpd/install/lib
    NO_DEFAULT_PATH)
find_path(LLDPCTL_INCLUDE_DIR
    NAMES lldpctl.h
    PATHS ${CMAKE_SOURCE_DIR}/../deps/strokmatic-lldpd/src/lib
          ${CMAKE_SOURCE_DIR}/../deps/strokmatic-lldpd/install/include
    NO_DEFAULT_PATH)
if(NOT LLDPCTL_LIBRARY OR NOT LLDPCTL_INCLUDE_DIR)
    message(FATAL_ERROR "strokmatic-lldpd not built. Run `cd ../deps/strokmatic-lldpd && ./autogen.sh && ./configure && make` first.")
endif()

# --- B3: compat-dir for lldpd-structs.h (relative includes from CIP LLDP files) ---
set(LLDPD_STRUCTS_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/../deps/strokmatic-lldpd/src/daemon)

target_include_directories(OpENer PRIVATE
    ${JSONC_INCLUDE_DIRS}
    ${LLDPCTL_INCLUDE_DIR}
    ${LLDPD_STRUCTS_INCLUDE_DIR}
)
target_link_libraries(OpENer PRIVATE
    ${JSONC_LIBRARIES}
    ${LLDPCTL_LIBRARY}
)

# --- B5/B6/B7: NOT carried over; see cert/POSIX_CMAKE_DELTA_REVIEW.md for rationale ---
```

> Verify the actual `lldpctl.h` install path under `deps/strokmatic-lldpd/` after running its build. Adjust `find_path` `PATHS` accordingly. The legacy fork hard-coded these to specific GCS paths — your dev environment will differ.

- [ ] **Step 3: Apply OPENER_RT setup flag**

```bash
git diff upstream-e601e4a-import legacy/master -- bin/posix/setup_posix.sh
# Apply only the OPENER_RT-related diff to bin/posix/setup_posix.sh.
```

- [ ] **Step 4: Extend .gitignore**

```bash
git diff upstream-e601e4a-import legacy/master -- .gitignore
# Apply
```

Also add Phase-2-specific entries:

```
build/
deps/strokmatic-lldpd/build/
deps/strokmatic-lldpd/install/
*.o
```

- [ ] **Step 5: Build strokmatic-lldpd first (it's a build prerequisite)**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
cd deps/strokmatic-lldpd
./autogen.sh
./configure --prefix=$(pwd)/install --without-snmp --without-readline
make -j
make install
ls install/lib/liblldpctl.* install/include/lldpctl.h
cd ../..
```

If the configure step fails on missing autoconf/automake/libtool/libevent-dev/libbsd-dev, install:

```bash
sudo apt-get install -y autoconf automake libtool pkg-config libevent-dev libbsd-dev libxml2-dev
```

- [ ] **Step 6: Build OpENer**

```bash
mkdir -p build && cd build
rm -rf CMakeCache.txt CMakeFiles  # in case of stale CMake state
cmake -DCMAKE_C_COMPILER=gcc -DOpENer_PLATFORM:STRING="POSIX" -DCMAKE_BUILD_TYPE:STRING="Debug" -DBUILD_SHARED_LIBS:BOOL=OFF ../source
make -j 2>&1 | tee build.log | tail -30
```

Expected at this stage: build still fails because Tasks 8 (sample_application removal) and 9 (redis_bridge.c) haven't run yet. The failures should be:
- "no main" (sample_application provided main, we'll move it to redis_bridge integration), OR
- LLDP-related includes resolve, json-c symbols link

It should NOT fail with `-fno-common` multi-definition errors (those were the v2.3-only problem; e601e4a is past that).

- [ ] **Step 7: Save the build log into cert/ as evidence**

```bash
cp build/build.log cert/build-task7.log
```

The cert paper trail benefits from per-task build logs. Keeps reviewers honest.

- [ ] **Step 8: Commit**

```bash
git add bin/posix/setup_posix.sh .gitignore source/src/ports/POSIX/CMakeLists.txt cert/POSIX_CMAKE_DELTA_REVIEW.md cert/build-task7.log
git commit -m "build(posix): re-apply Bucket-B — lldpd, json-c, compat-dir, feature-test macros (no Python embedding)"
```

---

### Task 8: Remove legacy `sample_application/` subtree + verify no Python embedding remains

**Files:**
- Delete: `source/src/ports/POSIX/sample_application/` (entirely)

The sample_application from upstream OpENer is the placeholder for an integrator's app code. We replace it with `redis_bridge.c` (next task). The legacy fork additionally embedded Python via this subtree (`Iplc/*.py` helpers loaded from C); removing the subtree is also where Python-embedding leaves the codebase.

- [ ] **Step 1: Verify nothing in upstream e601e4a's sample_application is needed**

The upstream sample_application's `main` and `sampleapplication.c` are reference implementations. Our redis_bridge + clean main.c (Tasks 9–10) replace both.

- [ ] **Step 2: Remove**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
rm -rf source/src/ports/POSIX/sample_application/
```

- [ ] **Step 3: Update POSIX CMakeLists.txt to remove `add_subdirectory(sample_application)`**

```bash
sed -i '/add_subdirectory(sample_application)/d' source/src/ports/POSIX/CMakeLists.txt
```

(Verify the line exists first; this is the upstream pattern. Task 7 already dropped Python-related CMake hunks; this drops the directory reference.)

- [ ] **Step 4: Verify no Python references remain anywhere in the source tree**

After removing sample_application, no C code, no CMake, no script in the repo should reference Python embedding. Sweep:

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
grep -rn -E "Py_|PyObject|PyRun_|PYTHON_LIBRARIES|PYTHON_INCLUDE_DIRS|PythonLibs|find_package\(Python" source/ bin/ cert/ | grep -v "deps/strokmatic-lldpd" || echo "(clean — no Python references)"
```

Expected: `(clean — no Python references)`. If any hits, investigate — they should ALL come from sample_application (removed) or a Bucket-A C file we re-applied that legitimately doesn't need Python (then the reference is dead code from the legacy fork; delete the offending block).

If hits remain in Bucket-A C files (cipcommon.c, etc.), open `cert/PYTHON_REMNANTS.md` and document each. Investigate whether the C code path is reachable in our config (likely it was a legacy hook for camera handshake — not reachable now). Delete the block, commit separately, document in the cert README.

- [ ] **Step 5: Build expectation**

Build will fail (no main.c) — that's expected. Task 10 adds it. The build SHOULD NOT fail with Python-related errors after this task; if it does, Step 4's sweep missed something.

- [ ] **Step 6: Commit**

```bash
git add source/src/ports/POSIX/CMakeLists.txt
git rm -r source/src/ports/POSIX/sample_application
[ -f cert/PYTHON_REMNANTS.md ] && git add cert/PYTHON_REMNANTS.md
git commit -m "remove: drop sample_application subtree + verify no Python embedding remains"
```

---

### Task 9: Write `redis_bridge.c` (TDD via mock-OpENer-call harness)

**Files:**
- Create: `source/src/ports/POSIX/redis_bridge.c` (~300–500 lines)
- Create: `source/src/ports/POSIX/redis_bridge.h`
- Create: `tests/redis_bridge_test.c` (smoke test against a real Redis)
- Modify: `source/src/ports/POSIX/CMakeLists.txt` (link `hiredis` + `redis_bridge`)

The redis_bridge is the only NEW C code in this whole plan. It owns the contract between the C process and the SDK's Redis schema.

> **Constraint (spec-mandated):** redis_bridge.c MUST NOT embed Python, MUST NOT spawn Python interpreters, MUST NOT call into Python via FFI. The C process is plugin-agnostic; the SDK's Redis IPC contract is the *only* boundary. The legacy fork violated this with `Py_*` calls in its sample_application — that's why Tasks 7/8 strip Python wholesale. If a future requirement appears that "needs" Python in C, it belongs in a separate Python plugin process consuming Redis, never in this layer. Reviewers MUST reject any patch to redis_bridge.c that adds a Python dependency.

#### redis_bridge.h interface

```c
#ifndef STROKMATIC_REDIS_BRIDGE_H
#define STROKMATIC_REDIS_BRIDGE_H

#include <stdint.h>
#include <stddef.h>

#define STROKMATIC_IO_ASSEMBLY_SIZE 128

/* Lifecycle */
int strokmatic_redis_bridge_init(const char *host, int port, const char *password,
                                 const char *plc_key, uint32_t eds_revision_major,
                                 uint32_t eds_revision_minor, const uint8_t eds_identity_hash[8]);
void strokmatic_redis_bridge_shutdown(void);

/* Per-cycle calls (called from the OpENer main loop / IO callback) */
/* Push the device's input assembly bytes (PLC -> device) to io:in:<plc_key>. */
int strokmatic_redis_bridge_push_input(const uint8_t *input_bytes, size_t length);
/* Pull the device's output assembly bytes (device -> PLC) from io:out:<plc_key>. */
int strokmatic_redis_bridge_pull_output(uint8_t *output_bytes, size_t length);
/* Increment the comm-layer heartbeat counter and write status:comm:<plc_key>.last_beat_ms. */
int strokmatic_redis_bridge_beat(void);

#endif
```

#### Header lane format (bytes 0–15 of the OUTPUT assembly, i.e. `io:out` values written from C)

| Bytes | Field | Source | Notes |
|---|---|---|---|
| 0–3 | `comm_heartbeat_counter` (uint32 little-endian) | OpENer increments every cycle | PLC ladder watches |
| 4–5 | `comm_status_flags` (uint16 little-endian) | OpENer | bit 0 = redis_connected; bit 1 = healthy |
| 6–13 | `eds_identity_hash` (8 bytes) | static at build time | passed to `strokmatic_redis_bridge_init` |
| 14–15 | reserved | zero-init | future use |

The pull from `io:out:<plc_key>` writes bytes 16–127 from Redis to the assembly. **Bytes 0–15 are NEVER overwritten by Redis** — they're purely C-managed header.

#### redis_bridge.c implementation outline

```c
#include "redis_bridge.h"
#include <hiredis/hiredis.h>
#include <string.h>
#include <time.h>

static struct {
    redisContext *redis;
    char *plc_key;
    uint32_t heartbeat_counter;
    uint16_t status_flags;
    uint8_t eds_identity_hash[8];
} g_state = {0};

static int set_status_flag(uint16_t flag, int on) {
    if (on) g_state.status_flags |= flag;
    else g_state.status_flags &= ~flag;
    return 0;
}

#define STATUS_REDIS_CONNECTED  (1u << 0)
#define STATUS_HEALTHY          (1u << 1)

int strokmatic_redis_bridge_init(...) {
    /* Connect to Redis */
    g_state.redis = redisConnect(host, port);
    if (!g_state.redis || g_state.redis->err) {
        set_status_flag(STATUS_REDIS_CONNECTED, 0);
        return -1;
    }
    if (password) {
        redisReply *r = redisCommand(g_state.redis, "AUTH %s", password);
        if (!r || r->type == REDIS_REPLY_ERROR) { freeReplyObject(r); return -1; }
        freeReplyObject(r);
    }
    set_status_flag(STATUS_REDIS_CONNECTED, 1);
    set_status_flag(STATUS_HEALTHY, 1);

    g_state.plc_key = strdup(plc_key);
    memcpy(g_state.eds_identity_hash, eds_identity_hash, 8);

    /* Write schema:version */
    redisReply *r = redisCommand(g_state.redis, "SET schema:version %s", "1.0.0");
    if (r) freeReplyObject(r);

    return 0;
}

int strokmatic_redis_bridge_push_input(const uint8_t *input_bytes, size_t length) {
    if (!g_state.redis || length != STROKMATIC_IO_ASSEMBLY_SIZE) return -1;
    /* SET io:in:<plc_key> <128-byte binary blob> */
    redisReply *r = redisCommand(g_state.redis,
        "SET io:in:%s %b", g_state.plc_key, input_bytes, (size_t)STROKMATIC_IO_ASSEMBLY_SIZE);
    if (!r || r->type == REDIS_REPLY_ERROR) {
        set_status_flag(STATUS_REDIS_CONNECTED, 0);
        if (r) freeReplyObject(r);
        return -1;
    }
    set_status_flag(STATUS_REDIS_CONNECTED, 1);
    freeReplyObject(r);
    return 0;
}

int strokmatic_redis_bridge_pull_output(uint8_t *output_bytes, size_t length) {
    if (!g_state.redis || length != STROKMATIC_IO_ASSEMBLY_SIZE) return -1;

    /* Stamp the header lane bytes 0..15 ourselves (never overwritten by Redis). */
    uint32_t hb_le = g_state.heartbeat_counter;
    output_bytes[0] = (uint8_t)(hb_le & 0xFF);
    output_bytes[1] = (uint8_t)((hb_le >> 8) & 0xFF);
    output_bytes[2] = (uint8_t)((hb_le >> 16) & 0xFF);
    output_bytes[3] = (uint8_t)((hb_le >> 24) & 0xFF);

    uint16_t sf_le = g_state.status_flags;
    output_bytes[4] = (uint8_t)(sf_le & 0xFF);
    output_bytes[5] = (uint8_t)((sf_le >> 8) & 0xFF);

    memcpy(&output_bytes[6], g_state.eds_identity_hash, 8);
    output_bytes[14] = 0;
    output_bytes[15] = 0;

    /* Read bytes 16..127 from Redis */
    redisReply *r = redisCommand(g_state.redis,
        "GETRANGE io:out:%s 16 127", g_state.plc_key);
    if (!r || r->type != REDIS_REPLY_STRING) {
        set_status_flag(STATUS_REDIS_CONNECTED, 0);
        if (r) freeReplyObject(r);
        memset(&output_bytes[16], 0, length - 16);
        return -1;
    }
    set_status_flag(STATUS_REDIS_CONNECTED, 1);
    /* Zero-pad if Redis returned fewer bytes than requested (unset key). */
    size_t ret_len = r->len;
    if (ret_len > length - 16) ret_len = length - 16;
    memcpy(&output_bytes[16], r->str, ret_len);
    if (ret_len < length - 16) {
        memset(&output_bytes[16 + ret_len], 0, length - 16 - ret_len);
    }
    freeReplyObject(r);
    return 0;
}

int strokmatic_redis_bridge_beat(void) {
    if (!g_state.redis) return -1;
    g_state.heartbeat_counter++;
    int64_t now_ms = (int64_t)time(NULL) * 1000;
    redisReply *r = redisCommand(g_state.redis,
        "HSET status:comm:%s last_beat_ms %lld", g_state.plc_key, (long long)now_ms);
    if (r) freeReplyObject(r);
    return 0;
}

void strokmatic_redis_bridge_shutdown(void) {
    if (g_state.redis) redisFree(g_state.redis);
    free(g_state.plc_key);
    memset(&g_state, 0, sizeof(g_state));
}
```

- [ ] **Step 1: Create `redis_bridge.h` and `redis_bridge.c` with the implementations above**

Use the code blocks. Adjust as needed for OpENer's existing logging/error conventions.

- [ ] **Step 2: Update POSIX CMakeLists.txt to link hiredis + redis_bridge.c**

```cmake
find_package(PkgConfig REQUIRED)
pkg_check_modules(HIREDIS REQUIRED hiredis)

target_sources(OpENer_POSIX PRIVATE
    main.c
    redis_bridge.c
)
target_include_directories(OpENer_POSIX PRIVATE ${HIREDIS_INCLUDE_DIRS})
target_link_libraries(OpENer_POSIX PRIVATE ${HIREDIS_LIBRARIES})
```

(Adjust target name to match upstream's POSIX target.)

- [ ] **Step 3: Write `tests/redis_bridge_test.c`**

A small test program that:
1. Calls `strokmatic_redis_bridge_init` with localhost:6379, plc_key=`test_plc`
2. Calls `strokmatic_redis_bridge_push_input` with 128 known bytes
3. Verifies `redis-cli GET io:in:test_plc` returns those bytes
4. Pre-populates `io:out:test_plc` via `redis-cli SETRANGE io:out:test_plc 16 <bytes>` then calls `pull_output` and verifies bytes 16+ match
5. Verifies bytes 0–15 contain heartbeat_counter, status_flags, eds_identity_hash, reserved zeros
6. Calls `strokmatic_redis_bridge_beat` 5 times; verifies `redis-cli HGET status:comm:test_plc last_beat_ms` is recent
7. Calls `strokmatic_redis_bridge_shutdown`

- [ ] **Step 4: Build and run the test**

```bash
docker run -d --name redis-eip-test -p 6379:6379 redis:7
cd build
make redis_bridge_test
./redis_bridge_test
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add source/src/ports/POSIX/redis_bridge.c source/src/ports/POSIX/redis_bridge.h \
        source/src/ports/POSIX/CMakeLists.txt tests/redis_bridge_test.c
git commit -m "feat: redis_bridge.c — 128-byte I/O assembly mirror to Redis"
```

---

### Task 10: Write the new `main.c`

**Files:**
- Create: `source/src/ports/POSIX/main.c` (~150 lines, replacing the legacy 1000+-line monstrosity)

The new main is a clean composition: parse env vars, init OpENer, register the I/O callback that calls redis_bridge, run the OpENer event loop forever.

- [ ] **Step 1: Read upstream's reference main**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git show upstream-e601e4a-import:source/src/ports/POSIX/main.c | wc -l
git show upstream-e601e4a-import:source/src/ports/POSIX/main.c | head -100
```

Use the upstream main as the structural starting point. (The legacy main.c is NOT a useful reference — it was 1000+ lines of camera-acquisition logic; spec rule says zero app logic in C.)

- [ ] **Step 2: Implement the new main.c**

```c
/* main.c — strokmatic-eip C process entry point.
 * Pure I/O assembly mirror; zero application logic. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include "opener_api.h"
#include "redis_bridge.h"

static volatile sig_atomic_t g_shutdown = 0;
static void on_sigterm(int sig) { (void)sig; g_shutdown = 1; }

#define INPUT_ASSEMBLY_INSTANCE  100u
#define OUTPUT_ASSEMBLY_INSTANCE 101u

/* OpENer callback: PLC sent us new output-assembly data (we are the device). */
static EipStatus on_output_assembly_received(CipInstance *instance) {
    /* Mirror it to io:in:<plc_key>. The "input" naming in Redis is from the
     * plugin's perspective: PLC -> device. */
    uint8_t *bytes = ((CipByteArray *)instance->attributes[3].data)->data;
    return (strokmatic_redis_bridge_push_input(bytes, 128) == 0) ? kEipStatusOk : kEipStatusError;
}

/* Called every cycle to populate the device-to-PLC bytes from Redis. */
static void update_input_assembly_from_redis(CipInstance *instance) {
    uint8_t *bytes = ((CipByteArray *)instance->attributes[3].data)->data;
    strokmatic_redis_bridge_pull_output(bytes, 128);
    strokmatic_redis_bridge_beat();
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <network-iface>\n", argv[0]);
        return 1;
    }
    const char *iface = argv[1];

    const char *redis_host = getenv("REDIS_HOST");
    int redis_port = getenv("REDIS_PORT") ? atoi(getenv("REDIS_PORT")) : 6379;
    const char *redis_pass = getenv("REDIS_PASSWORD");
    const char *plc_key = getenv("PLC_KEY");
    if (!redis_host || !plc_key) {
        fprintf(stderr, "REDIS_HOST and PLC_KEY are required\n");
        return 1;
    }

    /* Identity hash from build (compile-time constant injected via CMake). */
    extern const uint8_t STROKMATIC_EDS_IDENTITY_HASH[8];
    extern const uint32_t STROKMATIC_EDS_REVISION_MAJOR;
    extern const uint32_t STROKMATIC_EDS_REVISION_MINOR;

    if (strokmatic_redis_bridge_init(redis_host, redis_port, redis_pass, plc_key,
                                     STROKMATIC_EDS_REVISION_MAJOR,
                                     STROKMATIC_EDS_REVISION_MINOR,
                                     STROKMATIC_EDS_IDENTITY_HASH) != 0) {
        fprintf(stderr, "redis_bridge_init failed\n");
        return 1;
    }

    signal(SIGTERM, on_sigterm);
    signal(SIGINT, on_sigterm);

    /* OpENer init: wire identity, register assemblies 100 (input from PLC) and
     * 101 (output to PLC), register on_output_assembly_received. */
    if (CipStackInit(/* OpENer-specific args, see upstream main */) != kEipStatusOk) {
        fprintf(stderr, "CipStackInit failed\n");
        return 1;
    }

    /* Register assemblies and callbacks (mirroring upstream sample, but with our 128-byte size). */
    CreateAssemblyObject(INPUT_ASSEMBLY_INSTANCE, NULL, 128);
    CreateAssemblyObject(OUTPUT_ASSEMBLY_INSTANCE, on_output_assembly_received, 128);

    /* Bind to the network interface and start the OpENer event loop. */
    if (NetworkHandlerInitialize(iface) != kEipStatusOk) {
        fprintf(stderr, "NetworkHandlerInitialize(%s) failed\n", iface);
        return 1;
    }

    while (!g_shutdown) {
        NetworkHandlerProcessOnce();
        update_input_assembly_from_redis(GetCipInstance(GetCipClass(0x04 /* AssemblyClass */),
                                                        INPUT_ASSEMBLY_INSTANCE));
    }

    NetworkHandlerFinish();
    strokmatic_redis_bridge_shutdown();
    return 0;
}
```

(Function names like `CreateAssemblyObject`, `CipStackInit`, `NetworkHandlerProcessOnce` follow OpENer's actual API — verify against `opener_api.h` and the upstream sample for current names.)

- [ ] **Step 3: Build**

```bash
cd build && make -j 2>&1 | tail -10
```

- [ ] **Step 4: Smoke-run against a fake PLC scanner (upstream tools or Wireshark)**

```bash
# Run in one terminal:
sudo build/src/ports/POSIX/OpENer eth0
# Verify it doesn't crash on startup, listens on EIP port 44818
```

- [ ] **Step 5: Commit**

```bash
git add source/src/ports/POSIX/main.c source/src/ports/POSIX/CMakeLists.txt
git commit -m "feat: clean main.c — OpENer init + redis_bridge wiring; zero app logic"
```

---

### Task 11: Build-time identity injection

**Files:**
- Create: `cert/EDS_REVISION` (single source of truth)
- Modify: `source/src/ports/POSIX/CMakeLists.txt` (read cert/EDS_REVISION, inject as compile-time constants)
- Create: `source/src/ports/POSIX/eds_identity.c` (generated/written, holds the constants)

- [ ] **Step 1: Write `cert/EDS_REVISION`**

```
EDS_REVISION_MAJOR=1
EDS_REVISION_MINOR=0
EDS_IDENTITY_HASH=0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
```

(Hash will be filled by Task 12 after EDS file is written, computed as SHA1(EDS_file) truncated to 8 bytes.)

- [ ] **Step 2: CMake reads EDS_REVISION and generates eds_identity.c**

Add to `source/src/ports/POSIX/CMakeLists.txt`:

```cmake
file(READ ${CMAKE_SOURCE_DIR}/../cert/EDS_REVISION EDS_REV_CONTENT)
string(REGEX MATCH "EDS_REVISION_MAJOR=([0-9]+)" _ ${EDS_REV_CONTENT})
set(EDS_REV_MAJOR ${CMAKE_MATCH_1})
string(REGEX MATCH "EDS_REVISION_MINOR=([0-9]+)" _ ${EDS_REV_CONTENT})
set(EDS_REV_MINOR ${CMAKE_MATCH_1})
string(REGEX MATCH "EDS_IDENTITY_HASH=([0-9a-fA-Fx,]+)" _ ${EDS_REV_CONTENT})
set(EDS_IDENT_HASH ${CMAKE_MATCH_1})
configure_file(eds_identity.c.in eds_identity.c @ONLY)
target_sources(OpENer_POSIX PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/eds_identity.c)
```

- [ ] **Step 3: Write `source/src/ports/POSIX/eds_identity.c.in`**

```c
/* GENERATED FILE — see ../../../../cert/EDS_REVISION for source-of-truth. */
#include <stdint.h>
const uint32_t STROKMATIC_EDS_REVISION_MAJOR = @EDS_REV_MAJOR@u;
const uint32_t STROKMATIC_EDS_REVISION_MINOR = @EDS_REV_MINOR@u;
const uint8_t STROKMATIC_EDS_IDENTITY_HASH[8] = { @EDS_IDENT_HASH@ };
```

- [ ] **Step 4: Build to verify**

```bash
cd build && cmake ../source && make -j 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add cert/EDS_REVISION source/src/ports/POSIX/eds_identity.c.in source/src/ports/POSIX/CMakeLists.txt
git commit -m "build: inject EDS_REVISION + IDENTITY_HASH at compile time from cert/EDS_REVISION"
```

---

### Task 12: Write the EDS file for STROKMATIC-COMM-V1

**Files:**
- Create: `eds/STROKMATIC-COMM-V1.eds`

The EDS file is the formal product description ODVA needs. Follow the structure from the legacy EDS (in `2024-2_EtherNetIP_REVIEW_COPY.zip`) with new identity values.

- [ ] **Step 1: Extract the legacy EDS for reference**

```bash
# Download and extract 2024-2_EtherNetIP_REVIEW_COPY.zip from the Drive cert folder
# Locate the .eds file inside (likely top-level)
cp /tmp/legacy-cert-package/<legacy>.eds /tmp/legacy.eds
head -50 /tmp/legacy.eds
```

- [ ] **Step 2: Author the new EDS**

The EDS is INI-style. Critical sections:

```ini
[File]
DescText = "Strokmatic STROKMATIC-COMM-V1 — Generic EtherNet/IP Comm Layer";
CreateDate = MM-DD-YYYY;
CreateTime = HH:MM:SS;
ModDate = MM-DD-YYYY;
ModTime = HH:MM:SS;
Revision = 1.0;

[Device]
VendCode = 9876;                        $ Strokmatic vendor ID
VendName = "Strokmatic";
ProdType = 0x002B;                      $ Generic Device
ProdTypeStr = "Generic Device";
ProdCode = TBD;                         $ See Task 0
MajRev = 1;
MinRev = 0;
ProdName = "STROKMATIC-COMM-V1";
Catalog = "STROKMATIC-COMM-V1";

[Device Classification]
Class1 = "EtherNetIP";

[Connection Manager]
$ Connection definitions for the I/O assemblies.
$ Match upstream OpENer's sample EDS structure with 128/128 sizes.
Connection1 =
    0x04010002, $ trigger and transport
    0x44240405, $ point/point class3, fixed, run/idle
    0x80000005, $ ofst, t->o size etc.
    100,        $ produced (input from device perspective) connection size = ?
    0x40000005, $ ofst, o->t size etc.
    101,        $ consumed connection size
    "STROKMATIC-COMM-V1 Exclusive Owner",
    ;

$ Plus more sections per upstream sample EDS structure.
```

(Authoring the full EDS requires CIP Vol 1 reference — `Vol1_3.35.pdf` is in the Drive cert folder.)

- [ ] **Step 3: Validate the EDS via ODVA's EZ-EDS tool**

EZ-EDS is the ODVA-provided EDS validator. Install it (Windows-only; can run in Wine on Linux). Open `STROKMATIC-COMM-V1.eds` and confirm it validates with no errors.

- [ ] **Step 4: Compute the EDS_IDENTITY_HASH**

```bash
# SHA1 of the canonicalized EDS, truncated to 8 bytes, formatted as a C array initializer
HASH=$(sha1sum eds/STROKMATIC-COMM-V1.eds | head -c 16 | sed 's/../0x&,/g' | sed 's/,$//')
echo "EDS_IDENTITY_HASH=$HASH" >> cert/EDS_REVISION  # but replace, not append
```

Actually, write a small script that updates `cert/EDS_REVISION` to use the computed hash. The file should NOT have stale `0x00,...` after the EDS is written.

- [ ] **Step 5: Rebuild with the new hash**

```bash
cd build && cmake ../source && make -j
# Verify the binary embeds the hash:
strings build/src/ports/POSIX/OpENer | grep -A0 STROKMATIC_EDS_IDENTITY || true
```

- [ ] **Step 6: Commit**

```bash
git add eds/STROKMATIC-COMM-V1.eds cert/EDS_REVISION
git commit -m "feat(cert): EDS file for STROKMATIC-COMM-V1 + identity hash"
```

---

### Task 13: Dockerfile + GitHub Actions CI

**Files:**
- Create: `Dockerfile`
- Create: `.github/workflows/build.yml`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM debian:12-slim AS build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config libhiredis-dev libcap-dev \
    autoconf automake libtool libsnmp-dev libxml2-dev libreadline-dev \
    libevent-dev libbsd-dev libnetlink-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

# Init the strokmatic-lldpd submodule
RUN git submodule update --init --recursive deps/strokmatic-lldpd

# Build strokmatic-lldpd
RUN cd deps/strokmatic-lldpd && ./autogen.sh && ./configure --prefix=/usr/local && make -j && make install

# Build OpENer
RUN cd source && cmake -B build -DOpENer_PLATFORM=POSIX -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j

FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libhiredis0.14 libcap2 libsnmp40 libxml2 libreadline8 libevent-2.1-7 libbsd0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/sbin/lldpd /usr/local/sbin/
COPY --from=build /src/source/build/src/ports/POSIX/OpENer /usr/local/bin/
COPY --from=build /src/eds/STROKMATIC-COMM-V1.eds /etc/strokmatic-eip/
ENTRYPOINT ["/usr/local/bin/OpENer"]
```

- [ ] **Step 2: Smoke-build locally**

```bash
docker build -t strokmatic-eip:smoke .
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
version: "3.9"
services:
  strokmatic-eip:
    image: strokmatic-eip:latest
    container_name: strokmatic-eip
    network_mode: host
    privileged: true   # needed to bind to a raw network interface for EIP
    restart: unless-stopped
    environment:
      - REDIS_HOST=192.168.15.102
      - REDIS_PORT=6379
      - REDIS_PASSWORD=${REDIS_PASSWORD}
      - PLC_KEY=192.168.15.123
    command: ["enp4s0"]
```

- [ ] **Step 4: Write `.github/workflows/build.yml`**

```yaml
name: build
on:
  push: { branches: [master] }
  pull_request: { branches: [master] }

jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Build Docker image
        run: docker build -t strokmatic-eip:ci .
      - name: Smoke-run
        run: docker run --rm strokmatic-eip:ci --help || true
```

- [ ] **Step 5: Commit + push**

```bash
git add Dockerfile docker-compose.yml .github/workflows/build.yml
git commit -m "ci: Dockerfile, docker-compose, GitHub Actions build workflow"
git push origin master
```

- [ ] **Step 6: Verify CI passes**

```bash
gh run list --repo strokmatic/strokmatic-eip --limit 1
gh run watch --repo strokmatic/strokmatic-eip
```

---

### Task 14: Write CERTIFICATION.md

**Files:**
- Create: `CERTIFICATION.md`

- [ ] **Step 1: Write the doc**

```markdown
# Certification — STROKMATIC-COMM-V1

## Identity

| Field | Value |
|---|---|
| Vendor | Strokmatic (Vendor ID `9876`) |
| Product | STROKMATIC-COMM-V1 |
| Product Code | (see `cert/EDS_REVISION`) |
| Device Type | `0x002B` Generic Device |
| Revision | (see `cert/EDS_REVISION`) |
| EDS file | `eds/STROKMATIC-COMM-V1.eds` |

## Recert triggers — what changes require a new ODVA conformance test?

| Change | Recert? |
|---|---|
| New plugin (Python) consuming this comm layer | NO |
| Plugin parameter change in `cfg:*` | NO |
| New byte assignment within an existing lane (bytes 16–127 of either assembly) | NO |
| Bug fix in `redis_bridge.c` that does not alter the wire protocol | NO |
| Upstream OpENer security fix touching CIP behavior | YES (minor revision bump) |
| Increase / decrease assembly size from 128 bytes | YES |
| Change Vendor ID, Product Code, or Device Type | YES (new product) |
| New CIP service or Identity Object field | YES |
| LLDP CIP object behavior change | YES |

The hard rule: **anything that touches `eds/STROKMATIC-COMM-V1.eds` or the Identity Object response requires a new conformance test.** C source can be patched freely as long as the EDS shape is unchanged AND the patches don't alter wire-protocol behavior.

## In-house conformance testing

ODVA's CT (Conformance Test) tool is the gate before formal lab submission. Run it against:
- The DUT (this binary, in a container)
- A test PLC scanner

The Apr 2024 internal CT20 baseline (`Drive/.../Summary_report_CT20.txt`) had 48 errors at the LLDP CIP object level. **STROKMATIC-COMM-V1 must reach 0 errors before formal ODVA lab submission.**

## Known issue carry-overs (from CT20 review)

The legacy CT20 internal run flagged issues marked `[RESOLVIDO]` for items resolved before the June 2024 ODVA submission. Verify each is still resolved in this codebase:

- [ ] Vendor ID / Product Code / Serial Number in CIP Identification attribute (instance 2) — must match identity values
- [ ] Identification TLV support (mandatory from November 2024)
- [ ] LLDP instance count up to 8 (Max Instance was 1 vs 2..8 expected)
- [ ] Ethernet Link Object instance access (instances 2..9 reported but not accessible)
- [ ] Newly-added LLDP instances removed after Reset/Power cycle
- [ ] Attribute 2 data value (Ethernet Link Object)
- [ ] Attribute 6 size in bytes (Ethernet Link Object)
- [ ] Common Services error responses (Srv Code x11)

## ODVA submission package

When submitting:
1. EDS file (`eds/STROKMATIC-COMM-V1.eds`)
2. CT report (zero errors)
3. ODVA Membership confirmation
4. New Product Code application receipt
5. Any deviation requests (e.g. for GM-specific conformance items — see `Drive/Desvio GM/`)
```

- [ ] **Step 2: Commit**

```bash
git add CERTIFICATION.md
git commit -m "docs: CERTIFICATION.md — recert triggers, identity, in-house CT plan"
```

---

### Task 15: Run ODVA Conformance Test in-house

**Files:** none (operational task; output goes to a separate Drive folder)

- [ ] **Step 1: Download ODVA's CT tool**

The CT tool is ODVA-issued (members-only). Use the membership credentials in `Drive/Membership Agreement for Strokmatic Innovation Technology.pdf` to download.

- [ ] **Step 2: Install on a Windows or Wine-on-Linux dev box**

CT runs on Windows. Confirm the legacy team had a Windows dev box for this; if not, provision one or set up Wine.

- [ ] **Step 3: Configure CT for STROKMATIC-COMM-V1**

Point CT at the running container (`strokmatic-eip:latest` on a test interface), with the new EDS file imported.

- [ ] **Step 4: Run the LLDP Data Table Object test**

This is the test that the legacy ran in CT20 (`Drive/2024-04-15_Relatórios ODVA CT20/`). Run it; capture logs.

Expected: zero errors, zero warnings, all sub-tests pass.

- [ ] **Step 5: Run all other relevant CT tests**

Per ODVA's product category for Generic Device + EtherNet/IP, run all required tests (Identity Object, TCP/IP Interface, Ethernet Link, Connection Manager, Assembly Object, etc.).

- [ ] **Step 6: Save reports to Drive**

Upload to a new subfolder of the existing cert folder: `2026-MM-DD_Relatorios_CT_STROKMATIC-COMM-V1/`. Include logs, summary report, .pcap captures.

- [ ] **Step 7: Iterate**

If errors appear, fix in code (likely returning to Tasks 3-9), commit, re-test. Loop until 0 errors.

- [ ] **Step 8: Tag the cert-submission commit**

When CT passes:

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git tag -a strokmatic-eip-v1.0.0-cert-submitted-$(date +%Y-%m-%d) \
    -m "STROKMATIC-COMM-V1 v1.0.0 — submitted to ODVA cert"
git push origin --tags
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Tasks |
|---|---|
| Architecture (one OpENer per PLC, plugins via Redis) | Tasks 9, 10 |
| Components → strokmatic-eip C process | Tasks 1–13 |
| I/O assembly 128 bytes input + 128 bytes output | Tasks 9, 12 |
| Header lane (bytes 0–15) with heartbeat, status, identity hash | Task 9 |
| EDS Identity (Vendor 9876, Type 0x002B, Product Code TBD) | Tasks 0, 12 |
| LLDP CIP support (cert-required) | Tasks 3–5 |
| Schema versioning (`schema:version` Redis key written by C) | Task 9 |
| Build-time identity injection from `cert/EDS_REVISION` | Task 11 |
| Conformance testing strategy | Task 15 |
| CERTIFICATION.md recert triggers | Task 14 |
| Phased migration → Phase 2 = this plan | covered |
| Spec rule "C contains zero application logic" | Tasks 7, 8, 9 (Python-embedding stripped + verified) |

**No spec gaps identified.**

**2. Placeholder scan:** None — every task has concrete commands, exact file paths, and code blocks. The two operational tasks (Task 0 ODVA Product Code application, Task 15 CT runs) describe specific actions the engineer takes, with clear deliverables.

**3. Type consistency:** redis_bridge function names match between `redis_bridge.h` (Task 9), `main.c` (Task 10), and `eds_identity.c.in` (Task 11). EDS revision constant names (`STROKMATIC_EDS_REVISION_MAJOR/MINOR`, `STROKMATIC_EDS_IDENTITY_HASH`) are consistent across CMake config (Task 11), C generation template (Task 11), and main.c usage (Task 10).

**4. Revision consistency check (post-2026-05-07 build-failure revision):**
- Upstream base: every Task that diffs against upstream now uses `upstream-e601e4a-import` (the tag created in Task 1 Step 3); no remaining `upstream/v2.3` references in re-apply tasks (Tasks 3–7).
- Build wiring: Task 7 catalogs B1 (lldpctl) / B2 (json-c) / B3 (compat-dir) / B4 (feature-test macros) explicitly, with sample CMake fragments. Drops B5 (sample_application include) / B6 (Python embedding) / B7 (refactor noise) explicitly.
- Python embedding: dropped in Task 7 (CMake hunks), verified absent in Task 8 (grep sweep), forbidden in Task 9 (constraint paragraph). Three checkpoints for the same rule — intentional defense in depth for a spec violation that the legacy carried.
- Smoke-build the base BEFORE vendoring: Task 0.5 added; this is the gap that caused the v2.3 dead-end.

---

## Execution Handoff

Plan complete and saved to `/home/teruel/JARVIS/docs/superpowers/plans/2026-05-07-strokmatic-eip-phase2-c-opener-service.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Fresh subagent per task with two-stage review. Suits this plan because Tasks 3, 4, 6 (re-applying legacy hunks) require careful per-file judgment.
2. **Inline Execution** — Same session, batched checkpoints.

Which approach? Note that Task 0 (Product Code decision) and Task 15 (CT runs) are operational and can't be fully agent-executed — they need a human to apply for the ODVA Product Code and run the Windows-only CT tool. Tasks 1–14 are agent-executable; Tasks 0/15 are user-driven with agent support for analysis.
