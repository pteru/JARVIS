# ClearML Deployment Analysis - 192.168.15.2

**Analysis Date:** 2026-03-13
**Server:** 192.168.15.2
**Uptime:** 16 days, 6 hours
**ClearML Version:** 2.0.0 (Build 613)

---

## 1. Executive Summary

ClearML is deployed on 192.168.15.2 as a comprehensive MLOps platform for tracking machine learning experiments, managing datasets, and storing trained models. The deployment is actively used for **computer vision projects** focused on industrial quality inspection, specifically:

- **Arcelor Mittal BCM** - Pre-labeling for steel surface defect detection
- **Spot Fusion Plus** - Welding quality detection
- **Ultralytics** - YOLO-based training experiments
- **Stack Fusion** - Additional welding/stacking inspection

The system contains **260 tasks** (experiments), **896 models**, and approximately **29GB of data**. The deployment is primarily used for PyTorch-based YOLO training workflows, with most activity occurring between December 2024 and July 2025. The agent-services container is currently **stopped** (requires API credentials to start), meaning no automated task execution is available.

---

## 2. Infrastructure

### 2.1 Docker Containers

| Container Name | Image | Status | Ports Exposed | Uptime |
|----------------|-------|--------|---------------|--------|
| **clearml-webserver** | allegroai/clearml:latest | Running | 9090:80 | 2 weeks |
| **clearml-apiserver** | allegroai/clearml:latest | Running | 8008:8008 | 2 weeks |
| **clearml-fileserver** | allegroai/clearml:latest | Running | 8081:8081 | 2 weeks |
| **clearml-elastic** | elasticsearch:8.17.0 | Running | 9200, 9300 (internal) | 2 weeks |
| **clearml-mongo** | mongo:6.0.19 | Running | 27017 (internal) | 2 weeks |
| **clearml-redis** | redis:7.4.1 | Running | 6379 (internal) | 2 weeks |
| **clearml-agent-services** | allegroai/clearml-agent-services:latest | **Exited** | - | Stopped 3 months ago |
| **async_delete** | allegroai/clearml:latest | Running | - (internal) | 2 weeks |

### 2.2 Network Architecture

- **Backend Network:** 172.23.0.0/16 (bridge driver)
- **Frontend Network:** 172.24.0.0/16 (bridge driver)
- **Public Access:**
  - Web UI: `http://192.168.15.2:9090`
  - API Server: `http://192.168.15.2:8008`
  - File Server: `http://192.168.15.2:8081`

### 2.3 Storage

**Total ClearML Data:** 29 GB
**Disk:** /dev/sdb1 - 2.7TB total, 1.8TB used, 826GB free (69% utilization)

**Data Breakdown by Component:**

| Component | Size | Path |
|-----------|------|------|
| **Elasticsearch Indices** | 9.4 GB | `/mnt/storage1/clearml/data/elastic_7` |
| **Fileserver (artifacts/models)** | 19 GB | `/mnt/storage1/clearml/data/fileserver` |
| **MongoDB (metadata)** | 542 MB | `/mnt/storage1/clearml/data/mongo_4` |
| **Redis (cache)** | 8 KB | `/mnt/storage1/clearml/data/redis` |
| **Logs** | 67 MB | `/mnt/storage1/clearml/logs` |

**Fileserver Storage by Project:**

| Project Directory | Size |
|-------------------|------|
| Spot Fusion Plus | 15 GB |
| Arcelor Mittal | 2.2 GB |
| Teste | 1.4 GB |
| Spot_Fusion_Plus | 226 MB |
| Experimento default | 93 MB |
| Others | < 100 MB each |

### 2.4 Version Information

- **ClearML Server:** 2.0.0 (Build 613)
- **Elasticsearch:** 8.17.0 (with 6GB memory limit, 4GB JVM heap)
- **MongoDB:** 6.0.19
- **Redis:** 7.4.1
- **ClearML Agent Services:** latest (outdated - last updated 4 years ago)

---

## 3. Projects & Experiments

### 3.1 Project Overview

**Total Projects:** 15
**Total Tasks (Experiments):** 260

