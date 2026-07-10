---
type: Design Spec
title: IRIS-06 — backend-iris
description: Habilitar o serviço `visionking/services/backend-ds` (NestJS + raw `pg`) para o IRIS GM SCDS aproveitando a POC já feita para o demo Stellantis 03010 (mesmo produto VK Body). IRIS-06 é, na prática,...
timestamp: 2026-05-13
---

# IRIS-06 — backend-iris

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Project:** 03007 IRIS GM SCDS Paint
**ClickUp:** [3.7] IRIS-06 spec (`868jk1j8e`)
**Deadline interno:** 09/06 (spec → implementação → integração)

## 1. Goal

Habilitar o serviço `visionking/services/backend-ds` (NestJS + raw `pg`) para o IRIS GM SCDS aproveitando a POC já feita para o demo Stellantis 03010 (mesmo produto VK Body). IRIS-06 é, na prática, **um deploy do backend-ds com 1 patch funcional** (parâmetro novo no endpoint de defeitos + JOIN com `subcomponente.group_name`) e ajustes de exposição de rede para que **o backend não fique exposto diretamente na rede GM** — só o frontend, via nginx, terá acesso a ele.

## 2. Scope

**In:**
- Deploy do `backend-ds` no host Strokmatic-side (mesmo PC do `pixel-to-object`/`database-writer` ou adjacente, TBD com Vinicius).
- Conexão com o Postgres do IRIS-05 (`vk_iris_03007` em `192.168.15.189`).
- Conexão com Redis (mesmo cluster usado pelos serviços upstream).
- Patch funcional: estender `GET /api/defects?pecaId=X` para aceitar **parâmetro `group_name=Y`** filtrando os defeitos por estação de retrabalho via JOIN com `subcomponente`.
- Binding de rede do backend **apenas na rede interna Docker** (`network: bridge` privada, sem expor porta na Hirschmann).
- nginx exposto na porta 443 da Hirschmann como **único entrypoint público**, terminando HTTPS com cert GEUE CA e proxiando `/api/*` para o backend interno.
- Smoke test E2E com 1 PVI sintético + 4 inserts vindos de 4 câmeras → query por `pecaId` + `group_name` retorna o subset correto.

**Out (rejeitado ou deferido):**
- **Auth no backend** — controle de acesso vive em (a) isolamento Hirschmann + (b) backend não exposto diretamente + (c) auth + roles do frontend (IRIS-07, em rev futura). Backend confia que tudo que chega via nginx é legítimo.
- **IP allowlist / mTLS / token Bearer** — defesa em profundidade adicional. Pendente confirmação cyber GM; se exigirem, evoluímos em segunda volta.
- **Subscriber Redis** — o `display-manager` foi descartado (ver memória `project_03007_iris_no_display_manager`). Frontend faz polling do backend; backend lê Redis on-demand quando frontend pede.
- **Endpoint novo `/by-pvi`** — escolha b2: estender `/api/defects` existente em vez de criar rota paralela.
- **Heatmap PNG / 3D mesh dinâmico** — fora do MVP. Frontend renderiza via GLB local + bounding boxes (mesmo padrão `frontend-ds`).
- **`subcomponente_3d_file` ativo** — depende do CAD da GM ([G5]), tratado pelo populate de IRIS-05 quando chegar.

## 3. Architecture

```
                  Rede Hirschmann (isolada)
                            │
                            ▼
                  ┌──────────────────┐
                  │  nginx :443      │  ← único exposto
                  │  GEUE CA cert    │     HTTPS termination
                  └────────┬─────────┘
                           │
                ┌──────────┴──────────┐
                │  internal docker    │
                │  network            │
                │                     │
       ┌────────▼────┐       ┌───────▼─────┐
       │ frontend    │       │ backend-ds  │  ← NÃO bindado
       │ (Angular)   │       │  porta 5777 │     na Hirschmann
       │ serve /     │ ────▶ │  /api/*     │     (só Docker)
       └─────────────┘       └──────┬──────┘
                                    │
                       ┌────────────┼────────────┐
                       │            │            │
                  ┌────▼───┐  ┌─────▼────┐  ┌───▼──────┐
                  │Postgres│  │  Redis   │  │  Redis   │
                  │.189    │  │  DB 1    │  │  DB 2    │
                  │vk_iris │  │  PLC tags│  │  Camera  │
                  │_03007  │  │  (PVI)   │  │  cache   │
                  └────────┘  └──────────┘  └──────────┘
```

