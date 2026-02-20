# Modified Third-Party Libraries Repository

## Summary

Centralized repository for storing, versioning, and distributing custom/patched versions of third-party libraries used across Strokmatic products. Eliminates vendored copies scattered across services and provides a single source of truth for custom forks.

## Problem Statement

Several third-party libraries are used in modified form across products:

| Library | Upstream | Modification | Current State |
|---------|----------|-------------|---------------|
| **pylogix** | github.com/dmroeder/pylogix | Custom `Adapter` class for EtherNet/IP Class 1 & 2 implicit messaging | **6 vendored copies** across SpotFusion services (plc-monitor-camera, plc-result, tag-monitor) |
| **ultralytics** | github.com/ultralytics/ultralytics | Embedded local copy (currently unmodified, but likely to diverge for custom export/inference) | 1 copy in VisionKing `ds/yolov11/ultralytics/` |
| **OpENer** | EtherNet/IP stack | Custom Python Pybind11 bindings for CIP protocol | 2 copies (libs/opener + plc-monitor-camera-opener) |
| **GenICam-SKM** | In-house (Aravis/GenICam wrapper) | Strokmatic-authored C++20/Pybind11 camera control library | 1 copy in SpotFusion camera-acquisition |
| **label-studio-ml-backend** | HumanSignal/label-studio-ml-backend | Custom VisionKing ML backend modules | 1 copy in VisionKing ds/label-predictor |

Problems with the current approach:
1. **6 identical pylogix copies** — bug fixes must be applied 6 times
2. **No version tracking** — impossible to know which copy has which patches
3. **No CI** — custom builds are untested, regressions go unnoticed
4. **No changelog** — modifications are undocumented
5. **License compliance risk** — AGPL (ultralytics), Apache 2.0 (pylogix) modifications need tracking

## Architecture

### Repository Structure

```
strokmatic/modified-third-party-libs/
├── README.md                      # Index of all forks, links to upstream, modification summary
├── pylogix/
│   ├── README.md                  # Upstream version, modification log, usage guide
│   ├── CHANGELOG.md               # Keep a Changelog format
│   ├── upstream.txt               # Pinned upstream commit SHA
│   ├── patches/                   # Git-format patches against upstream (for rebasing)
│   │   └── 001-adapter-class.patch
│   ├── pylogix/                   # Modified source
│   │   ├── __init__.py
│   │   ├── eip.py
│   │   ├── lgx_comm.py
│   │   └── adapter.py             # Custom Strokmatic addition
│   ├── tests/
│   │   └── test_adapter.py
│   ├── pyproject.toml              # strokmatic-pylogix, version 0.8.3.post1
│   └── Dockerfile.test             # Test runner with mock PLC
├── ultralytics/
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── upstream.txt
│   ├── patches/
│   ├── ultralytics/               # Modified source (when divergence begins)
│   ├── pyproject.toml              # strokmatic-ultralytics
│   └── Dockerfile.test
├── opener/
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── src/                        # C source + Pybind11 bindings
│   ├── python/                     # Python package wrapper
│   ├── CMakeLists.txt
│   └── Dockerfile.build            # Multi-stage build (C compile → Python wheel)
├── genicam-skm/
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── src/                        # C++20 source
│   ├── python/
│   ├── CMakeLists.txt
│   └── Dockerfile.build
├── label-studio-backends/
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── visionking_backend/         # Custom ML backend
│   └── pyproject.toml
├── .github/
│   └── workflows/
│       ├── ci-pylogix.yml          # Test + build wheel on push to pylogix/
│       ├── ci-ultralytics.yml
│       ├── ci-opener.yml
│       ├── ci-genicam.yml
│       └── upstream-sync.yml       # Weekly check for upstream updates
└── scripts/
    ├── sync-upstream.sh            # Fetch upstream, show diff against our patches
    └── publish-to-registry.sh      # Build wheels, push to private PyPI
```

