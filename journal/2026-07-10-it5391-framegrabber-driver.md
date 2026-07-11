---
type: journal
title: "IT5391: driver da placa quad-GbE (framegrabber) resolvido"
description: "Wangxun SF400T na workstation VK-Body — DKMS vendor quebrado removido, driver in-tree ngbe validado"
tags: [vk, hardware, driver, ngbe, wangxun, it5391, gige]
timestamp: 2026-07-10
project: "03010"
product: visionking
language: pt-BR
status: done
---

# 2026-07-10 — IT5391: driver da placa de aquisição (Wangxun SF400T)

## Feito
- Alvo original era `10.179.112.189` (VPN Arcelor, sem rota); Pedro redirecionou para a LAN: **192.168.15.189** (IT5391, VK-Body workstation).
- A "framegrabber" é uma **Wangxun SF400T quad-port GbE** (WX1860A4, `8088:0103`, portas `enp4s0f0-f3`) — placa de aquisição p/ câmeras GigE. Hikvision **MVS 5.0.1** instalado em `/opt/MVS` (ontem, via histórico).
- Diagnóstico: DKMS vendor `ngbe 1.2.6.4` compilado só p/ kernel 6.8.0-49; máquina roda **6.14.0-36** (HWE). Build no 6.14 falha: API do kernel mudou (`ethtool_keee`, `kernel_ethtool_ts_info`, `ndo_fdb_add`, `ngbe_xsk`). No boot, módulo velho gerava erro `.gnu.linkonce.this_module section size must match` e o kernel caía no driver **in-tree** `ngbe` (que funciona).
- Resolução (opção escolhida por Pedro: in-tree):
  - `dkms remove ngbe/1.2.6.4 --all` + `rm -rf /usr/src/ngbe-1.2.6.4`
  - `update-initramfs -u -k 6.14.0-36-generic` + `depmod -a`
  - Ciclo `modprobe -r ngbe && modprobe ngbe` limpo; `ethtool -i enp4s0f0` → driver ngbe 6.14.0-36, fw 0x00010018; 4 PHYs Realtek anexados.
- `NO-CARRIER` nas 4 portas é esperado — nada plugado ainda (confirmado por Pedro).
- Documentado em `config/network/local-machines.md` (entrada 192.168.15.189).

## Decisões
- **Driver in-tree, não vendor**: mainline é mantido pela própria Wangxun, sobrevive a updates de kernel (6.17 já instalado na máquina também tem o driver). Vendor DKMS seria briga permanente com HWE.
- Sem reboot da máquina (containers/AnyDesk ativos); ciclo de reload é evidência suficiente.

## Pendências
- Plugar câmeras/cabos nas portas `enp4s0fX` e validar link + descoberta no MVS.

## Adendo (mesma sessão)
- MTU 9000 aplicado nas 4 portas via netplan (`/etc/netplan/01-netcfg.yaml`; backup `.bak-20260710`). `netplan generate` + `apply` OK, sem cabo — MTU não depende de link. Permissões dos YAMLs corrigidas p/ 600.
- IPs completos nas 4 portas: f0=192.168.10.2/24, f1=192.168.20.2/24, f2=192.168.30.2/24, f3=192.168.40.2/24 (uma subrede /24 por porta de câmera). Profiles NM `netplan-enp4s0fX` gerados; endereço ativa quando a porta ganhar link.
- **Convenção de endereçamento (decisão do Pedro): câmera = final `.1`, workstation = final `.2`** em cada subrede → câmeras: 192.168.10.1, 192.168.20.1, 192.168.30.1, 192.168.40.1.

## Links
- `config/network/local-machines.md` — entrada IT5391
- Kernel docs: driver `wangxun/ngbe` mainline (libwx)
