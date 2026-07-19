---
type: journal
title: "VK bancada: rename de filas, NoneType do part_uuid, caches TRT OBB e gargalo do image-saver"
description: "Madrugada de bancada vk01/vk02: filas renomeadas por consumer, causa raiz do NoneType (part_uuid ausente propagado pelo image-saver), caches TRT OBB persistidos, burnin fixed 150fps estável e spec+plan+issue do throughput 300fps"
tags: [vk-burnin-image-saver-throughput, vk-producao, visionking, "03002"]
timestamp: 2026-07-12
project: "03002"
product: VisionKing
language: pt-BR
status: done
---

# 2026-07-12 — VK bancada: filas, NoneType, TRT e gargalo do image-saver

## Feito
- **Rename de filas (task #74)**: `is/dw/rc-sis-surface-queue` → `inference-queue`/`frame-queue`/`result-queue` nos 2 hosts (ymls, autoscaler rules, burnin profile); filas antigas deletadas. Atenção: descrição da task tinha is/dw invertidos — mapeamento correto validado por consumers ao vivo.
- **NoneType do result_handler resolvido na raiz**: image-saver pedia `part_uuid`/`part_press_tracking` no HMGET (patch #68), hash vk-steel só tem `bar_*` → `None` propagado no payload → DataError no streaming Redis do visualizer. Fix 1: env `HASH_FIELDS` sem `part_*` no vk02 (vk01 nunca teve). Fix 2: drop-None nos processors → PR visionking-image-saver#75 (mergeável, 10/10 testes).
- **Caches TRT OBB persistidos** nos 4 inference (A/B × 2 hosts): dirs eram root-only e o ORT falhava silencioso a escrita (containers rodam uid 1000) — chown + compile um-por-vez; B carrega engine copiado do A em 2-4 s.
- **Regressão pega pelo burnin**: recreate do frame-writer vk01 usou yml stale (jul/5) → downgrade p/ `dev-...:c013` que quebra com bytes (`TypeError`); frames pararam 02:07. Ymls corrigidos p/ `visionking-database-writer:2026.07`.
- **Gargalo do image-saver quantificado**: teto ~150-165 fps (latency-bound: 1 conexão AMQP por mensagem, idêntico ao c007); cap de CPU 0.9 removido dos ymls; runner async é no-op (`enforce_time_limit` descarta coroutine sem await — `loop_timer.py:14`).
- **Burnin fixed 150 fps** rodando estável nos 2 hosts (todos os estágios em 150/s, zero acúmulo); classe `risco_aprova` (80% dos defeitos vk01, boxes brancas no visualizer) removida do `DEFECT_CLASSES`.
- **Spec+plan commitados** (`2026-07-12-image-saver-throughput-{design,plan}.md`) e **issue visionking-image-saver#76** aberta com as 4 fases.
- **Reboot-safety**: 24 containers antigos parados com restart=always (ressuscitariam) → `restart=no`; stack novo todo em always/unless-stopped; `burnin-injector.service` disabled; cron one-shot 05:30 para parar injector + limpar resíduos.

## Decisões
- Filas nomeadas pelo consumer (inference/frame/result) — nomes da task #74, mapeamento corrigido.
- `risco_aprova` filtrada via env (não rules.json); mapping mantém `:7` p/ reativação fácil.
- Burnin "condição normal" = 150 fps totais (média real da planta c/ duty cycle ~45%); 300 fps de pico vira meta do rebuild (issue #76).
- Engines TRT antigos preservados (ORT ignora por hash de grafo).

## Pendências
- Merge PR #75 + executar issue #76 (fases 1-4) → build 2026.08.
- Rebuild inference: flatten OBB + streaming NoneType guard (hotfix montado só no vk02-A) + msg enganosa "Speed field not found" (zero ≠ ausente).
- Proc hotfix (flat + list-of-list) precisa ir no pacote de migração dos nós.
- Sync `scripts/canary/deployments/` no JARVIS (filas novas, imagem 2026.08).
- 05:30: conferir `~/burnin-stop-0530.log` nos 2 hosts (parada+limpeza agendada).

## Links
- specs/plans: `docs/superpowers/{specs,plans}/2026-07-12-image-saver-throughput-*.md`
- PR: strokmatic/visionking-image-saver#75 · Issue: #76
- [[2026-07-11-obb-pipeline-support-design]] · task #61 (soak) segue in_progress

## Adendo (manhã) — Execução SDD das Fases 1-2 + PR #77

- **SDD executado** (subagent-driven): Fase 1 = pool de conexões no `RabbitClient` sync (3 commits; desvio sancionado do plano — `threading.local` seria inócuo pois `hash_processor.py` cria executor POR HASH; achado do reviewer). Fase 2 = runner async consertado (decorator async-aware, connect-once, `to_thread`, paridade byte a byte sync↔async).
- Review whole-branch (Fable): 1 must-fix (mean_time sem limite) + heartbeat async + log de exceções do gather — fix wave única. **35/35 testes**.
- **PR #77 aberto** (stacked sobre #75). Item gated p/ Fase 3: kill-test 3.6 com padrão idle-then-publish (possível `confirm_delivery()`).
- Lição de processo: agente travou rodando teste que reproduz loop infinito do próprio bug — retomado via mensagem com método corrigido (pytest sob `timeout` + exceção-sentinela).
