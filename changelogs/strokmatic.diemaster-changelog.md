# Changelog - strokmatic.diemaster

All notable changes to the strokmatic.diemaster workspace.

## 2026-02-26

### Added
- E2E test infrastructure with layered architecture — contract, benchmark, service, and pipeline tests. Docker Compose with broker/full profiles, PostgreSQL seed data from production, message factories for DRAWIN and GAP sensors, Playwright UI scaffolds. Branch: `feat/e2e-test-infrastructure`, PR #6.

Format: [Keep a Changelog](https://keepachangelog.com/)
### Fixed
- `.gitignore` now tracks `tests/e2e/.env` (test-only credentials) via negation rule. PR #7.

