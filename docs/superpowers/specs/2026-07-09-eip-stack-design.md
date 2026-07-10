---
type: Design Spec
title: EIP stack composta — adapter certificado + tag-client (pylogix) + Redis
description: Design da "Strokmatic EIP stack" (issue strokmatic-eip#4) — tag-client genérico em Python/pylogix no repo strokmatic-eip, docker-compose de 3 serviços com domínios de falha independentes, e contrato único de chaves Redis (hot/cold/cmd/audit).
tags: [eip, ethernet-ip, pylogix, opener, redis, docker, strokmatic-eip]
timestamp: 2026-07-09
project: "03007"
product: strokmatic-eip
language: pt-BR
status: approved
---

# EIP stack composta — Design Spec

**Issue:** [strokmatic/strokmatic-eip#4](https://github.com/strokmatic/strokmatic-eip/issues/4)
**Repo alvo:** `strokmatic/strokmatic-eip` (clone: `workspaces/strokmatic/sdk/strokmatic-eip`)
**Primeiro consumidor:** IRIS 03007 (contrato C2 v0.99, §2.4 + regra 6 — `03007/specs/IRIS-03007-Contratos-Integracao.md`)

## 1. Objetivo e escopo

Implementar a decisão de produto da issue #4: a camada EtherNet/IP da Strokmatic
é entregue como uma **stack composta** (docker-compose) de containers separados
— nunca container único:

```
strokmatic-eip-stack
├── eip-adapter      (C, OpENer, certificável)  — Classe 1 implícito + servidor Classe 3 · host network
├── eip-tag-client   (Python / pylogix)         — originador Classe 3: poll de tags + thread de comando
└── redis            (compartilhado)            — contrato único de chaves: hot / cold / cmd / audit
```

**Neste bloco (escopo):**

1. `tag-client/` — componente **genérico** novo neste repo (Python + pylogix).
2. `docker-compose.yml` reformulado — stack de 3 serviços, secrets por env.
3. `docs/redis-contract.md` — contrato único de chaves Redis.
4. Validação **dev-rig Docker apenas**: unit tests (pylogix fake) + integração
   com cpppo como tag-server simulado + smoke da stack completa.

**Fora do escopo:** bancada com CompactLogix físico (Stage B, ad-hoc posterior);
Phase 0 (archaeology); PR da Fase A no `visionking-plc-monitor-eip`; Anexo D
(layout do assembly 128 B do hot path).

## 2. Decisões estruturais

### 2.1 Layout do repo — opção B em fases (B-lite agora)

Decisão do Pedro (2026-07-09): layout final de produto é `adapter/` +
`tag-client/` (opção B), **mas o move da árvore OpENer só acontece depois do
Phase 0** — o archaeology diffa refs `legacy/*` e tags `legacy-cert-*` que têm
o layout antigo (`source/` na raiz); mover antes taxaria cada diff/cherry-pick
com `-Xsubtree`/rename-thresholds.

Sequência:

1. **Agora (B-lite):** `tag-client/` como diretório novo; árvore OpENer
   intocada na raiz; compose aponta build context pra raiz.
2. **Phase 0:** inventário A/B/C/D com layout alinhado ao legado.
3. **Pós-Phase 0:** commit 100% puro de `git mv` → `adapter/` + commit separado
   de path-fixes (Dockerfile, `.gitmodules` do `deps/strokmatic-lldpd`,
   scripts) + revalidação build/testes + nota no README sobre
   `-Xsubtree=adapter` para merges de upstream.

O README será corrigido: a frase "No code lands on master until Phase 0" está
desatualizada (master já tem CT20-2..7 e redis_bridge) e a seção Status ainda
diz "pre-implementation".

### 2.2 Por que containers separados (rationale da issue, normativo)

1. **Domínios de falha independentes** — tag-client é crash-only
   (`restart: always`); restart dele não pode derrubar a conexão Classe 1 do
   adapter (PLC veria connection fault e zeraria consumed data).
2. **Envelope certify-once** — mudança de `tags.json`/poller nunca redeploya o
   processo certificado.
3. **Redes diferentes** — Classe 1 UDP exige host network/macvlan (não funciona
   em netns compartilhado — ambos bindam UDP 0.0.0.0:2222); Classe 3 TCP roda
   em bridge.
4. **Ciclos de vida opostos** — C estável e raramente muda; Python muda por
   projeto/config. Imagens e Dockerfiles separados.

## 3. Topologia do compose

| Serviço | Imagem | Rede | Notas |
|---|---|---|---|
| `eip-adapter` | `strokmatic-eip-adapter` (Dockerfile raiz, existente) | `network_mode: host` + `cap_add: [NET_RAW, NET_ADMIN]` | substitui o `privileged: true` atual por caps explícitas; arg posicional = interface (`EIP_IFACE`) |
| `eip-tag-client` | `strokmatic-eip-tag-client` (`tag-client/Dockerfile`, novo) | bridge `eip-stack` | `restart: always`, crash-only |
| `redis` | `redis:7-alpine` | bridge `eip-stack` + `127.0.0.1:6379` publicado no host | tag-client alcança por nome de serviço; adapter (host network) por `127.0.0.1` |

**Configuração por env/`.env` (não commitado):** `REDIS_PASSWORD`, `PLC_IP`,
`PLC_KEY`, `EIP_IFACE`. A senha hardcoded no compose atual (`SparkEyes@@2022`)
**sai do YAML**; ela já vazou no histórico do git — registrar para eventual
rotação (as credenciais do purge 2026-06-17 não foram rotacionadas; mesma
política).

**Redis externo** (caso 03007, que já tem Redis no deployment): via
`docker-compose.override.yml` documentado no `docs/redis-contract.md` — sem
profiles.

## 4. Contrato de chaves Redis (`docs/redis-contract.md`)

Namespace por `<plc_key>` (convenção atual: IP do PLC). Quatro famílias:

| Família | Chave | Dono (escreve) | Formato |
|---|---|---|---|
| **hot** | `io:in:<plc_key>` / `io:out:<plc_key>` | adapter / plugins | binário 128 B — **existente e congelado** (envelope certificado; `redis_bridge.c` usa SET/GETRANGE) |
| **cold** | `tags:<plc_key>:<grupo>` | tag-client | HASH: um field por tag + `updated_at` (epoch ms) — staleness pela regra 5-a do C2 |
| **cmd** | `cmd:<plc_key>` | consumidores (WS) | STREAM: `seq`, `ts_ms`, `tag`, `value`, `class` (`motion`\|`stop`\|`config`), `group` (ex.: eixo) |
| **audit** | `audit:<plc_key>` | tag-client | STREAM: `seq`, `outcome` (`applied`\|`discarded_stale`\|`superseded`\|`error`), `latency_ms`, `detail` |

Semântica do canal de comando (generalização da regra 6 do C2):

- **Descarte por idade:** comando com `ts_ms` mais velho que `max_age_ms`
  (default 300) é descartado — configurável por `class` (`motion` descarta,
  `config` não). Motivo: serviço crash-only acumula fila durante restart;
  comando de movimento velho reproduzido = movimento não solicitado.
- **Stop prioritário:** `class=stop` processa antes dos pendentes e descarta
  `motion` pendentes do mesmo `group`.
- **Eco de Seq (opcional, por config):** mapeamento `cmd tag → echo tag`
  permite medir round-trip tela→PLC→tela (regra 6.v — `IF_Axis[n].LastCmdSeq`
  no 03007). Régua de aceite do consumidor 03007: mediana ≤ 150 ms, p95 ≤ 300 ms.
- O stream `cmd` **é** a trilha primária (streams persistem); `audit` registra
  o desfecho de cada comando consumido. Consumo via consumer group
  (`XREADGROUP`/`XACK`) para sobreviver a restart sem reprocessar.

## 5. Internals do tag-client

- **Python 3.11+**, pacote `eip_tag_client`, `pyproject.toml`, pylogix pinado.
- **Config `tags.json`** (nome já citado no README):
  `{plc_ip, plc_key, groups: [{name, interval_ms, tags[]}], command: {max_age_ms, discard_classes, echo_map}}`.
- **Threading:** 1 thread de poll por grupo + 1 thread de comando, **cada uma
  com instância pylogix própria** (pylogix não é thread-safe — regra 6.i).
  Poll usa batch read; comando usa `XREADGROUP BLOCK`.
- **Crash-only:** exceção não tratada em qualquer thread → log + `sys.exit(1)`;
  Docker reinicia. Sem reconexão interna ao Redis. Falha transiente de leitura
  do PLC: retry inline; hash para de receber `updated_at` novo e consumidores
  detectam staleness (regra 5-a) — sem estado "stale" explícito no client.

## 6. Testes (TDD, dev-rig Docker)

1. **Unit (pytest):** pylogix injetado por factory → fake em memória. Cobre:
   descarte por idade, stop prioritário, superseded, montagem de batch,
   `updated_at` stamps, echo/latência.
2. **Integração:** compose de teste com **cpppo** (GPL — uso test-time apenas,
   não linka com o produto) servindo tags ControlLogix-style + Redis; tag-client
   real contra ele; asserts em hashes e streams. Runner
   `tag-client/tests/run_integration.sh` no padrão do `run_scanner_test.sh`.
3. **Smoke da stack:** `docker compose up` dos 3 serviços + healthchecks
   (adapter já coberto pelo `scanner_test.cpp` existente).

Sem GitHub Actions (CI futura = Cloud Build); tudo roda local.

## 7. Riscos e pontos de atenção

- **cpppo não é um CompactLogix** — fidelidade de timing/quirks de ForwardOpen
  ficam para a bancada (Stage B, fora deste bloco).
- **Classe 1 em netns compartilhado não funciona** — o smoke da stack valida o
  adapter apenas como processo vivo em host network; o data-path Classe 1
  continua coberto pelo rig do `scanner_test`.
- **Senha Redis vazada no histórico** — remoção do YAML não remove do
  histórico; rotação pendente (política do purge 2026-06-17).

## Histórico

| Data | Mudança |
|---|---|
| 2026-07-09 | Design aprovado pelo Pedro (opção B em fases; client genérico neste repo; dev-rig Docker apenas) |