| Project | Tasks | Models | Description |
|---------|-------|--------|-------------|
| **Arcelor Mittal BCM - Pre Label** | 123 | 704 | Steel surface defect detection, YOLO11x training |
| **Spot Fusion Plus** | 103 | 53 | Welding quality inspection |
| **Ultralytics** | 16 | 4 | YOLO experimentation |
| **ClearML Examples** | 11 | 98 | Pre-populated demo projects |
| **Stack Fusion** | - | - | Minimal activity |
| **ClearML Examples/...** | 7 | 41 | Reporting, Pipeline, HPO examples |

### 3.2 Task Status Distribution

| Status | Count | Percentage |
|--------|-------|------------|
| **Stopped** | 162 | 62.3% |
| **Completed** | 61 | 23.5% |
| **Failed** | 35 | 13.5% |
| **Created** | 1 | 0.4% |
| **Published** | 1 | 0.4% |

**Interpretation:** High stopped task count (162) suggests manual intervention in experiments - users are stopping training runs before completion, likely due to monitoring metrics or time constraints.

### 3.3 Task Type Distribution

| Type | Count | Percentage |
|------|-------|------------|
| **Training** | 239 | 91.9% |
| **Testing** | 17 | 6.5% |
| **Data Processing** | 4 | 1.5% |

### 3.4 Recent Activity

**Most Recent Task:** `01_07_2025_14_24_MULTICLASSE` (failed) - **July 1, 2025 at 14:24 UTC**

**Last 5 Updated Tasks:**

| Task Name | Status | Created | Last Updated |
|-----------|--------|---------|--------------|
| 01_07_2025_14_24_MULTICLASSE | Failed | 2025-07-01 14:24 | 2025-07-01 14:24 |
| 01_07_2025_14_06_MULTICLASSE | Failed | 2025-07-01 14:06 | 2025-07-01 14:06 |
| 13_06_2025_20_11_6a_campanha | Completed | 2025-06-13 20:11 | 2025-06-13 23:17 |
| 09_06_2025_10_28_6a_campanha | Completed | 2025-06-09 13:28 | 2025-06-09 16:55 |
| 09_06_2025_10_25_6a_campanha | Stopped | 2025-06-09 13:25 | 2025-06-09 13:27 |

**Activity Timeline:** System shows continuous usage from **December 2024 through July 2025**, with most intensive activity in **June-July 2025**. No activity since July 2025 (8 months ago as of this analysis date).

---

## 4. Models

### 4.1 Model Statistics

**Total Models:** 896
**Ready Models:** 23 (2.6%)
**In-Progress/Draft:** 873 (97.4%)

### 4.2 Framework Distribution

| Framework | Count | Percentage |
|-----------|-------|------------|
| **PyTorch** | 726 | 81.0% |
| **TensorFlow** | 152 | 17.0% |
| **Keras** | 13 | 1.5% |
| **XGBoost** | 2 | 0.2% |
| **ScikitLearn** | 2 | 0.2% |
| **LightGBM** | 1 | 0.1% |

**Dominant Framework:** PyTorch (81%) - consistent with YOLO-based vision workflows.

### 4.3 Models by Project

| Project | Model Count |
|---------|-------------|
| **Arcelor Mittal BCM - Pre Label** | 704 |
| **Stack Fusion** | 98 |
| **Spot Fusion Plus** | 53 |
| ClearML Examples (HPO) | 13 |
| ClearML Examples (Pipeline) | 12 |
| **Ultralytics** | 4 |
| Other | 12 |

### 4.4 Model Storage

**Storage Type:** Mixed - Local fileserver + S3 references

**Sample Model URIs:**
- **Local:** `/mnt/fileserver/Spot Fusion Plus/...`
- **External S3 (ClearML Examples):** `https://allegro-examples.s3.amazonaws.com/clearml-public-resources/...`

**Ready Models (5 most recent):**
All 5 most recent "ready" models are **ClearML demo models** from hyperparameter optimization examples stored on Allegro's S3. These are Keras models with different layer configurations - not production models.

---

## 5. Workers & Agents

### 5.1 Registered Workers

**Active Workers:** 0
**Total Registered:** 0

The `workers` collection in MongoDB is **empty**, meaning no remote compute nodes or agents are currently registered.

