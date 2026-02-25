# Local Network Machine Reference

**Network:** `192.168.15.0/24`<br>
**Last scanned:** 2026-02-25

---

## Mapped Machines

### 192.168.15.2 — Infrastructure Server
| Field | Value |
|-------|-------|
| Hostname | `STROKMATIC` |
| OS | Ubuntu 22.04.4 LTS |
| Kernel | 5.15.0-43-generic |
| CPU | 8 cores |
| RAM | 31 GB |
| Disk | 219 GB (root) |
| Ports | SSH (22), HTTP (80), RDP (3389), 8008, 8080, 8081, 9090 |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | Infrastructure — ClearML, databases, test environments |
| Docker Containers | clearml-elastic, clearml-apiserver, clearml-fileserver, clearml-webserver, clearml-redis, clearml-mongo, async_delete, visionking-frontend, visionking-visualizer, label-studio-local-compose, local_rclone_s3, database-server, portainer_agent, test-infra-sis-surface-pgadmin-dev, test-infra-sis-surface-pgsqlone-dev, test-infra-sis-surface-pgsqltwo-dev, test-infra-sis-surface-redisinsight-dev, test-infra-sis-surface-redistwo-dev, test-infra-sis-surface-redisone-dev, test-infra-sis-surface-keydb, bookstack_external, bookstack_db, pg-server |

---

### 192.168.15.60 — SpotFusion Production Vision Module
| Field | Value |
|-------|-------|
| Hostname | `STROKMATIC` |
| OS | Ubuntu 22.04.4 LTS |
| Kernel | 6.2.0-26-generic |
| CPU | 8 cores |
| RAM | — |
| Disk | 234 GB |
| Ports | SSH (22), RDP (3389) |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | **Production** — SpotFusion vision module |
| Docker Containers | — |

---

### 192.168.15.84 — SpotFusion Production Server / JARVIS Host
| Field | Value |
|-------|-------|
| Hostname | `STROKMATIC` |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-100-generic |
| CPU | 12 cores |
| RAM | 31 GB |
| Disk | 468 GB |
| Ports | SSH (22), HTTP (80), HTTPS (443), RDP (3389) |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | **Production** — SpotFusion server; also hosts JARVIS orchestrator |
| Docker Containers | — |

---

### 192.168.15.190 — Training / Production Server
| Field | Value |
|-------|-------|
| Hostname | `skm-training` |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-94-generic |
| CPU | 32 cores |
| RAM | 62 GB |
| Disk | 961 GB |
| Ports | SSH (22), HTTP (80), RDP (3389) |
| SSH User | `skm` |
| SSH Password | `skm@@2022` |
| Role | ML training, VisionKing database-writer, caching, message broker. Blender installed. |
| Docker Containers | visionking-database-writer, visionking-visualizer, portainer_agent, cache_vision_king, cache_spot_fusion, cache, insight, rabbitmqs, rabbitmq, insights, caches, mongo, database-backup, database-server, db-pgadmin |

---

### 192.168.15.213 — Dev Team Laptop
| Field | Value |
|-------|-------|
| Hostname | `STROKMATIC` |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-100-generic |
| CPU | 8 cores |
| RAM | 31 GB |
| Disk | 859 GB |
| Ports | SSH (22), HTTP (80) |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | Dev team laptop |
| Docker Containers | — |

---

### 192.168.15.224 — Dev Team Laptop (VK Backend Services)
| Field | Value |
|-------|-------|
| Hostname | `strokmatic-Free` |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-90-generic |
| CPU | 8 cores |
| RAM | 31 GB |
| Disk | 938 GB |
| Ports | SSH (22), HTTP (80), 8080 |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | Dev team laptop — running VisionKing backends, PostgreSQL clusters, Redis |
| Docker Containers | redis-vk01, redis-vk02, postgresql-vk01, postgresql-vk02, postgresql-vk03, strokmatic-front-end-sis-surface-prod-ctnr, strokmatic-front-end-sis-surface-dev-ctnr, back-end-sis-surface, back-end-sis-surface-ref |

---

### 192.168.15.226 — Dev Team Laptop (Avell)
| Field | Value |
|-------|-------|
| Hostname | `Avell-01` |
| OS | Ubuntu 22.04.5 LTS |
| Kernel | 6.8.0-100-generic |
| CPU | 8 cores |
| RAM | 31 GB |
| Disk | 260 GB |
| Ports | SSH (22) |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | Dev team laptop (Avell) |
| Docker Containers | — |

