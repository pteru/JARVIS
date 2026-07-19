---
type: journal
title: "visionking-result#83: advisory lock no heartbeat — execuções sobrepostas estrangulavam writers"
description: "Issue #83 trabalhada fim a fim via subagents: levantamento (vk-producao-specialist), implementação TDD (advisory lock _xact_ na função SQL, skip-if-running, statement_timeout, yml sync), commits em fix branches nos 3 repos e comentário na issue; sem PR, issue aberta"
tags: [vk-result-heartbeat-lock, vk-producao, visionking, "03002"]
timestamp: 2026-07-13
project: "03002"
product: VisionKing
language: pt-BR
status: done
---

# 2026-07-13 — visionking-result#83: advisory lock no heartbeat

## Feito
- **Levantamento (vk-producao-specialist)**: heartbeat em `services/result/src/main.py:45-59` é síncrono/bloqueante numa thread — **uma instância não se sobrepõe a si mesma**; as 5 queries simultâneas do evento implicam múltiplos containers (precedente: zumbis `restart=always` do retorno à planta no mesmo dia). `FOR UPDATE SKIP LOCKED` já presente explica coexistência sem conflito: cada cópia pega lote diferente de 50 peças.
- **Fix 1 (visionking-setup)**: `pg_try_advisory_xact_lock(hashtext('process_regras_complete_batch'))` como primeira instrução de `fn_process_regras_complete_batch.sql`; espelhado na cópia e2e (`tests/e2e/steel/sql/05-functions.sql`, md5-idênticos); novo `update-scripts/update_db_2026.07.sql` p/ aplicação manual vk01/vk02.
- **Fix 2-3 (visionking-result)**: `heartbeat_tick()` com lock não-bloqueante (skip + warning) e `get_db_connection(statement_timeout_ms=)` só no heartbeat (`DB_HEARTBEAT_STATEMENT_TIMEOUT_MS`, default 60s); `main_loop` inalterado.
- **Fix 4**: `visionking-result.yml` de referência sincronizado (estava na função antiga `process_regras_queue_batch`, INTERVAL=5, args que nem parseavam como JSON).
- **TDD real**: red (4 failed) → green (5 passed) em `tests/test_heartbeat.py`; validação live do lock em postgres:15 efêmero (sessão B retorna 0 rows em 72ms enquanto A segura o lock; libera no commit).
- **Commits em fix branches** (aprovados por Pedro, sem push): `fix/heartbeat-overlap-issue-83` (result, base develop), `fix/advisory-lock-process-regras-83` (setup, base origin/develop — não o feat/obb), `fix/heartbeat-lock-e2e-83` (monorepo, base feat/display-01 — checkout p/ develop bloqueado por .gitmodules sujo).
- **Comentário na issue #83** com achado + fixes + evidência; issue segue aberta, sem PR.

## Decisões
- Nome do update script = `update_db_2026.07.sql` (decisão do Pedro; alinhado ao versionamento da stack, não à série c0XX).
- Variante `_xact_` do advisory lock (libera no commit/rollback, sem unlock manual — sem leak em exceção).
- Skip-if-running no Python documentado como redundância (não resolve overlap entre containers).
- vk-producao-specialist recusou implementar (classe read-only, correto) → implementação redespachada a general-purpose com o contexto do levantamento.

## Pendências
- Aplicar `update_db_2026.07.sql` nos Postgres de vk01/vk02 (corta o problema na planta antes de imagem nova).
- Rebuild da imagem do result (fixes Python só chegam com imagem nova; produção roda `c014`, commit não mapeado — `docker inspect` label `commit_sha` no vk01).
- Confirmar hipótese dos zumbis no próximo pico: `docker ps -a | grep visionking-result` no vk01.
- Push dos 3 fix branches + PRs (aguardando revisão do Pedro); monorepo branch carrega commits do feat/display-01.
- Re-olhar crashes históricos do result (mai-jun/2026, atribuídos a OOM) à luz desta causa raiz; adicionar o caso ao troubleshooting.md e a "Problemas Conhecidos" de `servicos/result.md` na KB.

## Links
- Issue: https://github.com/strokmatic/visionking-result/issues/83 (comentário: issuecomment-4962375088)
- Irmã: strokmatic/visionking-image-saver#76 (throughput image-saver)
- Journal relacionado: [[2026-07-13-retorno-planta-03002]], [[2026-07-12-vk-burnin-image-saver-throughput]]
