---
type: Session Log
title: 2026-07-09 — autoscaler — sdk-autoscaler v0.1 do design ao deploy oficial nos 2 benches VK
description: Novo repo strokmatic/sdk-autoscaler bootstrapped como cross-product SDK (não VK-specific); MVP com 30 testes; Cloud Build no projeto strokmatic-sdk; imagem 2026.07 rodando em vk01+vk02 substituindo systemd legacy; ciclo scale-up/down validado em produção.
tags: [autoscaler, sdk, visionking, cloud-build, docker, rabbitmq]
timestamp: 2026-07-09
session: autoscaler
language: pt-BR
---

# 2026-07-09 — autoscaler

## Contexto

Sessão continuou trabalho de tuning do pipeline nos benches vk01/vk02 (ArcelorMittal, imagem `visionking-inference:2026.07`) e evoluiu para produtizar o autoscaler que existia como systemd script local (`inference-autoscaler.service`) para um serviço genérico versionado.

## Feito

- **Validação end-to-end do autoscaler original** (systemd) pela ideia do usuário: pré-acumular `is-sis-surface-queue` >15k, T0=start inference-A → scale-up em 11s, drain, scale-down em ~3min. Recovery-mode disparou naturalmente num dos testes. Confirmou o design da state machine (histerese + cooldown + recovery).

- **Repo `strokmatic/sdk-autoscaler`** criado zero-a-um, seguindo convenção `sdk-*` da org (cross-product, não visionking-*):
  - Pydantic v2 config schema com `${VAR}` interpolation e cross-field validation
  - Monitor(ABC) + RabbitMQ impl, Target(ABC) + docker impl
  - Controller single-threaded com rule isolation, cooldowns, recovery
  - Prometheus metrics (backlog, publish_rate, deliver_rate, target_running, actions_total)
  - 30 testes pytest (config, monitors, targets, controller — todos os edge cases)
  - Dockerfile python:3.11-slim, non-root UID 10001, tini
  - 8 commits lógicos: scaffold → config → monitors → targets → controller → main+metrics → tests → infra
  - README, DESIGN.md (arquitetura + security), docs/configuration.md, docs/release.md
  - 3 config-examples (minimal, visionking-inference, multi-rule)

- **Descoberta arquitetural durante deploy**: container UID 10001 não acessa `/var/run/docker.sock` sem `--group-add "$(getent group docker | cut -d: -f3)"`. Documentado em DESIGN + compose + README.

- **Fatorial 2⁴ pra otimizar is-sis-surface** (bloco anterior mas relevante): CPU (0.9/4) × threads (20/60) × storage (disk/tmpfs) × IPL (300/1000). Winner: CPU=4 + IPL=1000 (231 msg/s +42% baseline). Aplicado nos 2 benches. Efeito principal: **CPU +40 msg/s**, IPL +32; tmpfs -7 (surpreendente); threads +5.6 (desprezível).

- **Migração build para `strokmatic-sdk`**: usuário criou GH connection nesse projeto (não sis-surface). Também criou Artifact Registry `southamerica-east1/strokmatic-images` (não sis-surface/sis-surface). Cloudbuild.yaml atualizado, `gcloud builds submit --project strokmatic-sdk` OK em 1m9s.

- **Deploy oficial nos 2 benches** com imagem `southamerica-east1-docker.pkg.dev/strokmatic-sdk/strokmatic-images/sdk-autoscaler:2026.07`:
  - Digest `sha256:84924ae31dc6...` idêntico nos 2
  - Legacy `inference-autoscaler.service` disabled permanente
  - Container `strokmatic-autoscaler` com restart:unless-stopped, --group-add DOCKER_GID, mounts (socket, rules.yaml, /etc), 256M/0.2 CPU
  - Rules per-bench: vk01 rate_max=147, vk02 rate_max=105 (capacity × 0.7)

- **Validação com imagem oficial nos 2**:
  - vk01: scale-UP 17:41:10 (backlog=8528, rate=162), scale-DOWN 17:44:30
  - vk02: scale-UP 17:50:00 (backlog=8593, rate=173), scale-DOWN 17:53:30

