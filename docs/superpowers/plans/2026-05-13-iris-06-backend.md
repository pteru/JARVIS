# IRIS-06 backend-ds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para tocar este plano. Steps usam checkbox (`- [ ]`) para tracking.

**Goal:** Adaptar o serviço `visionking/services/backend-ds` (NestJS 10 + raw `pg` + Redis 4.7 + Socket.IO 10.4, porta 5777) para o deploy IRIS GM SCDS Paint. O escopo real de código é mínimo — **2 endpoints novos/patchados + flag de binding interno**. O resto do plano é configuração: nginx com cert GEUE CA, compose IRIS, env vars apontando para `vk_iris_03007`, e smoke test E2E validando que o backend **não fica exposto** na rede Hirschmann (defesa em profundidade: cliente acessa só nginx :443).

**Spec:** `docs/superpowers/specs/2026-05-13-iris-06-backend-design.md`

**Tech stack:** NestJS 10, TypeScript, raw `pg` (sem ORM), `redis` 4.7, Socket.IO 10.4, Jest. Deploy: Docker Compose + nginx 1.25+.

**Worktree:**
- backend-ds: `/home/teruel/worktrees/backend-iris-06/` (NEW — branch `feat/iris-06` off `origin/develop`, **não** `feat/display-01` que é feature branch concorrente)

**Audiência:** software dev (Pedro/Claude) pareando com Vinicius para host + IPs e com Gustavo / cyber GM para entrega do cert GEUE.

**Track ordering:** Track A (worktree + baseline) precede tudo. Tracks B (patch `group_name`) e C (endpoint `pvi-current`) podem ser feitas em paralelo após A. Track D (binding interno) depende de B+C estáveis. Track E (nginx + GEUE) e F (compose + smoke E2E) dependem de D. Track G é documentação de pendências — sem tasks executáveis.

**Estimativa total:** ~4 dias efetivos. Código real cabe em meio dia; o resto é config + procedimento + espera do cert GEUE.

---

## Track A — Worktree + baseline

### Task A1: Criar worktree off `origin/develop` e validar baseline Jest

**Files:**
- Worktree: `/home/teruel/worktrees/backend-iris-06/` (branch `feat/iris-06`)

- [ ] **Step 1: Criar worktree off `origin/develop`** (NÃO `feat/display-01`)

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/visionking/services/backend-ds
git fetch origin
git worktree add /home/teruel/worktrees/backend-iris-06 -b feat/iris-06 origin/develop
cd /home/teruel/worktrees/backend-iris-06
```

Expected: branch `feat/iris-06` criada a partir do tip de `develop`. Confirmar `git branch --show-current` retorna `feat/iris-06`.

- [ ] **Step 2: Instalar deps**

```bash
npm install
```

- [ ] **Step 3: Rodar testes existentes — baseline verde**

```bash
npm test 2>&1 | tail -20
```

Expected: suíte Jest atual passando. Se algum teste já falha em `develop`, registrar como dívida pré-existente (não bloqueia esta branch, mas anotar).

- [ ] **Step 4: Confirmar build limpo**

```bash
npm run build
```

Expected: `dist/` gerado sem erros TypeScript.

---

## Track B — Patch `GET /api/defects` com `group_name` (TDD)

### Task B1: Teste falhando — `group_name` filtra por estação

**Files:**
- Create: `src/modules/defects/controllers/defects.controller.spec.ts` (se ainda não existe; senão estender)
- Create: `src/modules/defects/services/defects.service.spec.ts`

- [ ] **Step 1 (RED):** Escrever specs Jest cobrindo 4 cenários do controller. Mock do `DefectsService` retornando arrays controlados:

```typescript
describe('DefectsController.getDefectsCoordinates', () => {
  it('sem params → retorna todos os defeitos (regression)', async () => {
    // espera chamada service.getDefectsCoordinates({ pecaId: undefined, groupName: undefined })
  });
  it('com pecaId apenas → mantém comportamento atual', async () => { /* ... */ });
  it('com pecaId + group_name → filtra por peça E estação', async () => { /* ... */ });
  it('com group_name apenas → filtra só por estação', async () => { /* ... */ });
});
```

E specs do service usando um `pg.Client` mockado (`jest.mock('pg')`) que captura a query SQL gerada e os params bindados:

```typescript
describe('DefectsService.getDefectsCoordinates', () => {
  it('sem filtros → query sem cláusula WHERE de subcomponente', () => { /* ... */ });
  it('com groupName → query faz JOIN com subcomponente e bind $2', () => { /* ... */ });
});
```

Expected: testes falham (controller ainda não aceita `group_name`; service não faz JOIN).

- [ ] **Step 2 (GREEN):** Patch no controller — `defects.controller.ts`:

```typescript
@Get()
async getDefectsCoordinates(
  @Query('pecaId') pecaId?: string,
  @Query('group_name') groupName?: string,
) {
  this.logger.log(`📍 GET /api/defects pecaId=${pecaId} group_name=${groupName}`);
  const pecaIdNum = pecaId ? parseInt(pecaId, 10) : undefined;
  return this.defectsService.getDefectsCoordinates({ pecaId: pecaIdNum, groupName });
}
```

- [ ] **Step 3 (GREEN):** Patch no service — `defects.service.ts`. Alterar assinatura para aceitar `{ pecaId?, groupName? }` e montar query parametrizada:

```sql
SELECT da.id, da.frame_id, da.peca_id, da.peca,
       cd.defect_class_name AS class_name,
       da.subcomponente_id, da.x_ct, da.y_ct, da.z_ct,
       s.group_name
