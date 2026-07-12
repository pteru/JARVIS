---
type: Implementation Plan
title: sdk-line-twin — Fase 4 (HIL: compose eip-stack 2× tag-client, GM-sim p/ L19ER, golden tests do interpretador, relay, runbook)
description: Plano da Fase 4 — infraestrutura HIL completa em software; deploy compose com 2× tag-client da strokmatic-eip + redis + gateway (painel F3 funciona sem mudança), gerador de programa GM-sim para o CompactLogix L19ER da bancada, rig de golden tests instrução-a-instrução (interpretador × PLC real, skippable sem bancada), serviço de relay GM→IRIS via Class 3 (substituto do produced/consumed até o V1), e runbook de bancada.
tags: [line-twin, hil, pylogix, eip, l19er, golden-tests]
timestamp: 2026-07-12
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin Fase 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tudo que o modo HIL precisa existe e está testado ATÉ a fronteira do hardware: compose da stack eip com dois PLCs, programa GM-sim pronto para importar no L19ER, golden rig gerado + harness que compara interpretador × PLC real (skip limpo sem bancada), relay GM→IRIS, e runbook passo-a-passo. Nada requer a bancada para ficar verde no CI; tudo requer só a bancada para a validação física.

**Architecture:** Reuso máximo: o contrato Redis já é a interface (F3) — em HIL, quem popula `tags:*`/consome `cmd:*` é o **tag-client real da strokmatic-eip** (2 instâncias: `plc_key` = IP do L19ER e do PLC IRIS), então gateway+painel F3 funcionam sem mudança. Novos artefatos: `deploy/hil/` (compose + configs), `scripts/golden/` (gerador do rig L5X + harness pytest), `scripts/gm_sim/` (gerador do programa GM-sim do L19ER), `sim_core/relay.py` (ponte cold-path GM→IRIS via `cmd:` class config — substituto do produced/consumed até o contrato V1).

**Tech Stack:** pylogix (golden harness, direto), docker compose (tag-client images da strokmatic-eip — `southamerica-east1-docker.pkg.dev/strokmatic-sdk/strokmatic-images/*` ou build local do repo), fakeredis p/ testes do relay. Bench alvo: CompactLogix 5069-L319ER (`L19ER_IP` env), IRIS 5069-L310ER quando disponível.

**Spec:** design §2 (modo HIL), §3 (golden tests), fase 4 da tabela. Ground: `strokmatic-eip/docs/redis-contract.md`, `tag-client/tags.example.json`, memória `project_strokmatic_eip`.

## Global Constraints

- Branch `feat/phase4` (pós-merge F3); commits convencionais + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; **nunca `rm`**; falha ruidosa; perfil ≠ engine.
- NENHUM teste do CI depende de PLC/docker/redis reais: golden tests = `@pytest.mark.golden` + skip com mensagem clara se `L19ER_IP` unset/inalcançável; relay/compose testados com fakeredis/validação de config.
- Golden rig: os casos são OS MESMOS do subset do interpretador (fonte única: extrair casos de `tests/test_instructions.py`/`test_st.py` — não duplicar semântica à mão).
- Tag-client: configs derivadas de `profiles/iris-03007/bridge.json` (grupos) — gerador, não cópia manual.
- GM-sim do L19ER: mesmo shape de tags do R090 (`GMSim_*`, `GM_In` UDT v2) para que os MESMOS cenários YAML rodem em HIL trocando o alvo dos pokes (via `cmd:` do L19ER).
- Import p/ Studio 5000 é manual (sem headless) — READMEs de import como no pacote v5.

## File Structure (novo)

```
deploy/hil/
├── docker-compose.yml          # redis + 2× eip-tag-client + gateway + relay
├── README.md                   # runbook de bancada (rede, IPs, ordem, validação)
└── gen_configs.py              # bridge.json → tags-iris.json / tags-gm.json
scripts/golden/
├── gen_golden_l5x.py           # casos → GoldenRig.L5X (rotinas por instrução + tags)
├── cases.py                    # extração/definição dos casos (fonte única)
└── README.md                   # import no L19ER
scripts/gm_sim/
├── gen_gm_sim_l5x.py           # GM-sim standalone p/ L19ER (heartbeat + jobs + tags)
└── README.md
sim_core/relay.py               # cold-path GM→IRIS via cmd: (config-driven)
tests/test_relay.py, test_golden_gen.py, test_gm_sim_gen.py, test_hil_configs.py
tests/golden/test_golden_vs_plc.py   # @pytest.mark.golden (skip sem bancada)
docs/hil-runbook.md             # runbook completo (rede da bancada, checklist 8 passos)
```

---

### Task 0: branch F4 + pylogix + marker golden
`git checkout master && git merge feat/phase3 && git checkout -b feat/phase4`; `.venv/bin/pip install pylogix`; pyproject extra `hil = ["pylogix"]`; `pyproject.toml` pytest markers: `golden: requer PLC real (L19ER_IP)`; `addopts = "-m 'not golden'"` DEFAULT (CI nunca roda golden sem opt-in `-m golden`). Teste: marker registrado, suite inalterada. Commit.

