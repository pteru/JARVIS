---
type: Implementation Plan
title: sdk-line-twin — Fase 3 (bridge Redis, gateway, painel 3D, ingestão STEP/GLB + binding)
description: Plano da Fase 3 — bridge Redis no contrato strokmatic-eip (pure-sim publica tags:*/consome cmd:*), gateway FastAPI+WebSocket, runtime realtime, pipeline de ingestão STEP/GLB com manifest de árvore, binding.json + linter + fallback paramétrico, e painel Vite+TS+Three.js (gêmeo 3D + telas + binding mínimo + Playwright smoke).
tags: [line-twin, redis, gateway, threejs, binding, step, glb]
timestamp: 2026-07-12
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin Fase 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O twin ganha cara e rede: a simulação roda em tempo real publicando o contrato Redis da strokmatic-eip, um gateway WebSocket alimenta um painel Three.js que anima o pórtico/carros ao vivo, aceita jog/spawn pelo canal normativo, e a cena 3D é data-driven por `binding.json` (GLB real quando existir; fallback paramétrico já funcional).

**Architecture:** `sim_core/bridge/` (Redis pub do cold path `tags:*` + consumo de `cmd:*` com semântica do tag-client + canal `simctl:` para ações de planta) · `sim_core/gateway/` (FastAPI+WS, agrega snapshots 10–20 Hz, comandos → streams) · `sim_core/live.py` (runtime com pacing wall-clock) · `scripts/ingest_model.py` (STEP→GLB via cascadio | GLB passthrough → `assets/` + `model-manifest.json`) · `binding.json` + linter Python + fallback paramétrico · `panel/` (Vite+TS+Three.js, cena por binding, HUD, jog com deadman, aba binding mínima). Espinha: contrato `docs/redis-contract.md` da strokmatic-eip (hash `tags:<plc_key>:<group>` + `updated_at`; stream `cmd:<plc_key>` com `seq/ts_ms/tag/value/class/group`; age-discard 300 ms p/ motion; stop prioritário).

**Tech Stack:** Python: `redis`, `fakeredis` (test), `fastapi`, `uvicorn`, `websockets` (test client), `cascadio` (STEP→GLB, opcional/extra). Frontend: Vite + TypeScript + Three.js (padrões portados do viewer do sdk-blender-tools), Playwright smoke (padrão sealer-provisioning-gui).

**Spec:** `2026-07-11-sdk-line-twin-design.md` §2 (bridge/modos), §6 (ativos/binding), §7 (painel/gateway). Fase 2 (base): 207+ testes, cenários YAML, LinePlant, MainProgram+jobdata sob SimSession.

## Global Constraints

- Repo `sdk-line-twin`, branch `feat/phase3` (da master pós-merge F2); commits convencionais + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; falha ruidosa; perfil ≠ engine; **nunca `rm`** (mover para scratchpad se precisar limpar).
- Redis NUNCA obrigatório para pytest: todos os testes usam `fakeredis` (ou TagDb direto); `redis` real só no runtime.
- Contrato Redis (strokmatic-eip `docs/redis-contract.md`) é lei: `tags:<plc_key>:<group>` HASH com valores JSON + `updated_at` epoch-ms; `cmd:<plc_key>` STREAM campos `seq,ts_ms,tag,value,class,group`; classes `motion|stop|config`; age-discard default 300 ms só p/ `motion`; stop prioritário; `plc_key` do perfil (pure-sim: `"sim-iris"`). Canal de planta: STREAM `simctl:<plc_key>` (`action=spawn_car`, `vid`, `style`) — extensão nossa, documentada como fora do contrato eip (não existe em HIL).
- Panel NUNCA fala Redis direto — só WS/HTTP do gateway.
- Cena 3D 100% data-driven por `profiles/iris-03007/binding.json`; zero geometria hardcoded no panel além do fallback paramétrico gerado do binding.
- GLB real: `00_MONTAGEM_COMPLETA.stp` (238 MB) em `~/JARVIS/workspaces/strokmatic/pmo/projects/03007/reference/cad/` — conversão real é BEST-EFFORT em background (pode falhar por RAM/tempo; documentar resultado); testes usam fixtures pequenas. Requisito GLB: árvore de nós nomeada (subconjuntos móveis separados).
- Eixos do perfil: E1 (varredura vertical), E2, E4R, E4L ↔ Servo1..4; posições via `Position1..4_mm` / drives.

## File Structure (novo)