FROM public.defeitos_agg da
LEFT JOIN public.classe_defeitos cd ON da.class_id = cd.id
LEFT JOIN public.subcomponente s ON da.subcomponente_id = s.id
WHERE ($1::int IS NULL OR da.peca_id = $1)
  AND ($2::text IS NULL OR s.group_name = $2)
ORDER BY da.id ASC;
```

Params: `[pecaId ?? null, groupName ?? null]`. Manter shape do response atual (`DefectResponse[]`) — não quebrar consumidores.

- [ ] **Step 4 (REFACTOR):** Rodar specs — todos verdes. Confirmar que `getDefectById` e `getDefectsCountByPeca` permanecem intocados (regression).

- [ ] **Step 5:** Validar manualmente contra DB local (se disponível): `curl 'http://localhost:5777/api/defects?pecaId=1&group_name=superior_direita'`.

**Estimativa Track B:** 1 dia.

---

## Track C — Endpoint `GET /api/redis/pvi-current` (TDD)

### Task C1: Teste falhando + endpoint novo

**Files:**
- Create: `src/modules/camera/controllers/camera.controller.spec.ts` (ou novo módulo `redis` — implementador decide; preferência por estender `camera` para reuso do `CameraRedisService`)
- Modify: `src/modules/camera/controllers/camera.controller.ts`
- Modify: `src/modules/camera/services/camera-redis.service.ts` (adicionar método `getPviForStation`)

- [ ] **Step 1 (RED):** Spec Jest:

```typescript
describe('GET /api/redis/pvi-current', () => {
  const VALID_STATIONS = ['superior_direita', 'superior_esquerda', 'lateral_direita', 'lateral_esquerda'];

  it('station inválida → 400 BadRequest', async () => { /* ... */ });

  VALID_STATIONS.forEach((station) => {
    it(`station=${station} → retorna {station, pvi}`, async () => {
      // mock redisClient.get → "PVI-123"
      // espera { station, pvi: 'PVI-123' }
    });
  });

  it('tag ausente no Redis → retorna {station, pvi: null}', async () => { /* ... */ });
});
```

Expected: testes falham (endpoint não existe; service não tem o método).

- [ ] **Step 2 (GREEN):** Adicionar método no `CameraRedisService`:

```typescript
private static readonly VALID_STATIONS = new Set([
  'superior_direita', 'superior_esquerda',
  'lateral_direita', 'lateral_esquerda',
]);

