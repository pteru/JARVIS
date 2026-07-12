# Changelog - sdk-line-twin

All notable changes to the sdk-line-twin workspace.

Format: [Keep a Changelog](https://keepachangelog.com/)

## 2026-07-12

### Added — Fases 0–1
- Fases 0–1 do gêmeo virtual de linha (modo pure-sim), branch `feat/v1`:
  parser L5X (`sim_core/logix/l5x_parser.py`) + tag DB bytes-backed com
  layout de UDT padded (`tagdb.py`, `datatypes.py`) + interpretador RLL+ST
  (`rll.py`, `st.py`, `instructions.py`) com falha ruidosa em instrução não
  suportada; `Controller` (`controller.py`) fazendo scan Logix multi-rotina
  via namespace flat de JSR; `DriveModel` CiA-402 (PP/PV, halt, touch-probe,
  counts↔mm) + `IoMap` bridging bytes AnyBusComm:I/O (`plant/drive.py`,
  `plant/iomap.py`); `SimSession` (`session.py`) amarrando tudo num loop
  tickável (`poke`/`read`/`run_ms`) sobre o perfil `profiles/iris-03007`
  (exports reais do controlador IRIS 03007 v5: `Servo_Program`,
  `MainProgram_Program`, `R003_Faults`, `R030_ManualMotion`,
  `R031_Homing`). 131 testes (130 passed + 1 xfail estrito) incluindo a
  suíte de regressão `tests/regression/test_jog_homing.py` (jog contínuo com
  deadman, homing global, gate de permissivo manual).
- Três achados reais do programa v5, provados por teste e documentados no
  README: (1) tags de status do eixo 1 declaradas sem sufixo numérico nos
  exports enquanto o ST de `Servo1` as referencia com sufixo `1` —
  inconsistência de exportador, sem impacto funcional; (2) o COP de entrada
  real copia o tamanho padded do struct ladder (24 B) em vez da janela
  física de 21 B, corrompendo de forma benigna a cauda do campo
  `DigitalInputs`; (3) `TouchProbeFunction` cai no offset padded 8 do UDT de
  saída, fora da janela física de 8 bytes que o COP de saída realmente
  envia ao drive — o arm do probe de referência nunca cruza o fio, e o
  homing **não completa na máquina real** com o programa v5 como está.

### Added — Fase 2
- MainProgram completo do Willer emulado via `SimSession` sob pacote
  `jobdata` v2 normalizado; LinePlant declarativa com invariantes de contrato
  (portas automáticas, gating, esteira, carro, barreiras); DSL YAML de
  cenários (`sim_core/scenarios/`) com poke/run/assert, suportado pelo
  `sim_core.scenarios.runner` (execução isolada via CLI);
  modularização I/O (load patches, pré-fatos, AnyBusComm:I/O ↔ jobdata);
  5 cenários de regressão de linha completa.
- Dois novos achados (4–5): (4) R020 jobdata sem gate de modo — ciclo
  automático ativo mesmo em MANUAL (gate real = `R020_MIRROR.0 ∧ R011_STEP.1 ∧ B01`);
  achado de projeto — requer decisão sobre responsabilidade
  (inversor vs. Willer); (5) R006 recovery de heartbeat em 1 beat vs.
  4 beats do contrato §1.3 — propriedade estática, documentada em
  `tests/scenarios/test_lineplant.py` com cenário `heartbeat-timeout.yaml`
  (sentinela invertido proposital); nota: `GMHb_TimeoutScans` deve ser
  derivado do período REAL da task, senão timeout real não será alcançado.
- Total de testes: 214 passed + 1 xfail (84 novos testes Fase 2).

### Added — Fase 3
- Bridge Redis via contrato `strokmatic-eip` (tags `/cmd:/audit:/simctl:`) —
  publica métricas (rpm, posições, status de drives) e consome comandos
  (jog, homing, modo) em namespace flat editável.
- Gateway FastAPI+WS (`sim_core/gateway/`) com stream JSON de WSCmd (jog,
  jog-refresh, homing, mode) e WSState (frame, linecars, binding) pré-
  serializados; runtime `python -m sim_core.live <profile> --fake :8600`
  rodando SimSession + bridge embutidos.
- Painel 3D (Vite+TS+Three.js+Playwright E2E) — renderiza IRIS
  parametricamente a partir do `binding.json`; cena data-driven (chão, linha,
  pórtico, caixas-eixo, sensores); HUD de jog com deadman real; spawn de
  carros; editor de binding com linter. Smoke E2E via Playwright
  (`panel/tests/e2e/**/*e2e.test.ts`; 5 testes, real WS handshake + jog path
  validated). Escala: 1 unidade de cena = 100 mm.
- Ingestão STEP/GLB + binding.json linter (validação de UDT/offset/types);
  achado: nomes de OCAF em `PROVENANCE.md` (mapeamento render é Fase 5).
- Novo achado (6): painel WS jog-refresh lento (250 ms) engolia buffer jog —
  WSCmd_Jog sobrescrito por próxima refresh. Detectado via smoke E2E;
  solução: jog_buffer é queue (FIFO) + drain, não map. Validação cruzada:
  twin simula + painel executa + bridge vê transição esperada.
- Testes: 284 + 1 xfail (70 novos testes: 19 vitest panel + 5 E2E Playwright +
  46 novos testes sim_core).

### Added — Fase 4 (HIL software-completa)
- Golden rig instrução-a-instrução: `scripts/golden/cases.py` (33 casos,
  26 RLL + 7 ST, fonte única espelhando a semântica do interpretador) +
  `gen_golden_l5x.py` determinístico gerando `GoldenRig.L5X` (dispatch
  `G_Select`/`G_Done`), com round-trip obrigatório: o L5X gerado parseia e
  passa 33/33 no próprio interpretador. ONS/timers/RET/MSG excluídos com
  rationale documentada.
- Harness pylogix (`tests/golden/test_golden_vs_plc.py`, `@pytest.mark.golden`,
  skip limpo sem `L19ER_IP`): escreve inputs → seleciona caso → poll `G_Done`
  → compara outputs (INT exato, REAL 1e-4), relatório rico de divergência,
  reset do handshake em `finally`; `select_index()` compartilhado com o
  gerador + teste CI-safe pinando índices ao L5X commitado.
- GM-sim para o L19ER físico: `scripts/gm_sim/gen_gm_sim_l5x.py` gera
  `GMSimBench.L5X` (UDTs extraídos programaticamente dos L5X do perfil,
  R090 em ST fiel, heartbeat via TONR de 500 ms reais em vez de contador de
  scans) com guard de proveniência contra drift do R090 e round-trip no
  Controller.
- Relay GM→IRIS (`sim_core/relay.py`): re-emite mudanças do hash do
  tag-client GM como `cmd:<iris_key>` class `config` (dedupe por valor,
  bootstrap flood deliberado no primeiro ciclo, validação ruidosa do mapa
  no load); entrypoint `python -m sim_core.relay`.
- `deploy/hil/`: `gen_configs.py` (bridge.json + hil.json → configs no schema
  real do tag-client da strokmatic-eip), docker-compose (redis + 2× tag-client
  + gateway + relay; instalação via cópia p/ /app preservando mount `:ro`,
  live-tested), `hil.example.json`; `docs/hil-runbook.md` com plano de rede,
  import dos dois programas (coexistência GoldenProgram/GMSimProgram no mesmo
  controlador), validação redis-cli e checklist de 8 passos; smoke HIL
  `test_hil_smoke.py` (heartbeat vivo + liveness do relay, opt-in
  `HIL_REDIS_URL`).
- Total: 352 passed + 1 xfail (36 golden deselected por default). Validação
  física na bancada pendente (única parte que requer hardware).