---

### 192.168.15.230 — Engineering Workstation (CAE/Simulation)
| Field | Value |
|-------|-------|
| Hostname | `DESKTOP-SOT707C` |
| OS | Microsoft Windows 11 Pro |
| CPU | 8 cores |
| RAM | 65 GB |
| Disk | — |
| Ports | SSH (22), RDP (3389) |
| SSH User | `strokmatic` |
| SSH Password | `skm@@2022` |
| Role | Engineering workstation — PAM-Stamp, Ansys, Vision Master licenses |
| Docker Containers | — |

---

### 192.168.15.243 — DieMaster Production Server
| Field | Value |
|-------|-------|
| Hostname | `skm-BOXER` |
| OS | Ubuntu 24.04.2 LTS |
| Kernel | — |
| CPU | 12 cores |
| RAM | 31 GB |
| Disk | 755 GB |
| Ports | SSH (22), HTTP (80), HTTPS (443), 8080 |
| SSH User | `skm` |
| SSH Password | `skm@@2022` |
| Role | DieMaster (SmartDie) production — full service stack |
| Docker Containers | smartdie-loader, smartdie-status, smartdie-setting, cache, smartdie-get-data, smartdie-backend-dev-ctnr, smartdie-processing-data, smartdie-database-writer, smartdie-trigger, smartdie-connect, portainer, portainer_agent, smartdie-backend-prod-ctnr, smartdie-nginx-prod-ctnr, database-server, database-server-test, database-backup, db-pgadmin, rabbitmq, insight |

---

### 192.168.15.254 — Automation Workstation (PLC/CAD)
| Field | Value |
|-------|-------|
| Hostname | `DESKTOP-T5I5A5N` |
| OS | Microsoft Windows 10 Pro |
| CPU | 6 cores |
| RAM | 96 GB |
| Disk | — |
| Ports | SSH (22), HTTP (80), RDP (3389) |
| SSH User | `Workstation` |
| SSH Password | `Lume2019` |
| Role | Automation workstation — Studio 5000, Siemens NX licenses |
| Docker Containers | — |

---

## Unmapped Machines (No SSH Access)

### 192.168.15.81 — Bosch PSI7000 Weld Controller
| Field | Value |
|-------|-------|
| Ports | SSH (22), HTTP (80), HTTPS (443) |
| Credentials | Unknown |
| Role | Bosch PSI7000 weld controller |

### 192.168.15.122 — Bosch PSI7000 Weld Controller
| Field | Value |
|-------|-------|
| Ports | SSH (22), HTTP (80), HTTPS (443) |
| Credentials | Unknown |
| Role | Bosch PSI7000 weld controller |

### 192.168.15.103 — Unknown Server (Connection Reset)
| Field | Value |
|-------|-------|
| Ports | SSH (22), HTTP (80), HTTPS (443), RDP (3389), VNC (5900), 8008, 8080, 8081, 9090 |
| Credentials | Unknown (SSH connection reset) |
| Role | Unknown — heavy port profile suggests server |

### 192.168.15.200 — Unknown Server
| Field | Value |
|-------|-------|
| Ports | SSH (22), HTTP (80), 8080 |
| Credentials | Unknown (password rejected) |

### 192.168.15.228 — Unknown
| Field | Value |
|-------|-------|
| Ports | SSH (22), 8080 |
| Credentials | Unknown (password rejected) |

### 192.168.15.229 — Unknown
| Field | Value |
|-------|-------|
| Ports | SSH (22) |
| Credentials | Unknown (password rejected) |

### 192.168.15.250 — Unknown (Key-Only Auth)
| Field | Value |
|-------|-------|
| Ports | SSH (22), HTTP (80), 8080 |
| Credentials | Key-only SSH authentication |

---

## Network-Only Devices (No SSH)

| IP | Ports | Likely Role |
|----|-------|-------------|
| `192.168.15.1` | HTTP (80), HTTPS (443) | Router / Gateway |
| `192.168.15.4` | HTTP (80) | IoT / Network device |
| `192.168.15.93` | HTTP (80) | IoT / Network device |
| `192.168.15.197` | 8080 | Appliance / Service |
| `192.168.15.208` | — | Host up, no common ports |
| `192.168.15.240` | HTTP (80) | IoT / Network device |