### 5.2 Agent Services Status

**Container:** `clearml-agent-services`
**Status:** **Exited (0) - 3 months ago**
**Exit Reason:** Missing `CLEARML_API_ACCESS_KEY` environment variable

**Log Evidence:**
```
CLEARML_API_ACCESS_KEY was not provided, service will not be started
```

**Configured Worker ID:** `clearml-services`
**Docker Socket Mount:** `/var/run/docker.sock` (available for Docker-in-Docker execution)
**Agent Data Mount:** `/mnt/storage1/clearml/agent:/root/.clearml`

**Implications:**
- No automated task queuing/execution
- No remote experiment orchestration
- Users must manually run training scripts with ClearML SDK integration

---

## 6. Users & Access

### 6.1 Registered Users

**Total Users:** 10

| User Name | Email | Type |
|-----------|-------|------|
| **Pedro Teruel** | `4203c620-...@test.ai` | Human |
| **Matheus Vilar** | `693fb820-...@test.ai` | Human |
| **Matheus Gomes Almeida Moreira Silva** | `4f878400-...@test.ai` | Human |
| **Vanessa VS** | `d97359b0-...@test.ai` | Human |
| **matheus.santos@strokmatic.com** | `c775ecf0-...@test.ai` | Human |
| apiserver | `apiserver@example.com` | System |
| fileserver | `fileserver@example.com` | System |
| webserver | `webserver@example.com` | System |
| services_agent | `services_agent@example.com` | System |
| tests | `tests@example.com` | System |

**Company ID:** `d1bd92a3b039400cbafc60a7a5b1e52b` (all users belong to same organization)

**Authentication:** All human users have `@test.ai` emails with UUID prefixes - suggests **demo/development authentication mode** rather than production SSO/LDAP.

---

## 7. Storage

### 7.1 Storage Architecture

**Type:** **Local filesystem** (no S3/GCS/Azure integration configured)

**Data Locations:**
- **Artifacts/Models:** `/mnt/storage1/clearml/data/fileserver`
- **Metadata:** MongoDB (`/mnt/storage1/clearml/data/mongo_4`)
- **Metrics/Logs:** Elasticsearch (`/mnt/storage1/clearml/data/elastic_7`)
- **Cache:** Redis (`/mnt/storage1/clearml/data/redis`)

### 7.2 Elasticsearch Indices

**Total Indices:** 21
**Total Index Size:** ~9.4 GB
**Health Status:** All green

**Largest Indices:**

| Index | Docs | Size | Type |
|-------|------|------|------|
| `events-plot-*` | 14,693 | 8.7 GB | Plot visualizations |
| `events-log-*` | 684,858 | 565.6 MB | Console logs |
| `events-training_stats_scalar-*` | 467,793 | 52.6 MB | Metric time series |
| `events-training_debug_image-*` | 12,496 | 4.3 MB | Debug images |
| `queue_metrics_*_YYYY-MM` | Varies | ~1MB each | Monthly queue metrics |
| `worker_stats_*` | 1,401 | 213.5 KB | Worker telemetry |

**Retention:** No automatic cleanup configured - indices span from **December 2024 to March 2026** (15 months).

### 7.3 MongoDB Collections

**Database:** `backend` (42.6 MB on disk)

| Collection | Documents | Primary Purpose |
|------------|-----------|-----------------|
| task | 260 | Experiment metadata |
| model | 896 | Model registry |
| project | 15 | Project hierarchy |
| queue | 2 | Task queues (GPU/CPU) |
| worker | 0 | Agent registrations |

**Auth Database:** `auth` (110.6 KB) - contains user credentials and sessions

### 7.4 GCP Integration

**Service Account:** `spark-eyes` project
**Credentials File:** `/home/strokmatic/master-infrastructure/clearml/clearml-chave-gcp.json`
**Status:** Present but **not integrated** with ClearML fileserver configuration (no GCS bucket mounts detected)

---

## 8. Queues

### 8.1 Configured Queues

**Total Queues:** 2

| Queue Name | Status |
|------------|--------|
| **Processos com GPU** | Active (empty) |
| **Processos com CPU** | Active (empty) |

