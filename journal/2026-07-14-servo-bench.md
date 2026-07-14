---
type: journal
title: "IRIS 03007 — bancada EtherCAT do Servo4: PP funciona (0x6081), causa do jog achada, jog tool pronto"
description: "Handover para continuar limpo: mapeamento do wire via pysoem (pdo-dump = @9 é 0x6081/PP, não 0x60FF/PV), diagnóstico do Servo4 do Thiago (não escreve profvel/modo/target), tool de jog PP EtherCAT pronto (--enable-only), e plano PV + EIP/eeip"
tags: ["servo-bench", "automacao", "iris-scds", "03007", "el8-ec", "ethercat", "pysoem", "abc3107", "eip", "pp"]
timestamp: 2026-07-14
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# IRIS 03007 — HANDOVER bancada EtherCAT do Servo4

## Objetivo do trabalho
Descobrir por que o jog do servo não atua (Thiago suspeita de freio) e provar o caminho correto na bancada, mapeando os dois lados do gateway. Servo4 = eixo de DEV.

## ACHADO CENTRAL (definitivo, via `pdo-dump` na bancada)
O byte **@9 do RxPDO (O→T) é `0x6081` Profile Velocity — NÃO `0x60FF` Target Velocity**. Consequência: **o jog TEM que ser em PP (modo 1)**; o modo 3 (PV) nunca funciona com este mapeamento porque PV segue 0x60FF, que **não está no PDO**. Wire completo confirmado:
- RxPDO 22B: `0x6040`CW@0 · `0x607A`Target@2 · `0x60B8`TouchProbe@6 · `0x6060`Modes@8 · **`0x6081`ProfVel@9** · `0x6083`Accel@13 · `0x6084`Decel@17 · `0x6098`HomingMethod@21
- TxPDO 21B: `0x603F`Err@0 · `0x6041`SW@2 · `0x6061`ModeDisp@4 · `0x6064`Pos@5 · `0x60FD`DigIn@9 · `0x606C`Vel@13 · `0x60F4`FollowErr@17
- Salvo em `pmo/projects/03007/plc/bench-2026-07-14/` (pdo-servo4.txt, od-servo4.json=558 objetos, assembly-dump.txt, snap-servo4-* do Modbus). `0x60FF` EXISTE no OD (dá p/ remap futuro) mas não está mapeado.

## DIAGNÓSTICO do Servo4 do Thiago (snapshot 2026-07-14 12:08)
Snapshot em `plc/2026.07.14_programa-plc-thiago/` (3 L5X + CSV; Servo4 avulso == o do programa). A reescrita de hoje **removeu o que faz o PP andar** (grep confirmou):
- `Out.TargetVelocity`/`Accel`/`Decel` (0x6081/83/84) **NUNCA escritos → 0 no wire → sem trajetória**. Ontem havia bloco "CAUSA RAIZ CORRIGIDA" que escrevia todo scan; hoje foi **deletado**.
- `Out.ModesOfOperation` só `:=6` (homing), **nunca `:=1` (PP)** → gatilho PP (`ModeDisplay=1`) nunca satisfeito.
- `Out.TargetPosition` (0x607A) **nunca calculado** do mm.
- Handshake estados 20/21 malformado: 21 usa CW `0x005F` (bit4 ainda setado + bit6 relativo) e corpo "target reached" **vazio** → preso.
- **O "freio" é SINTOMA**: velocidade 0 + handshake ruim → drive faulta → desabilita → freio de retenção engata. Não é config de freio.
- FIX p/ Thiago: (1) escrever profvel/accel/decel todo scan do Cfg (fallback ≥50000/500000); (2) `Modes:=1` fora do homing; (3) calcular Target = Cmd×CountsPerMM+ZeroOffset; (4) sequência `0x0F→0x1F`→ack bit12→`0x0F`→bit10.

