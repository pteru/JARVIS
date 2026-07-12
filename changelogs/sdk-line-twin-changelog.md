# Changelog - sdk-line-twin

All notable changes to the sdk-line-twin workspace.

Format: [Keep a Changelog](https://keepachangelog.com/)

## 2026-07-12

### Added
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