### Distribution: Private PyPI Registry

**Option A — devpi (lightweight, self-hosted):**
```yaml
# docker-compose.yml
services:
  devpi:
    image: devpi/devpi-server:latest
    ports: ["3141:3141"]
    volumes: ["devpi-data:/data"]
```
- Pros: Simple, mirrors public PyPI, supports pip install directly
- Cons: Another service to maintain

**Option B — GitHub Packages (zero infra):**
- Publish wheels as GitHub releases or to GitHub Packages PyPI registry
- `pip install strokmatic-pylogix --index-url https://github.com/strokmatic/...`
- Pros: No self-hosted infra, integrates with existing GitHub org
- Cons: Requires PAT for private repos

**Recommendation:** GitHub Packages (Option B) — zero infrastructure overhead, fits existing GitHub workflow.

### Consumer Migration

Replace vendored copies with pip dependencies:

```dockerfile
# Before (in each service's Dockerfile):
COPY utils/pylogix /app/utils/pylogix

# After:
RUN pip install strokmatic-pylogix==0.8.3.post1 \
    --index-url https://pypi.org/simple/ \
    --extra-index-url https://${GITHUB_TOKEN}@...
```

## Complexity Analysis

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Scope** | Medium | 5 libraries, mostly file organization + CI |
| **Risk** | Low | No production behavior change — same code, just relocated |
| **Dependencies** | None | Standalone repo, consumers migrate at their own pace |
| **Testing** | Medium | Need mock PLC for pylogix, GPU for ultralytics, Aravis for GenICam |
| **Maintenance** | Ongoing | Upstream sync checks (automated via CI) |

**Overall Complexity: Medium**

## Development Phases

### Phase 1 — Repository Setup & pylogix Consolidation
**Estimate: 4-6 hours**

1. Create `strokmatic/modified-third-party-libs` GitHub repo
2. Extract pylogix with `Adapter` class, create `pyproject.toml` (strokmatic-pylogix)
3. Generate patch file against upstream 0.8.3
4. Write basic tests for Adapter class (mock socket for implicit messaging)
5. Set up GitHub Actions CI: lint + test + build wheel
6. Publish first wheel to GitHub Packages
7. Migrate ONE SpotFusion service (plc-result) as proof of concept

### Phase 2 — Remaining Libraries
**Estimate: 5-8 hours**

1. Add ultralytics (initially as-is, with upstream tracking)
2. Add OpENer with Pybind11 build system (CMake + manylinux wheel)
3. Add GenICam-SKM with C++20 build (requires Aravis dev headers)
4. Add label-studio-backends
5. Set up upstream-sync workflow (weekly diff report)
6. Document each library: upstream version, modification rationale, license

### Phase 3 — Consumer Migration
**Estimate: 3-4 hours**

1. Update all 6 SpotFusion services to `pip install strokmatic-pylogix`
2. Remove vendored `utils/pylogix/` directories
3. Update VisionKing inference Dockerfile for strokmatic-ultralytics
4. Update SpotFusion camera-acquisition for genicam-skm package
5. Verify all Docker builds pass with packaged versions
6. Update `.gitmodules` / submodule references as needed

## Estimates Summary

| Phase | Hours | Dependencies |
|-------|-------|-------------|
| Phase 1 — Repo + pylogix | 4-6h | None |
| Phase 2 — All libraries | 5-8h | Phase 1 |
| Phase 3 — Migration | 3-4h | Phase 2 |
| **Total** | **12-18h** | |

## References

- pylogix upstream: https://github.com/dmroeder/pylogix (Apache 2.0)
- ultralytics upstream: https://github.com/ultralytics/ultralytics (AGPL-3.0)
- GenICam-SKM: internal Strokmatic library (C++20/Pybind11)
- OpENer: EtherNet/IP stack (various licenses)
- GitHub Packages PyPI: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-apache-maven-registry
