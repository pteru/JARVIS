---
type: journal
title: "IRIS 03007 — painel de bancada touchscreen (iris-bench-panel)"
description: "Novo repo Vite+Vue3+FastAPI para comissionamento do PLC v5.5: jog/step/homing/modos/jobdata/config, validando comms Classe 1/Classe 3 pelos caminhos reais + leitura DIRECT só onde não há mapeamento"
tags: ["iris-bench-panel", "iris-scds", "03007", "plc", "vue", "fastapi", "redis", "pylogix"]
timestamp: 2026-07-12
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# IRIS 03007 — painel de bancada touchscreen (iris-bench-panel)

## Feito

- Criado repo local `workspaces/strokmatic/sdk/iris-bench-panel` (commit inicial `f184716`, master): painel touchscreen para testar o programa PLC v5.5 na bancada.
- Backend FastAPI (`backend/app.py`) com 3 rotas de transporte espelhando a operação real (contratos v0.99.2):
  - HOT = stream Redis `cmd:<key>` classe *motion* + hash `tags:<key>:hot` (Classe 1 via hot-bridge)
  - COLD = mesma stream classe *config* + hash `tags:<key>` com staleness por `updated_at` (Classe 3 / Fase A)
  - DIRECT = pylogix, **somente** tags sem mapeamento na stack base (Ramp.*, EnableState, R0xx_STEP) — regra do pedido
- Deadman triplo no jog: frontend re-envia a cada 150 ms (pointerdown/up) → backend TTL 400 ms zera o jog → PLC ainda tem `WSCmd_JogRefresh`.
- `/api/cfg` com read-back (regra 2-b do contrato): escreve, faz poll 2 s e devolve `verified` ✓/✗.
- Tela **Comms**: heartbeat do adapter, staleness por rota, p95 de escrita, eco `Cmd_Seq→LastCmdSeq` por eixo (regra 6-v) e botões de prova-de-caminho por rota.
- Frontend Vite+Vue3+TS, 5 telas: Operação (4 AxisCards hold-to-run + sensores), Comms, Jobdata (GMSim inject job/car B01), Config (Cfg por eixo com read-back), Diagnóstico (alarmes first-out, internals DIRECT, inspector raw).
- Modo `--mock`: bancada virtual (4 eixos cinemáticos, ciclo, init, falhas, idades realistas por rota) — UI inteira funciona sem PLC/Redis. Demo validada em `http://localhost:8300`.

## Decisões

- Stack Vite+Vue3 confirmada pelo Pedro após mock HTML; refinamento em multi-telas aprovado.
- Validar C1/C3 **pelos mesmos caminhos da operação** (streams/hashes Redis), não por leitura direta — DIRECT restrito ao não-mapeado.
- MockPlant: soltar o jog força `target=pos` (equivalente ao Halt bit8 da Seção 3), senão o alvo distante continuava puxando o eixo após o deadman.

## Pendências

- Testar contra Redis + PLC reais na bancada (config.yaml: `plc_key iris01`, `plc_ip 192.168.1.12` — ajustar).
- Repo ainda só local (sem remote GitHub); decidir se vira `strokmatic/iris-bench-panel`.
- Hot-bridge Fase B ainda não roda na bancada — rota HOT cai em timeout até lá (esperado; a tela Comms mostra).

## Links

- Repo: `workspaces/strokmatic/sdk/iris-bench-panel` (README com instruções mock/real)
- Contratos: `pmo/projects/03007/specs/` (v0.99.2) · programa v5.5: `pmo/projects/03007/handoffs/2026.07.12_update-jog-homing-v5.5/`
- Entradas irmãs do dia: [[2026-07-12-iris-plc]], [[2026-07-12-iris-ws]]
