---
type: journal
title: "sdk-servo-toolkit — 3 módulos de mapeamento de fieldbus (EtherCAT, EtherNet/IP, PROFINET)"
description: "IRIS/03008: ferramentas Python test-first p/ mapear os dois lados do gateway ABC3107 e o Delta B3A — el8ec-ecat (pysoem), eip-probe (pycomm3/eeip), pnet-probe (pnio_dcp/PROFIdrive); 247 testes, 3 commits em sdk-servo-toolkit"
tags: ["servo-toolkit", "automacao", "iris-scds", "03007", "03008", "ethercat", "ethernet-ip", "profinet", "el8-ec", "delta-b3a", "anybus"]
timestamp: 2026-07-13
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# sdk-servo-toolkit — 3 módulos de mapeamento de fieldbus

## Feito

Ideia do Pedro: mapear os drives pelos DOIS lados de cada barramento (o que o vendor DECLARA × o que o device responde na rede) e cruzar. Nasceu do debug do modo 3 (jog em Profile Velocity que não anda) e da carência de telemetria sem manter USB conectado. Três módulos novos em `sdk-servo-toolkit`, todos test-first, mock sem hardware, lógica de protocolo pura separada do transporte (import-guarded):

- **el8ec-ecat** (commit `1b6886b`) — master EtherCAT via **pysoem**: `scan`, `od-dump` (SDO Info + fallback de varredura), `pdo-dump` (resolve qual objeto ocupa cada byte do Anybus), `sdo read/write`, `sii-dump`, `crossmap` (offline, cruza com a tabela CoE↔Modbus do Motion Studio). 83 testes. Bancada: PC no CN3, gateway desconectado (1 master por barramento).
- **eip-probe** (commit `30723b3`) — scanner EtherNet/IP via **pycomm3** (+eeip): 3 níveis — explicit (identity/cip-scan/assembly-dump, seguro com planta viva), Classe 1 Input-Only/Listen-Only (escuta o T→O em paralelo ao PLC), Exclusive-Owner (bancada, comanda O→T). `crossmap-eip` casa o pdo-dump do ecat com o offset de byte no assembly. 79 testes.
- **pnet-probe** (commit `ecc158a`) — PROFINET do Delta B3A: N0 parse GSDML (offline), N1 DCP via **pnio_dcp** (mesma rede, sem cabo dedicado), N2 codec PROFIdrive Base Mode Parameter Access (record 47). 85 testes.

## Decisões

- Um commit por módulo; cada um com sua linha na tabela do README raiz (el8ec-ecat tinha ficado de fora — corrigido). Sem push.
- Subagentes: 1º (ecat, Fable) bateu no limite com testes red → retomado em Opus; eip-probe e pnet-probe direto em Opus. Padrão replicado do el8ec-toolkit.
- PROFINET nível 3 (IO-Controller cíclico) FORA de escopo — sem stack Python madura; monitor passivo (captura) fica p/ depois.
- Diferença física registrada: EtherCAT = cabo dedicado ponto-a-ponto no CN3 (raw, sem IP, gateway fora); EIP e PROFINET = mesma rede via switch.

## Pendências (tudo a validar em bancada)

- **el8ec-ecat**: `pdo-dump` responde em campo qual objeto está em @9 do O→T — **0x60FF (Target Velocity) vs 0x6081 (Profile Velocity)** — chave p/ o modo 3 do jog. pysoem 1.1.13 importa; setcap na bancada.
- **eip-probe**: ⚠️ lib **eeip não está no PyPI** (vendorizar do GitHub, sem setup.py); Input-Only/Listen-Only montáveis mas aceitação pelo ABC3107 só confirma com hardware.
- **pnet-probe**: GSDML de ref é **devkit** (0 PNUs declarados — reimportar produção); transporte acíclico record 47 precisa de AR PROFINET (sem lib Python madura) — a validar.
- Módulos EIP/EtherCAT precisam de janela de manutenção (gateway fora) p/ os níveis intrusivos; explicit/DCP dá p/ rede viva.

## Links

- Repo: `workspaces/strokmatic/sdk/sdk-servo-toolkit` (README raiz com a tabela dos 4 módulos)
- Origem: debug do modo 3 em [[2026-07-13-iris-plc]] · snapshot PLC com PDO remapeado (jog PV / homing HM)
