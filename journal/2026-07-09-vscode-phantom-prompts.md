---
type: Journal
title: Prompts fantasma nos terminais Claude Code — python-envs do VS Code
description: Diagnóstico e fix do comando "source .venv/activate" injetado em todas as sessões Claude Code do PC.
okf_version: "0.1"
tags: [jarvis, vscode, tooling, debugging]
timestamp: 2026-07-09
language: pt-BR
---

# 2026-07-09 — Prompts fantasma nos terminais (VS Code python-envs)

## Feito

- Diagnosticado o sintoma: de tempos em tempos, todas as sessões Claude Code do PC
  recebiam simultaneamente o prompt `source .../new_sparkeyes_modeling/.venv/bin/activate`
  sem o usuário digitar.
- Causa raiz: extensão `ms-python.vscode-python-envs` com
  `python-envs.terminal.autoActivationType` no default `"command"` — ela digita o comando
  de ativação no stdin dos terminais integrados. A cada restart do extension host
  (tipicamente auto-update da extensão; havia 6 versões instaladas, 1.20→1.30), re-injeta
  em todos os terminais abertos.
- O venv sparkeyes era o interpretador selecionado do workspace `/home/teruel/JARVIS`
  (chave `venv:WORKSPACE_SELECTED` em `workspaceStorage/<hash>/state.vscdb`).
- Fix aplicado: `"python-envs.terminal.autoActivationType": "off"` em
  `~/.config/Code/User/settings.json`.

## Decisões

- `"off"` em vez de `"shellStartup"` — fluxo do Pedro é ativação manual de venvs;
  dezenas de venvs por workspace tornam auto-ativação mais ruído que ajuda.
- Não mexi na seleção de interpretador do workspace (só muda *qual* comando seria
  digitado; o sintoma morre com o autoActivationType).

## Pendências

- Nenhuma. Se reaparecer, checar se update da extensão renomeou/reintroduziu a setting.

## Links

- Memória: `reference_vscode_python_envs_phantom_prompts.md` (bundle memory)
- Scripts JARVIS inocentados: nenhum grep de `send-keys`/`TIOCSTI`/venv path no repo
