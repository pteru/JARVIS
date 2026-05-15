# SEALER backend-ds — profile `vk-sealer`

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-15
**Project:** 03008 Hyundai Piracicaba — SEALER (inspeção de cordões de selante)
**Fonte:** reunião "Alinhamentos - Frontend (03008, 03007, 01001, 02008)" de 2026-05-09.
**ClickUp:** TBD — nova atividade de software SEALER (cronograma [4.x]).
**Relacionada:** `2026-05-15-sealer-frontend-ds-design.md` (contrato de API das 3 telas); `2026-05-06-sealer-db-schema-design.md` (schema B-light onde o cordão é armazenado).

## 1. Goal

Habilitar o repositório `visionking/services/backend-ds` (NestJS + raw `pg`) a servir o produto **SEALER** como um **profile `vk-sealer`**, irmão do produto Body que o repo serve hoje. O `backend-ds` é a **API de leitura** que alimenta as 3 telas do frontend (`sealer-frontend-ds`) — distinta dos serviços de pipeline do SEALER (`point-cloud-processor`, `database-writer`, `sealer-result`, etc.). Esta spec cobre: o mecanismo de profile, a **arquitetura de rede** (proxy reverso, backend não exposto), os **endpoints** que cada tela consome, e como a **entidade cordão** é exposta — referenciando a `sealer-db-schema` para o armazenamento.

## 2. Scope

**In:**
- Introdução do **profile `vk-sealer`** no `backend-ds` (mecanismo discutido na seção 4 — decisão em aberto, mesma da spec frontend).
- **Arquitetura de rede:** backend **não exposto** na rede da planta; **proxy reverso único** como entrypoint; front (mesma máquina) é o único cliente.
- **HTTP/HTTPS chaveável via env var** — Hyundai pode exigir um ou outro; o padrão suporta os dois.
- **Endpoints** para as 3 telas: Retrabalho, Produção, Tracking (seção 5).
- Exposição da **entidade cordão** (lista de pontos de linha de centro + atributos medidos) via API.
- Leitura do **resultado consolidado por carroceria** após o stitch do pipeline.
- Endpoints auxiliares: última imagem por câmera, evento de carroceria presente/ausente.

**Out (rejeitado ou deferido):**
- **Auth no backend** — controle de acesso vive em (a) backend não exposto + (b) proxy reverso + (c) auth do frontend (spec futura). Mesmo deferimento do IRIS-06.
- **Schema do banco** — o armazenamento do cordão e a escala gradiente são tratados na `sealer-db-schema-design` (B-light: `sql-vk-common` + colunas `metrics jsonb` + stored procedures). Esta spec **consome** esse schema, não o redesenha.
- **Serviços de pipeline** (captura, processamento, stitch, `sealer-result`) — cobertos pelas specs SEALER-01/03/05/09. O `backend-ds` lê o que o pipeline gravou.
- **WebSocket / push** — frontend faz polling; backend lê on-demand.

## 3. Arquitetura de rede

```
┌──────────────────────────────────────────────────────────────┐
│ PC industrial na rede da planta Hyundai                        │
│                                                                │
│   Qualquer máquina da planta ──HTTP/HTTPS──┐                   │
│                                             ▼                  │
│                              ┌────────────────────────┐        │
│                              │  proxy reverso :80/:443 │ ← único│
│                              │  (HTTP ou HTTPS por env)│ exposto│
│                              └───────────┬────────────┘        │
│                                          │                     │
│                          ┌───────────────┴─────────────┐       │
│                          │   rede interna do PC         │       │
│                          │                              │       │
│                  ┌───────▼────────┐   ┌────────────────▼─────┐ │
│                  │ frontend-ds    │   │ backend-ds           │ │
│                  │ (Angular SPA)  │──▶│ profile vk-sealer    │ │
│                  │ profile        │   │ NÃO exposto na planta │ │
│                  │ vk-sealer      │   │ (só rede interna)     │ │
│                  └────────────────┘   └──────────┬───────────┘ │
│                                                   │             │
│                              ┌────────────────────┼───────────┐ │
│                         ┌────▼─────┐   ┌──────────▼─┐  ┌──────▼┐│
│                         │ Postgres │   │   Redis    │  │ disco ││
│                         │ B-light  │   │ tags PLC   │  │ imgs  ││
│                         │ (sealer) │   │ + cache    │  │       ││
│                         └──────────┘   └────────────┘  └───────┘│
└──────────────────────────────────────────────────────────────┘
```