**Pending Tasks:** 0 in both queues

### 8.2 Queue Metrics

Elasticsearch contains queue metrics indices tracking:
- Queue depth over time (monthly indices from Dec 2024 - Mar 2026)
- ~17,000 metric records per month
- All metrics show **0 enqueued tasks** - queues exist but are unused

**Reason:** Agent services stopped → no workers polling queues → manual execution only

---

## 9. Integration Status

### 9.1 What's Connected

✅ **Web UI** - Accessible at http://192.168.15.2:9090
✅ **API Server** - Accessible at http://192.168.15.2:8008
✅ **File Server** - Accessible at http://192.168.15.2:8081
✅ **Elasticsearch** - Storing metrics, logs, plots
✅ **MongoDB** - Storing task/model/project metadata
✅ **Redis** - Caching layer operational

### 9.2 What's NOT Connected

❌ **ClearML Agent Services** - Container stopped, no API credentials
❌ **Remote Workers** - No registered agents
❌ **Cloud Storage (GCS)** - Service account present but not configured
❌ **S3/Azure** - No credentials in environment variables
❌ **External Authentication** - Using demo `@test.ai` emails
❌ **Webhooks** - No webhook configurations detected
❌ **Git Integration** - No git credentials in agent config

### 9.3 Pre-Populated Data

ClearML deployment includes **demo/example content** from official ClearML repository:

**Projects:**
- ClearML Examples (Reporting, Pipelines, HPO)

**Tasks:** Example notebooks and scripts
**Models:** Hosted on Allegro's S3 (`allegro-examples.s3.amazonaws.com`)

**Configuration:**
```yaml
CLEARML__apiserver__pre_populate__enabled: "true"
CLEARML__apiserver__pre_populate__zip_files: "/mnt/storage1/clearml/db-pre-populate"
```

This is **standard for new deployments** but consumes ~100MB of storage and 11 tasks in the database.

---

## 10. Issues & Recommendations

### 10.1 Critical Issues

#### 🔴 **Agent Services Not Running**

**Impact:** No automated task execution, no remote experiment orchestration
**Root Cause:** Missing `CLEARML_API_ACCESS_KEY` and `CLEARML_API_SECRET_KEY` environment variables
**Fix:**
1. Generate API credentials from Web UI (Settings → Workspace → App Credentials)
2. Add to docker-compose environment or `.env` file:
   ```bash
   CLEARML_AGENT_ACCESS_KEY=<key>
   CLEARML_AGENT_SECRET_KEY=<secret>
   ```
3. Restart agent-services container:
   ```bash
   docker-compose restart agent-services
   ```

#### 🔴 **No Activity Since July 2025 (8 months)**

**Impact:** System may be abandoned or underutilized
**Recommendation:**
- Verify if ClearML is still needed for current workflows
- Consider archiving if migrated to another platform
- Check if team switched to alternative tools (Weights & Biases, MLflow, etc.)

#### 🔴 **Using Demo Authentication**

**Impact:** All users have `@test.ai` emails - no real email notifications, weak security
**Recommendation:**
- Configure LDAP/SSO integration for production use
- Update user emails to real `@strokmatic.com` addresses
- Enable proper authentication backend in `apiserver.conf`

---

### 10.2 Performance Issues

#### 🟡 **97% of Models Not "Ready"**

**Observation:** 873/896 models are drafts, only 23 marked ready
**Cause:** Tasks stopped/failed before completion, or models not published
**Recommendation:**
- Archive/delete failed experiment models
- Implement model lifecycle: Draft → Staging → Production
- Use `task.mark_completed()` and `model.publish()` in training scripts

#### 🟡 **62% of Tasks Stopped Manually**

**Observation:** 162/260 tasks have "stopped" status
**Recommendation:**
- Investigate why users stop training mid-run (GPU issues? Poor metrics?)
- Add early stopping criteria in code
- Monitor GPU availability and task scheduling

---

### 10.3 Storage & Maintenance

#### 🟡 **No Index Retention Policy**