**Pontos-chave:**
- nginx é o único processo escutando em IP roteável da Hirschmann.
- `backend-ds` escuta apenas na rede Docker (binding `127.0.0.1` ou rede bridge interna).
- Frontend chama `/api/*` relativo à mesma origem; nginx proxia internamente.
- Sem auth no backend; sem token; sem mTLS no MVP.

## 4. Mudanças necessárias

### 4.1 Endpoint `GET /api/defects` — parâmetro `group_name`

Hoje o controller `DefeitoController` aceita `pecaId` (filtro por peça). Estender para aceitar `group_name` como filtro adicional, opcional. Quando presente, query faz JOIN com `subcomponente`:

```typescript
@Get()
async findAll(
  @Query('pecaId') pecaId?: string,
  @Query('group_name') groupName?: string,
) {
  return this.defeitoService.findAll({ pecaId, groupName });
}
```

Na camada de serviço (raw `pg`):

```sql
-- pseudo
SELECT d.*, s.subcomponente_name, s.group_name
FROM defeitos_agg d
LEFT JOIN subcomponente s ON d.subcomponente_id = s.id
WHERE ($1::text IS NULL OR d.peca = $1)
  AND ($2::text IS NULL OR s.group_name = $2);
```

Comportamento:
- Sem param → mantém comportamento atual (todos defeitos, compatível com Stellantis 03010).
- `pecaId` → defeitos da peça (comportamento atual).
- `pecaId + group_name` → defeitos da peça filtrados pela estação.
- Só `group_name` → defeitos da estação em todas peças (improvável uso real, mas barato de suportar).

**Performance:** índice composto `(peca_id, subcomponente_id)` já existe no body schema (`idx_defeitos_peca_id_class_id` cobre `peca_id`; JOIN com `subcomponente` é por `id` PK). Critério de aceite #5: query p99 < 100 ms para 1 PVI com 50 defeitos.

### 4.2 Endpoint auxiliar para PVI corrente — `GET /api/redis/pvi-current`

Frontend precisa saber qual PVI está atualmente na área de retrabalho de cada estação. Em vez do front conectar direto no Redis (carrega 4 conexões adicionais), backend expõe leitura simples:

```typescript
@Get('redis/pvi-current')
async getCurrentPvi(@Query('station') station: string) {
  // valida station ∈ {superior_direita, superior_esquerda, lateral_direita, lateral_esquerda}
  const key = `WS_Retrabalho_${station.toUpperCase()}_PVI`;
  const pvi = await this.redisService.get(key);
  return { station, pvi: pvi ?? null };
}
```

Nome exato da tag (`WS_Retrabalho_*_PVI`) **a confirmar com Willer** — depende do `ponto_iris.json` do IRIS-02. Pendência na seção 7.

### 4.3 Binding interno (não expor backend na Hirschmann)

No `main.ts`, mudar listen de `0.0.0.0` para `127.0.0.1` (ou simplesmente confiar no Docker network — backend container não publica porta na host).

No `docker-compose.yml` do deploy IRIS:
- nginx: `ports: ["443:443"]` (expõe)
- backend: **sem `ports`** (só `expose` ou nada — fica apenas na rede Docker)
- frontend: idem (apenas servido via nginx)

### 4.4 nginx + GEUE CA cert

Reaproveitar config do `infra/docker/production/nginx/nginx-back.conf` (atual aponta para `strokmatic.pem`). Mudanças:

- Substituir `ssl_certificate /etc/ssl/certs/strokmatic.pem` por `/etc/ssl/certs/geue-ca-iris.pem`.
- `ssl_certificate_key /etc/ssl/private/geue-ca-iris-key.pem`.
- **Processo de instalação** (apêndice operacional):
  1. Obter cert + chave + cadeia da GM via canal seguro (Gustavo / cyber GM).
  2. Validar cadeia: `openssl verify -CAfile geue-ca-bundle.pem geue-ca-iris.pem`.
  3. Copiar para `/etc/ssl/certs/` e `/etc/ssl/private/` no host (permissões 644 / 600 respectivamente, owner root).
  4. Mount como volume no container nginx.
  5. Reload nginx (`nginx -s reload`) ou restart do container.
  6. Validar de uma TV: `curl -v https://<ip-nginx>/api/health` deve retornar 200 sem warnings.
- **Renovação** — definir SOP com GM antes da expiração; cert auto-renewal típico GEUE TBD.

### 4.5 Configuração `database-writer` + `backend-ds` apontando para vk_iris_03007

Env vars do `backend-ds` (compose do IRIS):

```yaml
environment:
  PG_HOST: "192.168.15.189"
  PG_DATABASE: "vk_iris_03007"
  PG_USER: "vk_iris"
  PG_PASSWORD: "${VK_IRIS_DB_PASSWORD}"
  REDIS_HOST: "<redis_iris_host>"
  REDIS_DB_TAGS: "1"
  REDIS_DB_CAMERA: "2"
  APP_PORT: "5777"
  APP_HTTPS_ENABLED: "false"  # TLS é no nginx
```

## 5. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | `backend-ds` rodando, conectado ao Postgres `vk_iris_03007` e ao Redis IRIS, **não exposto** na Hirschmann | `nmap` da TV deve listar só porta 443 do nginx no IP do servidor; `docker ps` não mostra port mapping pro backend |
| 2 | nginx termina HTTPS com cert GEUE; TVs aceitam o cert sem warning | abrir SPA pela URL HTTPS em browser do PC kiosk → cadeado verde |
| 3 | `GET /api/defects?pecaId=<PVI>&group_name=superior_direita` retorna apenas defeitos do PVI nessa estação | smoke test com PVI sintético + 12 defeitos espalhados pelas 4 estações |
| 4 | `GET /api/redis/pvi-current?station=superior_direita` lê a tag do Redis e retorna `{station, pvi}` | popular Redis com tag de teste + curl |
| 5 | Latência p99 < 100 ms para query típica (1 PVI, ~50 defeitos, 1 estação) | k6 / wrk + EXPLAIN ANALYZE |
| 6 | Frontend (IRIS-07) consegue chamar `/api/*` via nginx; chamadas diretas ao backend de fora do Docker network falham | curl da TV pro IP+5777 falha; curl pro nginx 443/api/health passa |
| 7 | Schema body funcional: 4 inserts por câmera (de IRIS-02→pixel-to-object→database-writer) agrupam-se corretamente por `peca = PVI` | inspeção SQL após smoke test E2E |

## 6. Pendências (não bloqueiam a spec)

1. **Auth adicional GM** — confirmar com Gustavo / cyber GM se rede isolada + HTTPS GEUE + backend não-exposto é suficiente, OU se exigem mTLS / token Bearer / IP allowlist explícita. Default no MVP: nenhuma camada app-level adicional.
2. **Nome exato da tag Redis para PVI corrente** (`WS_Retrabalho_<station>_PVI` ou similar) — depende do catálogo `ponto_iris.json` que Willer vai definir no IRIS-02.
3. **Hostname onde rodar o backend-iris** — confirmar com Vinicius (mesmo PC `192.168.15.189` que hospeda Postgres + Redis? Ou adjacente?).
4. **Política de renovação do cert GEUE** — SOP a alinhar com cyber GM antes do SOR.
5. **Pendência cyber GM já no ClickUp:** [Cyber] Cert HTTPS via GEUE CA (`868jk1mkq`) — urgente, late. IRIS-06 não pode entrar em SOR sem ela resolvida.

## 7. Próximos passos

1. **User review** desta spec.
2. Plan de implementação (`docs/superpowers/plans/2026-05-13-iris-06-backend.md`) com TDD focado em: patch `group_name`, endpoint `pvi-current`, smoke tests com nginx, validação de não-exposição.
3. Coordenar com Vinicius: host do backend, IPs internos, nginx config.
4. Acompanhar [Cyber] Cert HTTPS via GEUE CA — destrava o deploy do nginx.