- **Integração com VK topology-configurator** (working tree do repo VK, sem commit ainda):
  - `docker-compose.yml`: bloco `autoscaler` service
  - `.env.example`: `AUTOSCALER_IMAGE_TAG=2026.07`, `AUTOSCALER_RULES_PATH`, `DOCKER_GID`
  - `service_catalog.py`: `_AUTOSCALER` entry na categoria tools
  - `topologies/{laminacao,carrocerias,sparktest}-single-node.yaml`: `autoscaler: enabled: false` (opt-in)
  - `doc/autoscaler.md` + `deployments/autoscaler-rules.yaml.example`

## Decisões

- **`sdk-autoscaler` como SDK cross-product**, não `visionking/services/autoscaler`. Repos `sdk-*` da org (sdk-lib-logging, sdk-lib-rabbit-client, sdk-observability-stack) são o padrão pra componentes reusáveis. Uma imagem, N configs — cada produto (VK, SpotFusion, DieMaster, Sealer) tem sua rules.yaml.
- **1 container, N regras** (não N containers): connection pool compartilhado, footprint menor, isolamento de regras via try/except no controller.
- **`--group-add DOCKER_GID` runtime** em vez de baked-in no image (GID varia por host — 999 Ubuntu, diferente em RHEL). Documentado no DESIGN.
- **Calendar release YYYY.MM** em vez de semver puro. Semver interno em `pyproject.toml`.
- **`$COMMIT_SHA` só popula em trigger builds**, manual submit precisa `--substitutions=COMMIT_SHA=$(git rev-parse HEAD)`. Descoberto na hora, documentado em release.md.
- **Substituições Cloud Build em `images:` block não são avaliadas** — hardcoded o tag `2026.07` nos 3 lugares em vez de templatizar. Commit 64e8073 documenta a razão.

## Pendências

- **Auto-trigger GH → Cloud Build**: `gcloud builds triggers create github` retorna 400 genérico apesar do repo estar conectado. Precisa criar manualmente via console: https://console.cloud.google.com/cloud-build/triggers?project=strokmatic-sdk → Create Trigger → GitHub → `strokmatic/sdk-autoscaler` → branch `^master$` → `infra/gcp/cloudbuild.yaml`.
- **Commit dos 8 arquivos do VK repo** (working tree feat/display-01 tem changes pré-existentes que impedem checkout limpo). Instrução no report final da sessão. Backup em `/tmp/autoscaler-vk-changes/`.
- **Trigger 2ⁿᵈ gen no strokmatic-sdk** — nenhum connection listado por CLI em nenhuma região. UI setup precisa ser finalizado ou re-feito.
- **`--group-add "${DOCKER_GID}"` no compose** funciona só com `DOCKER_GID` exportado. Runbook do VK deve automatizar essa export antes do `docker compose up`.
- **Monitors futuros** (roadmap DESIGN.md): `redis_queue` (DBSIZE), `prometheus_metric` (PromQL), `custom_command`. **Targets**: `docker_compose_scale` (N replicas), `systemd_service`, `k8s_replica`.
- **Segurança**: docker socket exposição = root efetivo. Mitigação `docker-proxy` allowlist documentada como deferred (v2).

## Links

- Repo: `strokmatic/sdk-autoscaler` (branch master)
- Imagem: `southamerica-east1-docker.pkg.dev/strokmatic-sdk/strokmatic-images/sdk-autoscaler:2026.07`
- Build project: `strokmatic-sdk` (submit manual via gcloud CLI)
- Docs canônicos: `sdk-autoscaler/README.md`, `sdk-autoscaler/DESIGN.md`, `sdk-autoscaler/docs/configuration.md`, `sdk-autoscaler/docs/release.md`
- VK integration doc: `visionking/doc/autoscaler.md` (uncommitted)
- Memory: `reference_sdk_autoscaler.md`, `feedback_burnin_purge_all_queues.md`