```
sim_core/
├── bridge/__init__.py, redis_bridge.py    # pub cold + consume cmd/simctl
├── gateway/__init__.py, app.py            # FastAPI + WS + REST
├── live.py                                # runtime realtime (__main__)
scripts/ingest_model.py                    # STEP/GLB → assets + manifest
sim_core/binding.py                        # schema + linter + fallback paramétrico
profiles/iris-03007/
├── bridge.json                            # plc_key, grupos de tags, período
├── binding.json                           # nós ⇄ eixos/sensores/carro (fallback refs)
└── assets/                                # model-manifest.json (+ portico.glb se converter)
panel/                                     # Vite + TS + Three.js
├── package.json, vite.config.ts, index.html
├── src/main.ts, src/ws.ts, src/scene.ts, src/binding.ts,
│   src/hud.ts, src/jog.ts, src/binding-editor.ts
└── tests/smoke.spec.ts                    # Playwright
tests/test_bridge.py, test_gateway.py, test_binding.py, test_live.py
```

---

### Task 0: branch F3 + deps + bridge.json

- [ ] `git checkout master && git merge feat/phase2` já feito (pré-condição da F3; se não, fazer) → `git checkout -b feat/phase3`.
- [ ] `.venv/bin/pip install redis fakeredis fastapi uvicorn httpx websockets`; pyproject: deps runtime `redis,fastapi,uvicorn`; extra `[project.optional-dependencies] dev = ["fakeredis","httpx","websockets","pytest"]`, `cad = ["cascadio","trimesh"]`.
- [ ] `profiles/iris-03007/bridge.json`: `{"plc_key": "sim-iris", "publish_period_ms": 100, "groups": {"axes": ["Position1_mm","Position2_mm","Position3_mm","Position4_mm","RefValid1","RefValid2","RefValid3","RefValid4"], "line": ["GM_In.Heartbeat","GM_In.LineRunning","WS.PVI","WS.Style","StTimeoutCommGM","GM_Out.PVI_ACK"], "mode": ["R010_MIRROR","ManualOK","Ramp1.JogState","Ramp1.HomeState"]}}` (grupos exatos podem crescer; validar cada tag contra o TagDb no load — falha ruidosa).
- [ ] pytest verde; commit.

### Task 1: `bridge/redis_bridge.py`

Interfaces: `RedisBridge(cfg, session, redis_client)`; `.publish_tick()` (a cada N ticks: HSET `tags:<plc>:<grupo>` field=tag value=JSON + `updated_at`); `.consume()` (XREAD `cmd:<plc>` + `simctl:<plc>`: cmd → valida classe, age-discard motion >300 ms por `ts_ms` vs clock WALL (documentar: relógio do produtor = painel/gateway, wall), stop executa imediato e supersede motion pendente do mesmo `group`, aplica via `session.poke` + `monitor.notify_poke`-style hook (callback `on_poke`); simctl → `session.spawn_car`). Audit stream `audit:<plc>` com `outcome` por entrada (contrato). TDD com fakeredis: publish shape (hash+updated_at), age-discard, stop-priority, simctl spawn, tag inexistente no grupo → erro no construtor.

### Task 2: `gateway/app.py`

`create_app(redis_client, cfg) -> FastAPI`: WS `/ws` (a cada `push_period_ms` lê os hashes `tags:*` e envia `{"t": ..., "groups": {...}}` delta-ou-snapshot simples — snapshot integral é aceitável na F3, documentar); REST `POST /cmd` `{tag,value,class,group}` → XADD `cmd:<plc>` com `seq` incremental + `ts_ms` wall; `POST /simctl` `{action:"spawn_car",vid,style}` → XADD simctl; `GET /health`. Sem estado além do seq. TDD: httpx/ws test client + fakeredis (snapshot chega; POST /cmd vira entrada de stream com campos do contrato; classes inválidas → 422).

### Task 3: `live.py` — runtime realtime

`python -m sim_core.live <profile_dir> [--redis-url ... | --fake] [--rate 1.0]`: SimSession + RedisBridge; loop paced: cada tick simulado (dt_ms) dorme para alinhar wall-clock×rate (rate>1 = mais rápido). Ctrl-C limpo. Con `--fake` usa fakeredis + injeta o gateway no MESMO processo (uvicorn thread) — modo dev standalone sem Redis real. TDD: teste curto com rate alto + fakeredis: roda ~50 ticks, hash publicado, cmd de jog aplicado (poke visível).

### Task 4: `scripts/ingest_model.py` + manifest

