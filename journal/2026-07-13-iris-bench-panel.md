---
type: journal
title: "IRIS 03007 — deploy do bench panel em container na PRV10IRIS5 (.189) + kiosk"
description: "Containerização (multi-stage, 151 MB) e deploy do iris-bench-panel na WS 192.168.0.189; painel plugado na stack EIP real (eip-redis, key 192.168.0.20) e kiosk Chrome apontado para ele"
tags: ["iris-bench-panel", "iris-scds", "03007", "docker", "kiosk", "deploy"]
timestamp: 2026-07-13
project: "03007"
product: IRIS
language: pt-BR
status: active
---

# IRIS 03007 — deploy do bench panel na PRV10IRIS5 (.189) + kiosk

## Feito

- Fix do gate de movimento (jog/step/home só em modo MANUAL, espelhando R030/R051 ManualOK; homing também no INIC; StopAll sempre) — commit no repo do painel.
- Containerização: Dockerfile multi-stage (node build Vite → python:3.12-slim servindo API+dist, 151 MB) + docker-compose com `network_mode: host`, profiles `panel` (real) e `panel-mock`; `config.yaml` montado read-only.
- Deploy na **PRV10IRIS5 / 192.168.0.189** (VK-Body WS, rede do painel): tarball 58 MB via scp LAN, `docker load`, `compose up -d panel`. UI 200; rota DIRECT lendo o PLC **192.168.0.20** em ~7 ms; HOT/COLD ainda sem dado nos hashes (tela Comms mostra — esperado até tag-client popular `tags:` e o hot-bridge Fase B rodar).
- Painel configurado na stack EIP real: `plc_key = 192.168.0.20` (namespace = IP do PLC, conforme env do eip-adapter), Redis eip-redis 127.0.0.1:6379 com auth — senha extraída e gravada **somente na WS** (`config.yaml` chmod 600).
- Kiosk: a WS já tinha padrão pronto (`/opt/kiosk/kiosk.sh` watchdog, usuário `kiosk`, URL em `/etc/kiosk-url`). Escrito `http://localhost:8300` no arquivo e reiniciado o Chrome — monitor da bancada agora abre o painel direto.

## Decisões

- Pedro autorizou ler envs dos containers p/ credencial do Redis e substituir o conteúdo exibido no kiosk.
- KeyDB :4000 (plc-monitor VK) não é o transporte do contrato — painel usa só o eip-redis :6379; sem scan no KeyDB (vetado e desnecessário).
- Acesso SSH via `config/network/local-machines.md` (user strokmatic); chave ed25519 instalada via sshpass p/ automação futura.

## Pendências

- HOT/COLD sem telemetria até: tag-client popular `tags:192.168.0.20` (Fase A) e hot-bridge (Fase B) existir; validar na tela Comms quando o v5.5 estiver importado no PLC.
- Repo iris-bench-panel segue local-only (decidir remote strokmatic/).
- `sudo -S` com heredoc engole stdin do comando — usar `sudo -S bash -c "..."` (gotcha registrado).

## Links

- Repo: `workspaces/strokmatic/sdk/iris-bench-panel` (README §Deploy) · WS: `config/network/local-machines.md` (PRV10IRIS5)
- Entrada anterior: [[2026-07-12-iris-bench-panel]]
