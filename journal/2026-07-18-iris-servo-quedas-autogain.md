---
type: Journal
title: "IRIS 03007 — causa-raiz das quedas/porradas dos servos: auto-gain do drive (Pr0.02) + fix nos 4 EL8-EC"
description: Investigação fechada da "queda"/"caída" dos servos (sag do E2 17:33, trip 17:34 following-error 0x8611, queda livre de 27mm no P3, porrada do E4L 0x3205). Réplica fiel do ciclo automático no Servo2 via EtherCAT direto (T8_recipe_r021 lei R021 v3.2 + params §4, entrega 10ms) reproduziu a queda; a leitura USB dos registradores achou o culpado — Pr0.02 (Real-time Auto Gain Adjusting) = 1 + Pr1.14 (2nd gain switching) = 1, que relaxam a rigidez/integral na transição parado→movimento e largam o eixo vertical à gravidade. Congelando Pr0.02=0 + Pr1.14=0 em RAM, o P3 rodou 10/10 ciclos limpos (0 quedas, 0 faults). Fix persistido em EEPROM nos 4 drives (E1/E2/E4R/E4L), + overspeed Pr5.13=2250 restaurado (estava 0 no par 4) e trip Pr0.14=10 confirmado. Pendente: AUTO de diagnóstico (o par 4 é horizontal — a porrada do E4L com fault de TENSÃO 0x3205 pode ter causa elétrica, não gravidade).
tags: [iris-servo-quedas-autogain, iris-ecat-bench, iris-scds, "03007", plc, automacao, servo, ethercat]
timestamp: 2026-07-18
project: "03007"
product: visionking
language: pt-BR
status: current
---

# IRIS 03007 — quedas dos servos: causa-raiz = auto-gain do drive

## Feito
- **Réplica fiel do ciclo no Servo2 (E2)** — EtherCAT direto (pysoem), `T8_recipe_r021`
  (lei R021 v3.2 + params §4, `--deliver-every 5` = 10ms como o gateway ABC3107), curso
  real 10↔1100 mm. Antes disso, P1 (hold/freio 30s) e P2 (10 strokes ±50mm) **não**
  reproduziram nada — freio 0µm de escorregamento, hold 0,4µm. O evento só apareceu no
  **P3 (10 ciclos)**: no re-engate do 4º retorno, **queda livre de 27,5mm em ~15ms (~0,7g)**,
  torque saturando −343%, → **Er 0x8611 (following error)**. Idêntico ao trip de 17:34.
- **Culpado achado por USB (Modbus, el8ec-toolkit):** `Pr0.02 Real-time Auto Gain Adjusting = 1`
  + `Pr1.14 2nd gain switching = 1`. Com o conjunto 2 tendo integral ~off (`Pr1.07=10000`),
  a comutação/relax na transição hold→movimento **larga o torque que segura o eixo vertical**.
- **Prova A/B:** `Pr0.02=0` + `Pr1.14=0` em RAM → repeti o P3 → **10/10 ciclos + 10 re-engates
  LIMPOS**, 0 fault, 0 queda em 61k amostras USB. Antes: queda no 4º. Mesmo eixo, mesma lei.
- **Fix aplicado e PERSISTIDO em EEPROM nos 4 drives** (E1/E2/E4R/E4L): `Pr0.02=0`, `Pr1.14=0`.
  Restaurado `Pr5.13=2250` (overspeed 750mm/s — estava **0** no E4R **e** E4L!) e confirmado
  `Pr0.14=10` (trip following-error 20mm) nos 4. Todos verificados com power-cycle.
- **Instrumentação nova:** `servo2_usb_lab.py` (CiA402 via Modbus 0xB2xx, 108Hz, guardas de
  soft-limit/remote/fault-capture) e `e4_monitor.py` (pylogix, 4 eixos pos/vel/err/State/Fault
  + `IF_Axis[].InhibitCode` = código do drive no instante + camada de alarme, 175Hz).

## Decisões / achados
- **Causa-raiz confirmada (vertical):** as quedas E1/E2 são o auto-gain do drive, não a lei
  R021 nem o freio nem a mecânica. O comando estava limpo (alvo andou 0,15mm quando despencou).
- **`Pr0.14=10` salvou a máquina 2× hoje** (parou em ~mm, não no FDC) — manter nos 4.
- **⚠️ Par 4 é HORIZONTAL** — a razão "gravidade" não se aplica. A porrada do E4L no AUTO
  deu **`0x3205` (classe de TENSÃO/DC-link)**, não following-error → pode ser transiente de
  ganho OU elétrico (regen/resistor de frenagem/alimentação do pórtico 4). NÃO fechar como
  auto-gain sem o teste. Só o `Pr5.13`/`Pr0.14` (segurança, independem de orientação) são
  obrigatórios no par 4.
- **Cadeia de anúncio nova funcionou:** com o R004 v2 do patch importado, `Alarm_ActiveWord`/
  `IRIS_FaultCode` **enxergaram** a falha de eixo (antes ficavam 0); o `IF_Axis[3].InhibitCode`
  reteve o `0x3205` do E4L (o código do drive, que morria no reset).
- **Escopo USB×EtherCAT:** o espelho Modbus (0xB2xx) NÃO pilota a máquina de estados CiA402
  sem master; controle de movimento exige EtherCAT (USB fica p/ registradores/monitores).
  Escrita de Pr na EL8-EC persiste em EEPROM direto (validado por power-cycle).

## Pendências
- **AUTO de diagnóstico** com o `e4_monitor` armado (stream de eventos ligado): religar EtherCAT
  do E4L, FaultReset+re-home, rodar. Sem porrada → auto-gain OFF resolveu o horizontal também;
  porrada de novo → investigar o **`0x3205`** (elétrica do par 4).
- Follow-up PLC: latchar o `0x603F` do drive na borda do fault ANTES do reset (hoje
  `Servo{N}Tx.LastErrorCode` zera no reset — cegou 2× hoje). E `St_FalhaEixo` R020 `EQ(250)`→`GE(200)`.
- Gap decodificação: `0x821B`/`0x3205`/`0x8402` são códigos CiA402 `0x603F`, não os "Er" do
  painel — o `decode-alarm` do toolkit mapeia a tabela errada; adicionar mapa `0x603F`.

## Links
- Lab/monitor: `scratchpad/servo2_usb_lab.py` · `s2_usb_logger.py` · `e4_monitor.py` · `e4mon_*.csv`
- Análise: `pmo/projects/03007/reports/md/2026-07-18-analise-perda-posicao-quedas.md`
- Registradores: `plc/2026.07.18_ajustes-registradores-drive-el8ec.md`
- Journals irmãos: [[2026-07-18-iris-ecat-bench]] · [[2026-07-18-iris-plc-cycle-monitor]] · [[2026-07-18-iris-plc-rewire]]
