# VK Health Monitor — Deployment 03002

Self-contained health monitoring package for VisionKing deployment 03002 (Laminacao/Steel).

Collects system metrics, service data, and queue status from all 3 nodes (vk01, vk02, vk03), runs AI analysis via Claude, and sends Telegram alerts when thresholds are breached.

## Prerequisites

- **VPN access** to the 10.244.70.x network
- **sshpass** — `sudo apt install sshpass`
- **jq** — `sudo apt install jq`
- **python3** — system Python 3.x
- **curl** — typically pre-installed
- **Claude Code CLI** — required for `analyze.sh` (AI analysis step). Install from https://claude.ai/download
- **node** (optional) — only needed for `scripts/helpers/log-dispatch.sh` dispatch logging

## Quick Start

```bash
# 1. Run interactive setup (creates secrets, configures Telegram)
./setup.sh

# 2. Export credentials
export VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password)
export VK_RABBIT_PASSWORD=$(cat secrets/vk-rabbit-password)

# 3. Run the full pipeline
./scripts/vk-health/run.sh
```

## Manual Setup

If you prefer not to use `setup.sh`:

1. Create secrets directory and files:
   ```bash
   mkdir -p secrets && chmod 700 secrets
   echo "your-ssh-password" > secrets/vk-ssh-password
   echo "your-rabbit-password" > secrets/vk-rabbit-password
   chmod 600 secrets/*
   ```

2. Configure Telegram notifications (optional):
   Edit `config/orchestrator/notifications.json` and replace `YOUR_BOT_TOKEN` and `YOUR_CHAT_ID` with real values.

3. Export credentials and run:
   ```bash
   export VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password)
   export VK_RABBIT_PASSWORD=$(cat secrets/vk-rabbit-password)
   ./scripts/vk-health/run.sh
   ```

## Usage

### Full pipeline (collect + analyze + alert)

```bash
./scripts/vk-health/run.sh [deployment-id]  # default: 03002
```

### Collect only (no AI analysis, no alerts)

```bash
./scripts/vk-health/collect.sh 03002
```

### Analyze only (requires a recent snapshot)

```bash
./scripts/vk-health/analyze.sh 03002
```

### Alert only (check thresholds against latest snapshot)

```bash
./scripts/vk-health/alert.sh 03002
```

### Daily trends (aggregate today's snapshots + 90-day retention)

```bash
./scripts/vk-health/trends.sh 03002
```

## Cron Setup

Run the health check every 15 minutes and trends aggregation daily at 23:30:

```cron
# VK Health Monitor — every 15 minutes
*/15 * * * * cd /path/to/vk-health-03002 && VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password) VK_RABBIT_PASSWORD=$(cat secrets/vk-rabbit-password) ./scripts/vk-health/run.sh >> logs/cron-vk-health.log 2>&1

# VK Health Trends — daily at 23:30
30 23 * * * cd /path/to/vk-health-03002 && VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password) VK_RABBIT_PASSWORD=$(cat secrets/vk-rabbit-password) ./scripts/vk-health/trends.sh >> logs/cron-vk-health.log 2>&1
```

Replace `/path/to/vk-health-03002` with the actual package path.

## Output

| Directory | Contents |
|-----------|----------|
| `data/vk-health/03002/{date}/` | JSON snapshots (one per run) and daily `trends.json` |
| `reports/vk-health/03002/` | AI analysis reports (`analysis-*.md`) and `latest.md` symlink |
| `reports/vk-health/03002/improvements.md` | Cumulative improvement findings |
| `logs/` | Dispatch log and pipeline output |

## Architecture

| Script | Description |
|--------|-------------|
| `run.sh` | Orchestrator — runs collect, analyze, alert with flock-based locking |
| `collect.sh` | Connects to all nodes via SSH, queries Prometheus, Docker, Redis, PostgreSQL, RabbitMQ. Outputs a JSON snapshot. |
| `analyze.sh` | Reads the latest snapshot, computes trends, runs Claude AI analysis, saves report and extracts improvements. |
| `alert.sh` | Checks latest snapshot against thresholds. Sends Telegram alerts with deduplication (cooldown period). |
| `trends.sh` | Aggregates all daily snapshots into min/max/avg trends. Runs 90-day retention cleanup. |
| `lib/config.sh` | Configuration loader — sets paths, reads deployment config, exports thresholds. |
| `lib/ssh.sh` | SSH helper functions (ssh_cmd, scp_to, is_node_reachable). |
| `lib/telegram.sh` | Telegram Bot API sender (send_telegram, send_telegram_alert). |
| `lib/assemble_processing.py` | Python JSON assembler SCP'd to processing nodes (Docker, Redis, PostgreSQL, image-saver). |
| `lib/assemble_dashboard.py` | Python JSON assembler SCP'd to dashboard nodes (Docker, PostgreSQL). |

## Deploy Directory

The `deploy/` directory contains reference files for deploying the monitoring stack (Prometheus, Grafana, node-exporter, cAdvisor, NVIDIA GPU exporter) on the VK nodes. This is a **prerequisite** — the health monitor queries Prometheus on each node.

```bash
# Deploy monitoring to a GPU node (vk01 or vk02)
VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password) ./deploy/deploy-monitoring.sh vk01 gpu

# Deploy monitoring to the dashboard node (vk03, no GPU)
VK_SSH_PASSWORD=$(cat secrets/vk-ssh-password) ./deploy/deploy-monitoring.sh vk03 no-gpu
```

## Deployment Info

- **vk01** (10.244.70.26) — Processing node, RTX 4070 Ti SUPER
- **vk02** (10.244.70.50) — Processing node, RTX 4070 Ti SUPER
- **vk03** (10.244.70.25) — Dashboard node (no GPU)
- **SSH port**: 8050 on all nodes
- **Prometheus**: port 8110 (mapped from 9090)
- **Redis**: port 4000 (non-standard)
- **RabbitMQ UI**: port 8002

## Troubleshooting

**SSH connection refused**
- Verify VPN is connected (`ping 10.244.70.26`)
- Check SSH port is 8050 (`ssh -p 8050 vk01@10.244.70.26`)
- Verify password in `secrets/vk-ssh-password`

**Prometheus metrics returning null**
- Ensure the monitoring stack is deployed on the target node (see Deploy Directory)
- Check Prometheus is running: `curl http://10.244.70.26:8110/api/v1/query?query=up`
- On vk03, set `NO_PROXY=localhost` if behind a proxy

**Analysis step fails**
- Claude Code CLI must be installed and authenticated
- Check `logs/cron-vk-health.log` for error details
- Run `claude --version` to verify installation

**No snapshots found**
- Snapshots use UTC dates. If your timezone is ahead of UTC, check yesterday's directory.
- Verify `data/vk-health/03002/` exists and has `.json` files

**Telegram alerts not sending**
- Verify `config/orchestrator/notifications.json` has valid `bot_token` and `chat_id`
- Test manually: `curl https://api.telegram.org/bot<TOKEN>/getMe`