**Pontos-chave:**
- O **proxy reverso** é o único processo escutando em IP roteável da planta. Serve o SPA e proxia `/api/*` para o backend.
- O `backend-ds` escuta **apenas na rede interna do PC** (binding Docker interno / `127.0.0.1`) — não é alcançável de outra máquina da planta.
- **HTTP vs HTTPS** por env var: Hyundai pode exigir um dos dois (GM exige HTTPS via CA local; Arcelor usa HTTP). HTTPS = HTTP + certificado emitido por uma CA; em rede sem internet usa-se cert da CA local do cliente ou autoassinado (este gera o aviso de "não seguro"). Abordagem validada no VK Steel.
- Sem auth, token ou mTLS app-level no MVP.

## 4. Mecanismo de profile (decisão arquitetural em aberto)

> Mesma constatação e mesmas alternativas da spec `sealer-frontend-ds` seção 4 — o usuário pediu que sejam **discutidas na spec**, não decididas aqui.

**Constatação:** o `backend-ds` hoje **não tem camada de profile** — o repo NestJS *é* a API do Body. Adicionar `vk-sealer` exige criar o conceito de profile.

- **Alternativa A — env var build/deploy** (`VK_PROFILE=body|sealer`): módulos NestJS, controllers e queries selecionados por profile. Alinha com a convenção `VR_PROFILE=steel|sealer` do `sealer-result`. Exige organizar o código Body sob um profile `body`.
- **Alternativa B — profile em runtime**: um build serve qualquer produto, profile por config. Mais flexível, mistura os dois produtos no mesmo processo.
- **Alternativa C — apps separados no mesmo repo**: `vk-body` e `vk-sealer` como apps NestJS irmãos, libs comuns compartilhadas. Sem refatorar o Body; menos reúso em runtime.

**Recomendação preliminar:** A, por consistência com `sealer-result`/`VR_PROFILE` e isolamento — decisão fica para a conversa arquitetural. Os endpoints da seção 5 são **agnósticos ao mecanismo**.

## 5. Endpoints por tela

> O modelo de dados de leitura gira em torno da **entidade cordão**: uma lista ordenada de **pontos de linha de centro** (`X/Y/Z`) com **atributos medidos por ponto** (presença, largura, altura, espessura). Conceitualmente análogo à camada *weight* do Blender — cada ponto carrega o valor que alimenta o mapa de cor. O armazenamento (colunas `metrics jsonb` do B-light) está na `sealer-db-schema-design`.

### 5.1 Tela Retrabalho
- `GET /api/sealer/carroceria/atual?estacao=<id>` — carroceria atualmente na estação (passiva; dirigida pelo PLC). Retorna `null` quando não há carro → frontend mostra "aguardando carroceria".
- `GET /api/sealer/carroceria/:id/cordoes` — todos os cordões da carroceria, cada um como lista de pontos `{x,y,z, presenca, largura, altura, espessura, status}`. É o que alimenta a visualização 3D.
- `GET /api/sealer/carroceria/:id/defeitos?lado=<esq|dir>` — defeitos **agrupados por cordão**, opcionalmente filtrados pelo lado (coordenada Y). Cordões transversais carregam o campo `dono` (regra em aberto — seção 7).

