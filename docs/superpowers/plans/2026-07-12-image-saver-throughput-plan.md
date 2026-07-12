---
type: Implementation Plan
title: VisionKing image-saver — Throughput 300 fps — Implementation Plan
description: Executar em 3 fases o fix de throughput do image-saver (conexão AMQP persistente no sync, conserto do runner async, validação por burnin em bancada) até canary vk02→vk01 e atualização dos topologies.
tags: [visionking, image-saver, throughput, rabbitmq, aio-pika, burnin, "03002"]
timestamp: 2026-07-12
project: "03002"
product: VisionKing
language: pt-BR
status: draft
---

# VisionKing image-saver — Throughput 300 fps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps usam checkboxes `- [ ]`.

**Goal:** Elevar o teto do image-saver de ~150 fps para ≥300 fps sustentados (75 fps × 4 câmeras) sem mudar o wire format, e deixar o runner async funcional como caminho default.

**Spec:** `docs/superpowers/specs/2026-07-12-image-saver-throughput-design.md`

**Repo:** `strokmatic/visionking-image-saver` (fora do dev-bot; base `develop`). PR relacionado já aberto: #75 (drop-None).

**Bancada:** vk01/vk02 (harness `/opt/burnin`, modo fixed/saturation; padrão canary preupgrade+yml `.bak`).

---

## Fase 1 — Conexão persistente no publisher sync (quick win)

- [ ] 1.1 Branch `feat/persistent-rabbit-connection` a partir de `develop`
- [ ] 1.2 Teste (TDD): mock de `pika.BlockingConnection` contando instâncias — N `send_message` na mesma thread devem criar **1** conexão; simular `StreamLostError` no publish e verificar reconexão + retry
- [ ] 1.3 Implementar `threading.local()` no `RabbitClient`: conexão+channel reusados; `queue_declare` 1× por (thread, fila) com cache em set; invalidação on-error
- [ ] 1.4 Rebaixar logs "Attempting/Successfully connected" para DEBUG (INFO apenas em reconexão pós-falha)
- [ ] 1.5 Suíte completa verde (`pytest tests/` — 10 testes atuais + novos)
- [ ] 1.6 PR → develop; review

## Fase 2 — Conserto do runner async (alvo definitivo)

- [ ] 2.1 Branch `fix/async-runner-event-loop`
- [ ] 2.2 Teste (TDD): reproduzir o no-op — `main_async` decorado deve **executar o corpo** (hoje falha: coroutine criada e descartada em `loop_timer.py:14`)
- [ ] 2.3 `enforce_time_limit` async-aware (`inspect.iscoroutinefunction` → wrapper `async` com `await func(...)` + `asyncio.sleep`)
- [ ] 2.4 Mover `rabbit_client.connect()/close_connection()` para fora do loop (1 conexão robusta por processo, não por iteração)
- [ ] 2.5 HMGET pesado + gravação do `.bin` via `asyncio.to_thread` (payload ~0,5 MB/frame não pode bloquear o event loop)
- [ ] 2.6 Validar caminho PLY (`has_ply`) com caso de teste dedicado
- [ ] 2.7 Teste de equivalência de payload: consumer fake compara byte a byte a mensagem do runner sync vs async (dict-repr preservado)
- [ ] 2.8 PR → develop; review

## Fase 3 — Build + validação em bancada + canary

- [ ] 3.1 Build `visionking-image-saver:2026.08` e push ao Artifact Registry
- [ ] 3.2 Canary **vk02** (padrão preupgrade + `.bak` do yml): runner sync F1 primeiro
- [ ] 3.3 Burnin `--mode fixed --fps 300` por 2 h: aceite = db0 estável (<5k keys), 0 expiração por TTL, frames/s=300 no Postgres
- [ ] 3.4 Trocar `command:` para o runner async (F2) no vk02 e repetir 3.3
- [ ] 3.5 Burnin `--mode saturation` 1 h: aceite = teto medido ≥400 fps
- [ ] 3.6 Kill-test: `docker restart rabbitmq` durante o fixed — aceite = reconexão automática, sem crash, sem perda (delta frames = delta injetado). Exercitar também o padrão **idle-then-publish** (entry parado no pool > 60s com heartbeat 30 → publish): sem confirms, há janela teórica de perda em socket half-open; se o teste mostrar perda, adotar `confirm_delivery()`
- [ ] 3.7 Replicar no vk01; soak conjunto ≥12 h
- [ ] 3.8 Promover async a default (`CMD` do Dockerfile) OU manter override por `command:` — decidir com base em 3.4-3.7

## Fase 4 — Propagação de config

- [ ] 4.1 Remover `cpus: "0.9"` dos templates/topologies do monorepo (bancada já corrigida em 2026-07-12)
- [ ] 4.2 Atualizar `scripts/canary/deployments/` no JARVIS (cópias de referência) com filas novas + imagem 2026.08
- [ ] 4.3 Changelog (`Keep a Changelog`) + journal + fechar issue

## Riscos & rollback

- Rollback por fase: yml `.bak` + container preupgrade (padrão já estabelecido na bancada)
- Half-open TCP na VPN/planta: coberto pelo heartbeat=30 + kill-test 3.6
- Se F2 atrasar, F1 sozinha (~230-280 fps projetados) já dá margem sobre a média real (~136 fps) — decidir go/no-go do deploy parcial após 3.3