`ingest_model.py <input.stp|.glb> <profile_dir>`: se GLB → copia p/ `assets/portico.glb`; se STEP → converte via cascadio (import guard com mensagem de instalação). Sempre: extrai árvore de nós (trimesh.Scene graph) → `assets/model-manifest.json` `{nodes: [{path, name, mesh: bool}], source, sha256, generated_at}`. Falha ruidosa: GLB sem nomes de nó (tudo "mesh_0") → warning explícito no manifest. TDD: fixture GLB pequena gerada programaticamente com trimesh (2 nós nomeados) em tmp_path; STEP só se cascadio disponível (`pytest.importorskip`). **Best-effort real**: rodar em background a conversão do STEP 238 MB (timeout generoso); registrar resultado (tamanho/tempo/nº nós) no report — sucesso NÃO é critério de aceitação da task.

### Task 5: `sim_core/binding.py` + `binding.json` + fallback

Schema: `{"version": 1, "source": "parametric"|"glb", "axes": {"E1": {"node": "path/no/glb"|null, "axis": "y", "sign": 1, "home_mm": 0}}, "car": {"node": null, "axis": "x"}, "sensors": [{"id": "B01", "node": null, "pos_mm": 300}], "fixed": ["..."]}`. `load_binding(profile_dir) -> Binding` + linter: eixo do plant sem entrada → erro; node path inexistente no manifest (quando source=glb) → erro; tag/eixo desconhecido → erro. Fallback paramétrico: `source: "parametric"` gera especificação de primitivas (dims em `binding.json.parametric`) que o panel renderiza (pórtico = pórtico 2 colunas + travessa, eixos = caixas, carro = caixa). Commit binding.json inicial parametric com os 4 eixos+B01/B02+carro. TDD: linter (5 casos), load ok.

### Task 6: `panel/` — Vite+TS+Three.js

- Scaffold `npm create vite panel -- --template vanilla-ts` + `three` + types; portar padrões do viewer (câmera orbital, luzes, grid) — POR CÓPIA ADAPTADA (referência: `sdk-blender-tools/viewer/src/scene/scene.ts`), sem dependência.
- `src/ws.ts`: cliente WS com reconexão/backoff + estado "desconectado" visível (nunca congelar dado velho silenciosamente).
- `src/binding.ts`: fetch `/profile/binding+manifest` (gateway serve os JSON do perfil — adicionar `GET /profile` no gateway, Task 2 followup dentro desta task); constrói cena: GLB (GLTFLoader) quando source=glb; primitivas quando parametric.
- `src/scene.ts`: aplica estado ao vivo: `Position{1..4}_mm` → transform dos nós de eixo (axis/sign/home do binding); carros (do grupo line/futuro; F3: carro único via `sim.line` — expor posições de carro no bridge grupo `line` como `LineCars` JSON) → mover nó carro.
- `src/hud.ts`: PVI/Style, Heartbeat, LineRunning, StTimeout, JogState/HomeState, banner PURE-SIM.
- `src/jog.ts`: botões E1..E4 +/- com deadman (segurar = POST /cmd motion + refresh periódico WSCmd_JogRefresh; soltar = para de refrescar), Stop (class stop). Spawn car (POST /simctl).
- `src/binding-editor.ts`: aba mínima — lista nós do manifest, dropdown (fixo/E1/E2/E4R/E4L/carro/sensor), botão download binding.json (client-side). Sem persistência server-side na F3.
- Build passa (`npm run build`); testes unitários TS mínimos (vitest) para binding→scene mapping puro.

### Task 7: Playwright smoke + integração dev

`panel/tests/smoke.spec.ts`: sobe `live.py --fake` (fixture) + `vite preview`; página carrega, WS conecta, HUD mostra dados, cena tem canvas. Padrão sealer-gui. Script `scripts/dev.sh` (sobe live --fake + vite dev) documentado no README.

### Task 8: fechamento F3

README (fase 3, como rodar painel), tabela de fases, merge `feat/phase3`→master, push, changelog JARVIS.

## Self-Review

1. Spec §2/§6/§7 cobertos: bridge com contrato eip ✓ (T1), gateway ✓ (T2), realtime ✓ (T3), STEP/GLB+manifest ✓ (T4), binding+linter+fallback ✓ (T5), painel gêmeo+HUD+jog+editor mínimo ✓ (T6), smoke ✓ (T7). Replay/timeline = Fase 5 (fora). Telas kiosk completas (Alertas 55) = fora (spec as põe como referência de gramática, não entrega F3).
2. Sem placeholders; pontos de descoberta com instrução (grupos bridge.json validados no load; conversão real best-effort com registro).
3. Consistência: `plc_key sim-iris` em bridge/gateway/panel; `Binding` consumido por panel via gateway `/profile`; simctl documentado como extensão não-eip.