async getPviForStation(station: string): Promise<string | null> {
  if (!CameraRedisService.VALID_STATIONS.has(station)) {
    throw new BadRequestException(`station inválida: ${station}`);
  }
  // Nome exato da tag TBD — depende do catálogo ponto_iris.json de IRIS-02.
  // Convenção provisória: WS_Retrabalho_<STATION>_PVI (uppercase).
  const key = `WS_Retrabalho_${station.toUpperCase()}_PVI`;
  // Atenção: getPviForStation lê do DB de TAGS PLC (REDIS_DB_TAGS=1), não do DB de câmera (2).
  // Pode exigir um cliente Redis adicional OU select(db) on-demand. Implementador decide.
  return await this.redisClient.get(key);
}
```

- [ ] **Step 3 (GREEN):** Adicionar rota no `CameraController` (ou criar `RedisController` se preferir isolar):

```typescript
@Get('redis/pvi-current')
async getPviCurrent(@Query('station') station: string) {
  const pvi = await this.cameraRedisService.getPviForStation(station);
  return { station, pvi };
}
```

> Nota: prefixo `api/` já está no `@Controller('api/camera')`. Decidir se nova rota fica sob `api/camera/redis/pvi-current` (escopo lógico atual) ou se cria novo controller `@Controller('api/redis')` para casar com a URL prevista na spec. **Recomendado:** novo controller `RedisController` em módulo dedicado ou no camera module, para a URL ficar limpa em `/api/redis/pvi-current`.

- [ ] **Step 4 (REFACTOR):** Rodar specs — todos verdes. Documentar no header do método que o nome da tag é provisório e será confirmado quando IRIS-02 publicar o `ponto_iris.json`.

- [ ] **Step 5:** Smoke manual local: `redis-cli SET WS_Retrabalho_SUPERIOR_DIREITA_PVI "PVI-TEST"` → `curl 'http://localhost:5777/api/redis/pvi-current?station=superior_direita'` → JSON `{station:"superior_direita", pvi:"PVI-TEST"}`.

**Estimativa Track C:** 0,5 dia.

---

## Track D — Binding interno (não expor backend na Hirschmann)

### Task D1: Listen em `127.0.0.1` e/ou confirmar isolamento Docker

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1:** Patch em `main.ts` — passar host explícito para `app.listen()`:

```typescript
const port = parseInt(process.env.APP_PORT || '5777', 10);
const host = process.env.APP_BIND_HOST || '0.0.0.0'; // dev default; IRIS compose override = '127.0.0.1'
await app.listen(port, host);
```

Rationale: usar env var preserva dev/laminação (bind `0.0.0.0` continua default) e permite o compose IRIS forçar `127.0.0.1` sem fork de código. **Defesa em profundidade**: mesmo se o compose IRIS publicar a porta por engano, o backend recusa conexões fora do loopback do container.

- [ ] **Step 2:** Spec leve confirmando que o env é respeitado:

```typescript
// Test que NestFactory.listen é chamado com (port, host) corretos
// baseado em process.env.APP_BIND_HOST.
```

- [ ] **Step 3:** Documentar no compose IRIS (Track F) que o serviço **não tem `ports:`** mapeado para o host — fica só na rede Docker `iris-net`. Combinar com `APP_BIND_HOST=127.0.0.1` dentro do container é redundante por design (suspenders-and-belt).

- [ ] **Step 4:** Validar manualmente no host IRIS:
  - `docker ps` → linha do `backend-ds` **sem coluna `0.0.0.0:5777->...`**.
  - Do host: `curl 127.0.0.1:5777/api/health` falha (só nginx ouve no host) — esse comportamento é esperado.
  - De dentro do container nginx: `curl http://backend-ds:5777/api/health` retorna 200.
  - De uma TV na Hirschmann: `curl <ip_servidor>:5777/api/health` → connection refused.

**Estimativa Track D:** 0,5 dia.

---

## Track E — nginx + cert GEUE CA (config + procedimento)

> **Bloqueio parcial:** o cert real depende da ClickUp task `868jk1mkq` ([Cyber] Cert HTTPS via GEUE CA). Esta track scaffolda a config e usa o cert Strokmatic self-signed como placeholder para dev/smoke. Substituição é trivial (swap de arquivos no volume + reload).

### Task E1: Scaffold `nginx-iris.conf`

**Files:**
- Create: `infra/docker/iris/nginx/nginx-iris.conf`
- Create: `infra/docker/iris/nginx/ssl/.gitkeep` (volume mount target — certs reais ficam fora do repo)

- [ ] **Step 1:** Copiar `infra/docker/production/nginx/nginx-back.conf` como base. Ajustar:
  - `ssl_certificate /etc/ssl/certs/geue-ca-iris.pem;` (placeholder; dev usa Strokmatic self-signed).
  - `ssl_certificate_key /etc/ssl/private/geue-ca-iris-key.pem;`.
  - `server_name <ip-ou-hostname-iris>;` — atualizar quando Vinicius confirmar host.
  - `proxy_pass http://backend-ds:5777;` (resolução por DNS do compose).
  - Manter `location /` apontando para frontend (ainda a definir em IRIS-07; deixar stub com `return 200 "iris frontend pending\n";` por enquanto).

- [ ] **Step 2:** Adicionar headers de proxy padrão (`X-Forwarded-For`, `X-Real-IP`, `Host`).

- [ ] **Step 3:** Validar sintaxe — em container nginx temporário: `nginx -t -c /etc/nginx/nginx.conf`.

### Task E2: Procedimento de instalação do cert GEUE (runbook)

**Files:**
- Create: `infra/docker/iris/nginx/README-cert-install.md`

