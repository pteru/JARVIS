---
type: Session Log
title: 2026-07-09 — automacao — bancada USB EL8-EC: mapa validado, escrita RAM, EEPROM pendente 24V
description: Primeira sessão de bancada com o L8EC-750F real via USB-C — link 500000/ID63, layout par 32-bit confirmado, mapa EC validado nos defaults, escrita RAM ok, save EEPROM não persiste sob só-USB; OD CoE inteiro espelhado no Modbus.
tags: [automacao, servo, leadshine, el8ec, modbus, bancada]
timestamp: 2026-07-09
session: automacao
project: "03007"
language: pt-BR
---

# 2026-07-09 — automacao (bancada EL8-EC via USB)

## Feito

- **Drive L8EC-750F real conectado via USB-C**: bridge **WCH CH9102**
  (`1a86:55d4`) → `/dev/ttyACM0` (CDC-ACM, zero driver). Link Modbus RTU:
  **baud 500000, slave ID 63** (= `DeviceId` do Motion Studio), FC 0x03/0x10.
- **Layout de registradores descoberto**: todo valor é um **par 32-bit
  alinhado `[hi@par, lo@ímpar]`**; Address do banco = word baixa; drive alinha
  leituras ao par (ler 1 word em addr ímpar devolve a word alta = 0).
- **Mapa EC validado contra defaults do banco**: Pr0.01=9, Pr0.04=250,
  Pr5.31=1 exatos; Pr0.03=13 (fábrica). Monitores: D33=30 °C, D22=75 r,
  D27=0 V (só USB). Drive veio com **Pr0.15=0 (incremental)**.
- **Escrita RAM validada**: FC16 com par completo no endereço PAR (`addr&~1`);
  1 word ou addr ímpar → illegal data address. Pr0.03 13→14→13 com readback.
- **EEPROM: NÃO persiste sob só-USB** — `0x1010:01` "Store All Parameters"
  espelhado no Modbus `0xAF38/39` aceita a assinatura `save` em hi_lo e lo_hi,
  mas 2 power-cycles reverteram (13). Auxiliar estilo ELP (0x2211→0x1801)
  rejeitado (não existe no EC).
- **🔑 OD CoE inteiro espelhado no Modbus USB**: `ObjectDictionaryTable_L8EC`
  (1287 objetos) exportado ao toolkit — 0x6040→0xB2E1, 0x6064→0xB2F7.
  Potencial controle CiA 402 completo pela USB em bancada, sem master EtherCAT.
- Toolkit atualizado (leitura default 32-bit, escrita alinhada, probe
  500000/63 primeiro; 47 testes) + README com "Resultados de bancada".

## Decisões

- Leitura/escrita default do toolkit = par 32-bit `hi_lo` (empírico, defaults
  exatos); drive restaurado ao estado de fábrica (Pr0.03=13) ao final.
- Teste de persistência EEPROM adiado para quando o drive tiver 24 V no painel
  (hipótese: gravação de flash inibida sob alimentação USB).

## Pendências

- EEPROM com fonte de controle 24 V (retestar 0x1010:01 e/ou save do Motion
  Studio); validar controle CiA 402 via USB com potência (enable/jog).
- P2 do guia: remap de PDO em EEPROM sobrevive ao scan do gateway Anybus?
- P3: motor ACM2H0808B não consta no site Leadshine — confirmar com SHELE.

## Links

- Toolkit: `workspaces/strokmatic/pmo/projects/03007/tools/el8ec-toolkit/`
  (README = resultados de bancada; `data/*.json` = mapas do DATA.mdb)
- Guia de integração: `03007/specs/IRIS-03007-Integracao-PLC-Gateway-Servo.md`
- Pacote Willer: `03007/2026.07.08_mapa-registradores-el8ec-willer/` (entregue)
- Memória: `project_03007_servo_gateway_integration.md`
