# health/extras — relocated keepers from the retired legacy monitors

Moved here 2026-07-04 when `scripts/vk-health/` and `scripts/sf-health/` were
retired in favor of the unified `scripts/health/` monitor (Phase 5 of the
health-monitor unification).

- `gpu-watchdog.sh` — standalone VK GPU watchdog (self-contained, not part of
  the health pipeline).
- `explore-server.sh` — interactive SF server exploration helper.
- `sf-02006-references.txt` — access notes + container inventory for the
  SpotFusion Hyundai server.
- `vk-monitoring-deploy/` — Grafana/Prometheus/cAdvisor provisioning for VK
  nodes. **Pending absorption into `strokmatic/sdk-observability-stack`**
  (see the GitHub issue filed there); delete this copy once absorbed.