- [ ] **Step 1:** Documentar passo-a-passo da spec §4.4:
  1. Receber cert + chave + cadeia da GM (canal seguro Gustavo / cyber GM).
  2. Validar cadeia: `openssl verify -CAfile geue-ca-bundle.pem geue-ca-iris.pem`.
  3. Copiar para `/opt/iris/ssl/certs/geue-ca-iris.pem` (644 root) e `/opt/iris/ssl/private/geue-ca-iris-key.pem` (600 root).
  4. Mount no container via `docker-compose.yml` (Track F).
  5. Reload: `docker compose exec nginx nginx -s reload`.
  6. Validar de uma TV: `curl -v https://<ip-nginx>/api/health` retorna 200 sem warnings de cert.

- [ ] **Step 2:** Apontar pendência: SOP de **renovação** TBD com cyber GM antes do SOR (item 4 das pendências da spec).

**Estimativa Track E:** 1 dia (mostly espera do cert; doc + scaffold cabe em 2h).

---

## Track F — Compose IRIS + smoke test E2E

### Task F1: `docker-compose.yml` para deploy IRIS

**Files:**
- Create: `infra/docker/iris/docker-compose.yml`
- Create: `infra/docker/iris/.env.example`

- [ ] **Step 1:** Definir serviços `nginx` + `backend-ds`. Frontend (IRIS-07) entra depois — placeholder ou rota stub do nginx.

```yaml
services:
  nginx:
    image: nginx:1.25-alpine
    ports: ["443:443"]
    volumes:
      - ./nginx/nginx-iris.conf:/etc/nginx/nginx.conf:ro
      - /opt/iris/ssl/certs:/etc/ssl/certs:ro
      - /opt/iris/ssl/private:/etc/ssl/private:ro
    depends_on: [backend-ds]
    networks: [iris-net]

  backend-ds:
    image: visionking-backend-ds:${IMAGE_TAG:-iris-latest}
    # NOTA: SEM `ports:` — não expõe na Hirschmann.
    environment:
      APP_PORT: "5777"
      APP_BIND_HOST: "127.0.0.1"
      APP_HTTPS_ENABLED: "false"
      DB_HOST_POINT_ONE: "192.168.15.189"
      DB_PORT_POINT_ONE: "5432"
      DB_USER: "vk_iris"
      DB_PASS: "${VK_IRIS_DB_PASSWORD}"
      DB_NAME_DEVELOPMENT_POINT_ONE: "vk_iris_03007"
      REDIS_IP_POINT_ONE: "${REDIS_IRIS_HOST}"
      REDIS_PORT_POINT_ONE: "6379"
      REDIS_USER: "default"
      REDIS_PASSWORD: "${REDIS_IRIS_PASSWORD}"
      REDIS_DB_TAGS: "1"
      REDIS_DB_CAMERA: "2"
    networks: [iris-net]

networks:
  iris-net:
    driver: bridge
```

- [ ] **Step 2:** Criar `.env.example` com placeholders (sem secrets reais).

- [ ] **Step 3:** Smoke local (compose up + healthchecks).

### Task F2: Smoke test E2E (bash + curl)

**Files:**
- Create: `infra/docker/iris/smoke/smoke_test.sh`
- Create: `infra/docker/iris/smoke/seed_defects.sql`

- [ ] **Step 1:** Script `seed_defects.sql` pré-popula `vk_iris_03007` com 1 PVI sintético + 12 defeitos distribuídos pelas 4 estações (3 por `group_name`). Assume schema body já aplicado por IRIS-05 + `subcomponente` populada com 4 grupos.

- [ ] **Step 2:** Script `smoke_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PVI="${PVI:-PVI-SMOKE-001}"
NGINX_URL="${NGINX_URL:-https://localhost}"
BACKEND_IP="${BACKEND_IP:-<ip-do-servidor-iris>}"

# 1) Aplicar seed
psql -h 192.168.15.189 -U vk_iris -d vk_iris_03007 \
  -v pvi="$PVI" -f seed_defects.sql

# 2) Popular tag Redis para a estação superior_direita
redis-cli -h "$REDIS_IRIS_HOST" -n 1 \
  SET WS_Retrabalho_SUPERIOR_DIREITA_PVI "$PVI"

# 3) Pelo nginx, com group_name → 3 defeitos
COUNT=$(curl -ks "$NGINX_URL/api/defects?pecaId=1&group_name=superior_direita" | jq 'length')
[[ "$COUNT" -eq 3 ]] || { echo "FAIL: esperado 3, achou $COUNT"; exit 1; }

# 4) Pelo nginx, sem group_name → 12 defeitos (regression)
COUNT=$(curl -ks "$NGINX_URL/api/defects?pecaId=1" | jq 'length')
[[ "$COUNT" -eq 12 ]] || { echo "FAIL: regression, esperado 12, achou $COUNT"; exit 1; }

# 5) PVI corrente
PVI_OUT=$(curl -ks "$NGINX_URL/api/redis/pvi-current?station=superior_direita" | jq -r '.pvi')
[[ "$PVI_OUT" == "$PVI" ]] || { echo "FAIL: pvi=$PVI_OUT"; exit 1; }

# 6) Backend NÃO exposto na Hirschmann
if curl -ks --max-time 3 "http://${BACKEND_IP}:5777/api/health" > /dev/null 2>&1; then
  echo "FAIL: backend exposto em :5777 — esperado connection refused"
  exit 1
fi

echo "PASS: smoke E2E OK"
```

