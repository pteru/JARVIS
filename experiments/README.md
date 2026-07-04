# experiments/ — exploratory scripts, NOT production

One-off spikes, probes, and audit scripts kept for reference. Nothing here
runs on cron or is depended on by `scripts/` automation. Graduating a script
means moving it into `scripts/` with tests; abandoning one means deleting it
(git history preserves it).

- `sg3-portal-probe.mjs` — SG3 portal discovery spike (2026-05; hardcoded paths)
- `vk-hardening-audit-readonly.sh` — one-off read-only hardening audit of vk01/vk02 (2026-06)