**Issue:** Elasticsearch indices growing unbounded (15 months of metrics)
**Current Size:** 9.4 GB
**Recommendation:**
- Enable Index Lifecycle Management (ILM)
- Suggested policy:
  - Keep last 90 days in hot tier
  - Move to warm tier after 90 days
  - Delete after 1 year
- Configure in `apiserver.conf`:
  ```yaml
  CLEARML__services__elastic__retention_days: 90
  ```

#### 🟡 **Fileserver Disk Usage**

**Current:** 19 GB (mostly Spot Fusion Plus - 15GB)
**Recommendation:**
- Audit large artifacts in Spot Fusion Plus project
- Delete intermediate checkpoints (keep only best/final models)
- Consider GCS migration for long-term storage (credentials already present)

#### 🟡 **Outdated Agent Services Image**

**Issue:** `allegroai/clearml-agent-services:latest` last updated **4 years ago**
**Recommendation:**
- Check for newer agent image: `allegroai/clearml-agent-services:1.x`
- Update docker-compose to pin specific version (avoid `:latest`)
- Test compatibility with ClearML Server 2.0.0

---

### 10.4 Configuration Recommendations

#### 🟢 **Enable GCP Storage (Optional)**

**Current State:** GCP service account JSON present but unused
**Benefit:** Offload 19GB fileserver to Google Cloud Storage
**Implementation:**
1. Create GCS bucket (e.g., `gs://strokmatic-clearml-artifacts`)
2. Grant `spark-eyes` service account `Storage Object Admin` role
3. Configure fileserver:
   ```yaml
   CLEARML__fileserver__storage__gcs__enabled: "true"
   CLEARML__fileserver__storage__gcs__bucket: "strokmatic-clearml-artifacts"
   CLEARML__fileserver__storage__gcs__credentials: "/opt/clearml/config/clearml-chave-gcp.json"
   ```

#### 🟢 **Git Credentials for Agent**

**Purpose:** Allow agents to clone experiment code from private repos
**Configure:**
```yaml
CLEARML_AGENT_GIT_USER: <username>
CLEARML_AGENT_GIT_PASS: <token>
```
Or use SSH keys mounted to `/root/.ssh/`

#### 🟢 **Resource Limits for Experiments**

**Risk:** Runaway training jobs consuming all GPU/RAM
**Solution:** Configure agent to enforce limits:
```yaml
CLEARML_AGENT_DEFAULT_DOCKER_OPTIONS: "--gpus 1 --memory 16g --cpus 8"
```

---

### 10.5 Security Recommendations

#### 🔴 **Exposed Ports on Public Network**

**Current:** Ports 8008, 8081, 9090 accessible from 192.168.15.2
**Recommendation:**
- If server is exposed to internet, add nginx reverse proxy with SSL
- Enable authentication on all endpoints
- Restrict access to internal network only (firewall rules)

#### 🟡 **No Backup Strategy Detected**

**Risk:** 29GB of experiment data with no apparent backup
**Recommendation:**
- Backup MongoDB daily:
  ```bash
  docker exec clearml-mongo mongodump --out /backup
  ```
- Backup fileserver weekly:
  ```bash
  rsync -av /mnt/storage1/clearml/data/fileserver /backup/
  ```
- Store backups on separate disk or cloud

---

## 11. Deployment Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 192.168.15.2:9090 (Web UI)                                  │
│ 192.168.15.2:8008 (API)                                     │
│ 192.168.15.2:8081 (Files)                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │ Frontend Network      │
         │ 172.24.0.0/16         │
         └───────────┬───────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼────┐     ┌────▼─────┐    ┌────▼──────┐
│Webserver│     │APIServer │    │FileServer │
│ :80     │     │ :8008    │    │ :8081     │
└─────────┘     └────┬─────┘    └─────┬─────┘
                     │                │
         ┌───────────┴────────────────┴──────┐
         │ Backend Network                   │
         │ 172.23.0.0/16                     │
         └───┬──────────┬──────────┬─────────┘
             │          │          │
        ┌────▼───┐  ┌──▼────┐  ┌──▼─────┐
        │Elastic │  │MongoDB│  │ Redis  │
        │ :9200  │  │ :27017│  │ :6379  │
        └────────┘  └───────┘  └────────┘