### 5.2 Tela Produção
- `GET /api/sealer/pecas?limit=N` — lista das peças/carrocerias que passaram, com status.
- `GET /api/sealer/saude` — saúde do sistema (status dos serviços de pipeline, câmeras, conexões).
- `GET /api/sealer/ultima-imagem?camera=<id>` — última imagem capturada por câmera, para monitoramento de estado (lente suja, falha de captura). Baixa frequência, não streaming.

### 5.3 Tela Tracking
- `GET /api/sealer/tracking?filtro=<classe>&page=N` — lista navegável de carrocerias históricas.
- `GET /api/sealer/tracking/:carroceriaId` — detalhe consolidado de uma carroceria (cordões + defeitos + métricas), incluindo os dados quantitativos contínuos que alimentam a escala gradiente/isoline.

## 6. Pipeline e consolidação

- A inspeção é feita **por etapas de captura**; o pipeline **costura ("stitch")** todas as capturas e só então analisa. **Não há visão costurada em tempo real** — o `backend-ds` serve o **resultado consolidado por carroceria**, disponível após o carro inteiro ser capturado.
- O `backend-ds` **não costura nada** — lê o consolidado que o pipeline gravou no Postgres B-light.
- Eventos de **carroceria presente/ausente** vêm de tags PLC no Redis; o endpoint `carroceria/atual` lê o Redis on-demand (frontend não conecta no Redis direto — mesmo padrão do IRIS-06).

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | Profile `vk-sealer` sobe sem arrastar controllers/queries exclusivos do Body | inspeção dos módulos carregados |
| 2 | `backend-ds` **não exposto** na rede da planta — só o proxy reverso responde | `nmap` de outra máquina lista só :80/:443 do proxy |
| 3 | HTTP vs HTTPS alternável por env var sem mudança de código | subir nos dois modos e validar |
| 4 | `GET /carroceria/:id/cordoes` retorna pontos de linha de centro + atributos por ponto | smoke com carroceria sintética |
| 5 | `GET /carroceria/:id/defeitos` agrupa defeitos por cordão e filtra por lado (Y) | smoke com defeitos distribuídos |
| 6 | `GET /ultima-imagem` retorna a imagem mais recente por câmera | popular disco/cache + curl |
| 7 | `GET /carroceria/atual` reflete a tag PLC do Redis (carro presente/ausente) | injetar tag sintética via `redis-cli` |
| 8 | Resultado consolidado disponível só após o stitch completo da carroceria | inspeção SQL após smoke E2E |
| 9 | Latência p99 < 100 ms para query típica (1 carroceria, cordões + defeitos) | k6/wrk + EXPLAIN ANALYZE |

## 8. Pendências (não bloqueiam a spec)

1. **Mecanismo de profile** — decisão arquitetural (seção 4), conversa mais profunda pendente.
2. **Cordão transversal** — regra de atribuição do campo `dono` (robô-responsável? maior comprimento por lado?).
3. **Escala de cor gradiente no banco** — não existe hoje; a `sealer-db-schema` precisa prever o campo. Coordenar.
4. **HTTP ou HTTPS na Hyundai** — confirmar exigência do cliente; se HTTPS, definir origem do certificado (CA local Hyundai? autoassinado?).
5. **Host do `backend-ds`** — confirmar com Vinicius em qual PC industrial roda (mesmo do pipeline ou adjacente).
6. **Contrato de API** — os endpoints da seção 5 são uma proposta; fechar com a spec `sealer-frontend-ds` e com o Guilherme antes da implementação.
7. **Catálogo de tags PLC** (carroceria presente, estação) — depende da definição de automação do SEALER.

## 9. Próximos passos

1. **User review** desta spec.
2. Conversa arquitetural sobre o mecanismo de profile (seção 4, compartilhada com a spec frontend).
3. Fechar o contrato de API com a spec `sealer-frontend-ds`.
4. Plan de implementação (`docs/superpowers/plans/2026-05-15-sealer-backend-ds.md`) com TDD.
5. Coordenar com `sealer-db-schema` o campo da escala gradiente e a estrutura do cordão.
