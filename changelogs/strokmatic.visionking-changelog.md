# Changelog - strokmatic.visionking

All notable changes to the strokmatic.visionking workspace.

## 2026-03-05

### Added
- Sealer deployment profile: topology (topologies/sealer-single-node.yaml), architecture diagram (architecture/sealer-pipeline.mmd/.png), data flow doc (architecture/vk-sealer-pipeline.md). Updated service-map, queue-topology, topologies README, architecture README, and CLAUDE.md to include vk-sealer as 4th profile.

## 2026-03-04

### Added
- SparkTest deployment profile design — WiFi camera-based steel alloy identification via spark testing. 7 backlog tasks (SPARK-01 through SPARK-07): wifi-camera-acquisition, spark-test-controller, inference adaptation, backend-sparktest, frontend-sparktest tablet PWA, topology profile, database-writer adaptation. Design doc: `docs/plans/2026-03-04-sparktest-deployment-profile-design.md`

## 2026-02-26

### Added
- Full-stack E2E test infrastructure with Playwright — 7 Docker services (3x PostgreSQL multi-point, Redis, NestJS backend, Angular frontend, Flask mock visualizer), 20 passing tests, 271 pecas / 1,084 frames / 32,112 defeitos across 30 barras of real production data. Branch: `feat/e2e-test-infrastructure`

Format: [Keep a Changelog](https://keepachangelog.com/)
