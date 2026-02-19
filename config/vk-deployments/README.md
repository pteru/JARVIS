# VK Deployment Configurations

Per-deployment JSON configuration files for the VisionKing health monitoring system.

## File Naming

`<deployment_id>.json` — e.g., `03002.json` for deployment 03002.

## Schema

| Field | Type | Description |
|-------|------|-------------|
| `deployment_id` | string | Unique deployment identifier |
| `name` | string | Human-readable deployment name |
| `product` | string | Product name (`visionking`) |
| `profile` | string | Deployment profile (`laminacao`, `carrocerias`, etc.) |
| `nodes` | object | Map of node alias to node config (host, user, ssh_port, role, has_gpu, gpu_model, services) |
| `ports` | object | Map of service name to port number used across the deployment |
| `thresholds` | object | Alert thresholds for disk, RAM, GPU, queue depth, and container restarts |
| `redis_dbs` | object | Redis database index to purpose mapping |
| `rabbitmq_user` | string | RabbitMQ admin username |
| `gui_checks` | object | Per-node list of `:<port>` endpoints to verify via HTTP |

## Node Config

Each entry under `nodes` contains:

- `host` — IP address
- `user` — SSH username
- `ssh_port` — SSH port (typically 8050, not 22)
- `role` — `processing` (GPU + full pipeline) or `dashboard` (web UI only)
- `has_gpu` — boolean
- `gpu_model` — GPU model string (empty if no GPU)
- `services` — list of Docker service names expected on this node

## Thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| `disk_warning_pct` | 75 | Disk usage warning (%) |
| `disk_critical_pct` | 90 | Disk usage critical (%) |
| `ram_warning_pct` | 85 | RAM usage warning (%) |
| `ram_critical_pct` | 95 | RAM usage critical (%) |
| `gpu_mem_warning_pct` | 90 | GPU memory warning (%) |
| `gpu_mem_critical_pct` | 95 | GPU memory critical (%) |
| `queue_warning` | 5000 | RabbitMQ queue depth warning |
| `queue_critical` | 10000 | RabbitMQ queue depth critical |
| `restart_warning` | 3 | Container restart count warning |
| `restart_critical` | 10 | Container restart count critical |
| `alert_cooldown_minutes` | 60 | Minimum minutes between duplicate alerts |

## Security

The JSON config files contain IP addresses and are gitignored.
Only this README is tracked in version control.