Storage Layer: /mnt/storage1/clearml (29GB)
  ├── data/
  │   ├── elastic_7/      (9.4GB - metrics, logs, plots)
  │   ├── fileserver/     (19GB - artifacts, models)
  │   ├── mongo_4/        (542MB - metadata)
  │   └── redis/          (8KB - cache)
  ├── logs/               (67MB)
  └── agent/              (empty - no active agents)

NOT RUNNING:
  ┌─────────────────┐
  │ Agent Services  │ ❌ Missing API credentials
  │ (Exited)        │
  └─────────────────┘
```

---

## 12. Summary Statistics

| Metric | Value |
|--------|-------|
| **Total Storage** | 29 GB |
| **Projects** | 15 (3 active, 12 demo/examples) |
| **Tasks** | 260 (91.9% training) |
| **Models** | 896 (81% PyTorch) |
| **Users** | 5 human + 5 system accounts |
| **Active Workers** | 0 |
| **Queues** | 2 (both empty) |
| **Last Activity** | July 1, 2025 (8 months ago) |
| **Deployment Age** | ~15 months (first demo task: Apr 2021) |
| **Container Uptime** | 2 weeks (last restart: ~Feb 27, 2026) |

---

## 13. Action Items Priority Matrix

### Immediate (This Week)
1. ✅ Verify if ClearML is still in use - contact team leads
2. ✅ Restart agent-services with API credentials (if active)
3. ✅ Update user emails from `@test.ai` to `@strokmatic.com`

### Short-term (This Month)
4. Archive/delete stopped/failed tasks older than 6 months
5. Implement Elasticsearch ILM policy (90-day retention)
6. Set up MongoDB backup script (daily cron)
7. Update agent-services image to latest stable version

### Long-term (Next Quarter)
8. Migrate fileserver storage to GCS (use existing service account)
9. Configure LDAP/SSO authentication
10. Add nginx reverse proxy with SSL termination
11. Document team workflows and model registry conventions
12. Consider upgrade to ClearML Server 3.x (if available)

---

## Appendix A: Environment Variables

**API Server:**
```yaml
CLEARML_ELASTIC_SERVICE_HOST: elasticsearch
CLEARML_ELASTIC_SERVICE_PORT: 9200
CLEARML_MONGODB_SERVICE_HOST: mongo
CLEARML_MONGODB_SERVICE_PORT: 27017
CLEARML_REDIS_SERVICE_HOST: redis
CLEARML_REDIS_SERVICE_PORT: 6379
CLEARML_SERVER_DEPLOYMENT_TYPE: linux
CLEARML_SERVER_VERSION: 2.0.0
CLEARML_SERVER_BUILD: 613
CLEARML__apiserver__pre_populate__enabled: true
CLEARML__services__async_urls_delete__enabled: true
```

**Agent Services (Missing):**
```yaml
CLEARML_API_ACCESS_KEY: ❌ NOT SET
CLEARML_API_SECRET_KEY: ❌ NOT SET
CLEARML_AGENT_GIT_USER: ❌ NOT SET
CLEARML_AGENT_GIT_PASS: ❌ NOT SET
```

---

## Appendix B: Access URLs

- **Web UI:** http://192.168.15.2:9090
- **API Endpoint:** http://192.168.15.2:8008
- **File Server:** http://192.168.15.2:8081
- **API Documentation:** http://192.168.15.2:8008/docs (Swagger UI)

---

## Appendix C: Disk Space Projection

**Current Usage:** 29 GB (on 2.7TB disk)
**Growth Rate:** Unknown (no activity since July 2025)

**Estimated Capacity:**
- **Conservative:** Can store ~2,000 more experiments at current avg. size
- **With GCS migration:** Unlimited (offload artifacts to cloud)
- **Time to full:** Not applicable (no active usage)

**Recommendation:** Enable monitoring and alerts at 80% disk usage if ClearML becomes active again.

---

**Report Generated By:** JARVIS Orchestrator
**Data Sources:** Docker inspect, MongoDB queries, Elasticsearch API, SSH filesystem analysis
**Analysis Duration:** 15 minutes
**Data Accuracy:** As of 2026-03-13 23:56 UTC