- [ ] **Step 3:** Rodar do host IRIS e de uma TV (Hirschmann) — passos 1-5 passam, passo 6 confirma que de uma TV o `:5777` direto é recusado.

**Estimativa Track F:** 1 dia.

---

## Track G — Pendências (DEFERIDAS, sem tasks)

> Documentação apenas. Tudo aqui é input externo — não bloqueia merge de A-F, mas bloqueia SOR.

- **Auth adicional GM** — confirmar com Gustavo / cyber GM se isolamento Hirschmann + HTTPS GEUE + backend não-exposto é suficiente, OU se exigem mTLS / token Bearer / IP allowlist. Default MVP: nenhuma camada app-level adicional.
- **Nome exato da tag Redis para PVI corrente** — depende do `ponto_iris.json` que Willer define em IRIS-02 (track E daquele plano). Convenção provisória adotada aqui: `WS_Retrabalho_<STATION>_PVI`. Quando alinhar, atualizar o helper no `CameraRedisService` (1 linha).
- **Host onde rodar o `backend-ds`** — TBD com Vinicius. Spec sugere mesmo PC do `pixel-to-object`/`database-writer` ou adjacente. Sem impacto no plano (só atualiza `server_name` do nginx e `BACKEND_IP` do smoke).
- **SOP de renovação do cert GEUE** — alinhar com cyber GM antes do SOR.
- **ClickUp blocker:** [Cyber] Cert HTTPS via GEUE CA (`868jk1mkq`) — IRIS-06 não vai para SOR sem essa resolvida.

---

## Critérios de merge para a branch `feat/iris-06`

1. ✅ Todos os testes Jest passam (suíte existente + novos specs: defects controller/service com `group_name`, camera redis com `getPviForStation`, main.ts honra `APP_BIND_HOST`).
2. ✅ `npm run build` sem erros TypeScript.
3. ✅ Regressão: `GET /api/defects` sem params retorna mesmo shape de hoje (consumido por Stellantis 03010).
4. ✅ Endpoint novo `GET /api/redis/pvi-current?station=X` valida allowlist, lê do Redis, retorna `{station, pvi}` (com `pvi=null` quando tag ausente).
5. ✅ Compose IRIS sobe nginx + backend-ds com cert placeholder (Strokmatic self-signed) — smoke E2E `smoke_test.sh` passa todos os 6 checks localmente.
6. ✅ `docker ps` no host IRIS não mostra port mapping para o backend; `nmap` externo da TV só vê :443 do nginx.
7. ⚠️ Substituição pelo cert GEUE real fica como **post-merge follow-up** quando `868jk1mkq` resolver — operação de swap de arquivos no volume + `nginx -s reload`, sem mudança de código.
8. ⚠️ Pendências da Track G ficam documentadas mas **não bloqueiam o merge**; bloqueiam SOR.

---

## Estimativa de esforço

| Track | Esforço |
|---|---|
| A — worktree + baseline | 0,25 dia |
| B — patch `group_name` (TDD) | 1 dia |
| C — endpoint `pvi-current` (TDD) | 0,5 dia |
| D — binding interno | 0,5 dia |
| E — nginx + cert GEUE (scaffold + runbook) | 1 dia (espera de cert à parte) |
| F — compose + smoke E2E | 1 dia |
| G — pendências (doc only) | 0 |

**Total código + config:** ~4 dias efetivos. Bloqueador externo: cert GEUE CA (ClickUp `868jk1mkq`) — sem ele o smoke roda com self-signed e o SOR não acontece.

**Honestidade do escopo:** o trabalho real de software é minúsculo — ~2 endpoints + 1 flag de bind. O peso desta entrega está em integração (env vars certas, nginx certo, cert certo, host certo) e em validar que o backend **realmente** não escapa da rede Docker.
