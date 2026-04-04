# SDK Backlog

## Shared Libraries (publish as internal pip/npm packages)
- [ ] [complex] FEAT-01: Create opener-based EIP connector — EtherNet/IP connector built on OpENer. Reusable for SpotFusion/VisionKing PLC services.
- [ ] [complex] FEAT-02: Implement advanced logging in observability-stack — Structured log aggregation, dashboards, alerting. Extend with Loki/Grafana.
- [ ] [complex] LIB-01: Publish shared Python logging lib — Loguru-based with standard setup, formatters, log levels. Internal pip package. (Formerly FEAT-03 + FEAT-04 merged scope)
- [ ] [complex] LIB-02: Publish shared Python RabbitMQ aio-pika lib — Based on visionking-inference patterns. connect_robust, context manager ack/nack, retry loop. Internal pip package.
- [ ] [medium] LIB-03: Create shared Redis client library — Connection factory, pooling, retry logic, type hints. No shared lib exists today — each product implements inline.
- [ ] [medium] LIB-04: Create shared config loader library — Pydantic-based env var validation. Standardize config across products. Based on DM inference pattern.

## Toolkit Consolidation (migrate to SDK, reference as submodules)
- [ ] [complex] TOOL-01: Consolidate PLC tools → sdk-plc-toolkit — Merge SF's 5 PLC tools into multi-page Streamlit/Click CLI.
- [ ] [complex] TOOL-02: Extract shared deployment framework → sdk-deployment-toolkit — Core topology/compose/env from VK deployment-runner.
- [ ] [complex] TOOL-03: Merge defect visualization tools → sdk-defect-toolkit — Combine sdk-defect-visualizer + VK defect-report-toolkit.
- [ ] [medium] TOOL-04: Merge Redis tools → sdk-redis-toolkit — Merge trendline-monitor + SF redis-recorder + SF redis-saver.
- [ ] [medium] TOOL-05: Consolidate message posting → sdk-message-poster — Merge template-based + DB replay modes.
- [ ] [medium] TOOL-06: Build comprehensive image toolkit → sdk-image-toolkit — Merge extractor + VK image-toolkit + SF image-analyzer.
- [ ] [medium] TOOL-07: Consolidate welding tools → sdk-welding-toolkit — Merge bos6000-toolkit + view-r-extractor + raft_studies.

## Infrastructure
- [ ] [low] INFRA-01: Enforce branch protection on develop — Disable admin bypass on GitHub branch protection rules.

## Completed
- [x] TOOL-08: Build weld grouping optimizer — sdk-weld-grouping-optimizer. Phase A implemented, 30/30 tests passing (2026-02-18)