### Task 1: `scripts/golden/cases.py` + `gen_golden_l5x.py`
- `cases.py`: `GoldenCase(id, lang ∈ {RLL,ST}, code, inputs: dict, expected: dict)` — extrai/replica os casos canônicos do subset (≥1 por instrução RLL + construtos ST: IF/CASE/aritmética/bitwise/timers com PRE curto). Fonte única: importar dados dos testes existentes onde viável; senão declarar aqui e adicionar teste de paridade (cada caso roda no INTERPRETADOR e confere `expected` — garante que o rig testa exatamente a nossa semântica).
- `gen_golden_l5x.py`: gera `GoldenRig.L5X` (formato Program export igual aos reais): uma rotina por caso (`G_<id>`), tags `G_<id>_in_*`/`G_<id>_out_*` + `G_Select DINT`/`G_Done BOOL` — MainRoutine despacha por CASE `G_Select` (executa 1 caso por request, seta `G_Done`). Validação: o L5X gerado PARSEIA com nosso `parse_l5x` e CARREGA no nosso Controller (round-trip test!) e os casos passam no interpretador.
- Commit.

### Task 2: `tests/golden/test_golden_vs_plc.py`
Harness pylogix: fixture session (skip se `L5X_GOLDEN_IP`/`L19ER_IP` unset ou `Read` falha em 2 s, mensagem com instrução de setup); por caso: escreve inputs → `G_Select=case` → poll `G_Done` (timeout 1 s) → lê outputs → compara com `expected` (mesmos dados de cases.py). Relatório de divergência rico (caso, tag, esperado, lido). Teste CI: harness importa e skipa limpo. Commit.

### Task 3: `scripts/gm_sim/gen_gm_sim_l5x.py`
Gera `GMSimBench.L5X` p/ L19ER: UDTs (UDT_StationJob/UDT_GM_Com_In v2 — reusar os L5X do perfil como fonte, não redigitar), tags `GM_In` + `GMSim_*` (mesmo shape do R090), MainProgram com rotina ST equivalente ao R090 (heartbeat por timer de 500 ms REAL — TON, não scans — documentar diferença) + README de import. Validação round-trip: parseia e roda no NOSSO controller (heartbeat incrementa). Commit.

### Task 4: `sim_core/relay.py` + `deploy/hil/`
- `relay.py`: config-driven — lê hash `tags:<gm_key>:<grupo>` e re-emite mudanças como `cmd:<iris_key>` class `config` (write-through GM_In.* no PLC IRIS); age/dedupe simples (só publica mudança); loop com período; fakeredis tests (mudança propaga, sem mudança não publica, tag fora do mapa ignorada ruidosamente no load).
- `deploy/hil/gen_configs.py`: gera `tags-iris.json`/`tags-gm.json` (formato do tag-client da strokmatic-eip — ver `tag-client/tags.example.json` no repo strokmatic-eip em `~/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip`) a partir de `bridge.json` + `hil.json` (`{"iris": {"ip": "...", "plc_key": "..."}, "gm": {...}, "relay": {...}}`).
- `docker-compose.yml`: redis + 2× tag-client (image strokmatic-images ou build context do repo eip local — usar variável `EIP_REPO`) + gateway (uvicorn do nosso pacote) + relay. Validação em teste: compose parseia (`yaml.safe_load`), serviços esperados, configs geradas batem com schema do tag-client. Commit.

### Task 5: runbook + smoke HIL skippable
`docs/hil-runbook.md`: rede da bancada (IPs exemplo, VLAN), import GoldenRig+GMSimBench no L19ER, subir compose, validar (redis-cli HGETALL, painel), rodar `-m golden`, checklist 8 passos estilo v5. `tests/golden/test_hil_smoke.py` (@golden): tag-client alcança L19ER via leitura de heartbeat pelo hash redis (requer compose up — skip com mensagem). Commit.

### Task 6: fechamento F4
README (tabela fases 0–4 done, F5 planejada), merge→master, push, changelog JARVIS, journal, atualizar adendo Willer se surgirem achados novos.

## Self-Review
1. Spec fase 4: GM-sim no L19ER ✓ (T3, via gerador + README import), 2× tag-client ✓ (T4 compose), golden tests ✓ (T1-T2, fonte única de casos + round-trip no próprio interpretador), painel em HIL ✓ (herdado F3 via contrato). Produced/consumed real = bloqueado por V1 (relay documentado como substituto temporário — decisão registrada).
2. Sem placeholders; grounding steps: tags.example.json (T4), UDTs reusados dos L5X (T3).
3. Consistência: `plc_key` iris/gm de `hil.json` usados por gen_configs/relay/compose; cases.py fonte única T1→T2.