## FERRAMENTAS prontas (sdk-servo-toolkit — COMMITADAS 2026-07-13)
3 módulos test-first: `el8ec-ecat` (pysoem, 83→agora 115 testes), `eip-probe` (pycomm3/eeip, 79), `pnet-probe` (Delta PROFINET, 85). Runbook: `bench-mapping-el8.md`. **NOVO hoje (NÃO commitado): subcomando `jog`** no el8ec-ecat (`ecat/motion.py` puro + `hw.jog` cíclico + CLI), 115 testes. Revisei: handshake PP correto, offsets = pdo-dump, abort em fault, saída segura (Shutdown no finally). Também corrigi o `od-dump` (bug bytes→JSON, `_json_default`) — NÃO commitado.
Gotchas: `el8ec_tool.py` quer `--port` ANTES do subcomando; `identity` do eip-probe precisa Get_Attribute_Single (Get_Attributes_All falha no ABC3107 — usei pycomm3 direto); `eeip` não está no PyPI (vendorizar).

## TOPOLOGIA ATUAL da bancada
- **eth0** → P2P direto no **Servo4 isolado** (só link físico; 0 frames EtherCAT passando — confirmado por sniff passivo; inofensiva enquanto pysoem não roda).
- **Anybus** EIP (.15, "Anybus Communicator") no switch → chega neste PC (`enp0s31f6`=192.168.0.204); saída EtherCAT → os **outros 3 servos**. Assem100 T→O 84B vivo, Assem150 O→T 88B (zerado, PLC fora). Config port .10 muda (rede segregada, não bloqueia).
- **PLC IRIS DESCONECTADO**. USB Modbus direto no Servo4 (ttyACM0; baud 500000, id 63). EEPROM do drive: 0x6081=50000, 0x6083/84=30000, 0x6060=1 (tudo são).
- `setcap cap_net_raw,cap_net_admin+ep /usr/bin/python3.12` JÁ aplicado (Pedro rodou).

## PRÓXIMO PASSO IMEDIATO (onde paramos)
Rodar o jog no Servo4 via eth0, DUAS fases:
1. `el8ec-ecat/.venv/bin/python el8ec_ecat.py jog --ifname eth0 --enable-only` (habilita, confirma OP, lê SW/pos, NÃO move).
2. Se limpo: `... jog --ifname eth0 --yes --delta 100000` (~4°, lento).
**PRÉ-REQUISITO: Servo4 com POTÊNCIA PRINCIPAL (L1/L2/L3) ligada** — 24V de lógica não basta p/ Operation Enabled. Confirmar área livre. (Aguardando Pedro confirmar potência.)

## PLANO (aprovado pelo Pedro)
1. **Bancada eth0**: PP jog (tool pronto) + validar **PV** por SDO (`0x6060:=3` + `0x60FF`) ou remap — prova decisiva de que PV precisa de 0x60FF (fecha o diagnóstico do modo 3).
2. **Depois, EIP via Anybus**: programa **eeip Exclusive-Owner** escrevendo a fatia 22B do Servo4 no O→T (base @66: CW@66,target@68,modo@74,profvel@75,accel@79,decel@83) — valida a cadeia inteira EIP→gateway→EtherCAT→drive = o contrato do PLC. Exige Servo4 de volta no Anybus + PLC fora + eeip. Aprendizado transfere 1:1 (gateway repassa).
Mutuamente exclusivos na porta do Servo4 → fase 1 inteira, depois remaneja.

## PENDÊNCIAS paralelas (contexto anterior, não perder)
- Pacote **v5.6** (receitas por style + CamTrig) revisado/validado 63/63 no emulador, aguarda decisão do Pedro p/ commit/envio; **v5.6.1** proposto (campos Park). Receitas Tracker/Montana/Spin convertidas p/ UDT_Recipe (datum resolvido −33,1 via res_movel; câmera cabe, N15_Offset≈642) — em `handoffs/2026.07.13_recipe-manager-v5.6/receitas-v4-3modelos.md`, janelas pendentes de re-timing v9 + âncora barreira.
- Memória nova: [[feedback-code-via-subagent]] (escrever código sempre via subagent).

## Links
- Bancada: `pmo/projects/03007/plc/bench-2026-07-14/` · snapshot Thiago: `plc/2026.07.14_programa-plc-thiago/`
- Tools: `sdk/sdk-servo-toolkit/{el8ec-ecat,eip-probe,pnet-probe}` + `bench-mapping-el8.md`
- Entradas irmãs: [[2026-07-13-iris-plc]], [[2026-07-13-servo-toolkit]]
