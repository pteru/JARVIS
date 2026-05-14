# IRIS-05 database-schema-deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` para tocar este plano. Steps usam checkbox (`- [ ]`) para tracking. Este é um runbook de deploy + validação — não há desenvolvimento de software além de scripts de seed e smoke test.

**Goal:** Provisionar instância Postgres dedicada no host `192.168.15.189`, aplicar o schema `sql-vk-body` greenfield no database `vk_iris_03007`, popular catálogos (`types`, `subcomponente`) com dados GM SCDS Paint, apontar `database-writer` para a nova instância e validar end-to-end com smoke test sintético.

**Spec:** `docs/superpowers/specs/2026-05-13-iris-05-database-schema-deploy-design.md`

**Tech stack:** Postgres 15+, SQL (DDL/DML), Python 3 (smoke test), bash, Docker Compose (`database-writer`). Sem mudanças no schema atual — todo o trabalho IRIS-specific é em seeds e configuração.

**Worktree:**
- Setup repo: `/home/teruel/worktrees/iris-05-deploy/` (NEW — branch `feat/iris-05-seeds` off `origin/master` do repo `visionking/services/setup`)

**Track ordering:** Track A (provisionamento) precede tudo. Tracks B (schema) e C (seeds) podem ser feitas em paralelo após A. Track D (database-writer + smoke test) depende de B+C concluídos. Track E (performance) depende de D. Track F é apenas documentação de pendências — não tem tasks executáveis.

**Estimativa total:** 3–5 dias corridos, sendo a maior parte tempo de espera (Vinicius para IP, Gustavo para lista de Styles). Esforço efetivo: ~1,5 dia.

---

## Track A — Provisionamento Postgres em 192.168.15.189

### Task A1: Reservar IP e definir acesso de rede

**Owner:** Pedro + Vinicius

- [ ] **Step 1:** Confirmar com Vinicius que `192.168.15.189` está livre na rede Strokmatic-side e registrar reserva no inventário de IPs.
- [ ] **Step 2:** Liberar acesso de rede do Workstation IRIS (TBD — confirmar IP da Workstation com Vinicius) até `.189:5432`. Documentar regra de firewall.
- [ ] **Step 3:** Validar conectividade: `nc -zv 192.168.15.189 5432` da Workstation IRIS retorna sucesso após Postgres estar UP (Task A2).

### Task A2: Instalar Postgres 15 e criar database/usuário

**Files:**
- Create: `~/.secrets/vk_iris_db_password` (chmod 600)
- Create: `scripts/iris-05/00_bootstrap_postgres.sh` (apt install + initdb + service enable)

- [ ] **Step 1:** Provisionar host (VM ou bare-metal) com Ubuntu 22.04+ no IP `.189`. Acesso SSH como `strokmatic`.

- [ ] **Step 2:** Instalar Postgres 15+ via apt (`postgresql-15` + `postgresql-contrib-15`). Habilitar serviço.

- [ ] **Step 3:** Configurar `postgresql.conf`:
  - `listen_addresses = '*'`
  - `max_connections = 100` (default; ajustar se smoke test pedir)
  - `shared_buffers = 256MB` (mínimo razoável)

- [ ] **Step 4:** Configurar `pg_hba.conf` para aceitar conexões do IP da Workstation IRIS via `md5`. Bloquear o resto.

- [ ] **Step 5:** Gerar senha forte e salvar em `~/.secrets/vk_iris_db_password` (chmod 600). Criar usuário e database:

```sql
CREATE USER vk_iris WITH PASSWORD '<senha-do-secret>';
CREATE DATABASE vk_iris_03007 OWNER vk_iris;
GRANT ALL PRIVILEGES ON DATABASE vk_iris_03007 TO vk_iris;
```

- [ ] **Step 6:** Reiniciar Postgres. Validar login remoto: `psql -h 192.168.15.189 -U vk_iris -d vk_iris_03007 -c 'SELECT 1'`.

---

## Track B — Schema deploy (`sql-vk-body`)

### Task B1: Criar worktree e copiar DDL

**Files:**
- Worktree: `/home/teruel/worktrees/iris-05-deploy/` (branch `feat/iris-05-seeds`)

- [ ] **Step 1:** Criar worktree do repo setup:

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/visionking/services/setup
git fetch origin
git worktree add /home/teruel/worktrees/iris-05-deploy -b feat/iris-05-seeds origin/master
cd /home/teruel/worktrees/iris-05-deploy
ls infra-structure/postgres/sql-vk-body/
```

Expected: arquivos `schema_body.sql` + diretórios `functions/` e `triggers/` visíveis.

### Task B2: Aplicar DDL na ordem (smoke-test-first)

**Files:**
- Create: `scripts/iris-05/01_apply_schema.sh`
- Create: `scripts/iris-05/smoke_test_schema.sh` (lista `\dt` e conta tabelas esperadas)

- [ ] **Step 1 (RED):** Escrever `smoke_test_schema.sh` antes do deploy:

```bash
#!/usr/bin/env bash
set -euo pipefail
EXPECTED_TABLES=(pecas types subcomponente frames frames_pecas defeitos defeitos_agg inspecao classe_defeitos)
COUNT=$(psql -h 192.168.15.189 -U vk_iris -d vk_iris_03007 -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename = ANY('{$(IFS=,; echo "${EXPECTED_TABLES[*]}")}'::text[])")
[[ "$COUNT" -eq "${#EXPECTED_TABLES[@]}" ]] || { echo "FAIL: esperado ${#EXPECTED_TABLES[@]} tabelas, achou $COUNT"; exit 1; }
echo "PASS: schema completo"
```

Rodar antes do deploy → **FAIL esperado** (database vazio).

- [ ] **Step 2 (GREEN):** Aplicar DDL na ordem da spec §4.1:
  1. `sql-vk-body/schema_body.sql`
  2. `sql-vk-body/functions/fn_insere_frames_body_v2.sql`
  3. `sql-vk-body/functions/fn_insere_defeitos_body_v2.sql`
  4. `sql-vk-body/functions/fn_agrega_defeitos_body.sql`
  5. `sql-vk-body/triggers/fn_trigger_agrega_defeitos_body.sql`
  6. `sql-vk-body/functions/fn_process_aggregation_queue_batch.sql`
  7. `sql-vk-body/functions/fn_aggregate_defects_centroid.sql`

Encapsular em `01_apply_schema.sh` para ser idempotente-amigável (parar no primeiro erro).

- [ ] **Step 3 (GREEN):** Rerodar `smoke_test_schema.sh` → **PASS esperado**.

- [ ] **Step 4:** Validar índices presentes:

```bash
psql -h 192.168.15.189 -U vk_iris -d vk_iris_03007 -c "\di" | grep -E "peca_idx|idx_defeitos_peca_id_class_id|idx_frames_pecas_peca_id|idx_defeitos_frame_id|frames_frame_uuid_idx_hash"
```

Esperar 5 índices listados (conforme spec §5).

---

## Track C — Populate catálogos (seeds iniciais)

### Task C1: Seed `types` (placeholders até Gustavo confirmar Styles)

**Files:**
- Create: `infra-structure/postgres/sql-vk-body/seeds/seed_types_03007.sql`

- [ ] **Step 1:** Criar seed com placeholders idempotentes (re-runnable):

```sql
-- IRIS-05 placeholder Styles GM SCDS Paint (substituir após confirmação Gustavo)
INSERT INTO types (internal_id, type_code, type_name, type_description, type_width, type_height) VALUES
  (1, 'TBD-001', 'Placeholder Style 1', 'Smoke test only — substituir', 4500, 1500),
  (2, 'TBD-002', 'Placeholder Style 2', 'Smoke test only — substituir', 4500, 1500),
  (3, 'TBD-003', 'Placeholder Style 3', 'Smoke test only — substituir', 4500, 1500)
ON CONFLICT (type_code) DO NOTHING;
```

- [ ] **Step 2:** Aplicar seed: `psql -h .189 -U vk_iris -d vk_iris_03007 -f seed_types_03007.sql`.

- [ ] **Step 3:** Validar: `SELECT count(*) FROM types` ≥ 3.

### Task C2: Seed `subcomponente` (painéis + `group_name` por estação)

**Files:**
- Create: `infra-structure/postgres/sql-vk-body/seeds/seed_subcomponente_03007.sql`

- [ ] **Step 1:** Criar seed cobrindo painéis externos com `group_name` mapeado para as **4 estações de retrabalho confirmadas no design VK Body** (Figma `ZDfitEWm0gYTmGYbyxRnf7`, frame "proposta - lista accordion"). Padrão `ON CONFLICT` matching `subcomponente_3d_file_unique` constraint:

```sql
-- IRIS-05 painéis externos SCDS Paint
-- 4 estações: superior_direita, superior_esquerda, lateral_direita, lateral_esquerda
INSERT INTO subcomponente
  (subcomponente_code, subcomponente_name, type_id, subcomponente_3d_file, category_code, id_group, group_name)
VALUES
  -- superior_direita (vista de cima, lado direito da carroceria)
  ('teto_rh_ex',        'Teto Externo Direito',             NULL, NULL, 'EXT', 1, 'superior_direita'),
  ('capo_rh_ex',        'Capô Externo Direito',             NULL, NULL, 'EXT', 1, 'superior_direita'),
  ('porta_mala_rh_ex',  'Porta-malas Externo Direito',      NULL, NULL, 'EXT', 1, 'superior_direita'),
  -- superior_esquerda (vista de cima, lado esquerdo)
  ('teto_lh_ex',        'Teto Externo Esquerdo',            NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  ('capo_lh_ex',        'Capô Externo Esquerdo',            NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  ('porta_mala_lh_ex',  'Porta-malas Externo Esquerdo',     NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  -- lateral_direita
  ('porta_di_rh_ex',    'Porta Dianteira Direita Externa',  NULL, NULL, 'EXT', 3, 'lateral_direita'),
  ('porta_tr_rh_ex',    'Porta Traseira Direita Externa',   NULL, NULL, 'EXT', 3, 'lateral_direita'),
  ('lat_rh_ex',         'Lateral Direita Externa',          NULL, NULL, 'EXT', 3, 'lateral_direita'),
  -- lateral_esquerda
  ('porta_di_lh_ex',    'Porta Dianteira Esquerda Externa', NULL, NULL, 'EXT', 4, 'lateral_esquerda'),
  ('porta_tr_lh_ex',    'Porta Traseira Esquerda Externa',  NULL, NULL, 'EXT', 4, 'lateral_esquerda'),
  ('lat_lh_ex',         'Lateral Esquerda Externa',         NULL, NULL, 'EXT', 4, 'lateral_esquerda')
ON CONFLICT ON CONSTRAINT subcomponente_3d_file_unique DO NOTHING;
```

> **Nota:** `subcomponente_3d_file = NULL` provisório até CAD GM chegar ([G5]). Re-rodar seed com path real depois — `ON CONFLICT DO NOTHING` é seguro: para substituir, fazer UPDATE explícito no follow-up.

- [ ] **Step 2:** Aplicar seed.

- [ ] **Step 3:** Validar:

```sql
SELECT DISTINCT group_name FROM subcomponente ORDER BY group_name;
-- esperado: lateral_direita, lateral_esquerda, superior_direita, superior_esquerda
SELECT count(*) FROM subcomponente WHERE category_code='EXT';  -- esperado: 12
```

---

## Track D — `database-writer` config + smoke test E2E

### Task D1: Configurar `database-writer` para apontar para `.189`

**Files:**
- Modify: compose do `database-writer` na Workstation IRIS (`visionking/services/database-writer/docker-compose.iris.yml` — criar se não existir baseado no compose body padrão)

- [ ] **Step 1:** Identificar compose ativo em uso. Confirmar variáveis env necessárias:

```yaml
environment:
  DB_WRITER_POSTGRES_HOST: "192.168.15.189"
  DB_WRITER_POSTGRES_PORT: "5432"
  DB_WRITER_POSTGRES_DB:   "vk_iris_03007"
  DB_WRITER_POSTGRES_USER: "vk_iris"
  DB_WRITER_POSTGRES_PASSWORD_FILE: "/run/secrets/vk_iris_db_password"
  INSERT_FUNCTION: "insert_frames_pecas_v2"
  MESSAGE_PROCESSING_MODE: "INDIVIDUAL"
```

- [ ] **Step 2:** Bind-mount o secret. **Não commitar a senha**.

- [ ] **Step 3:** Subir o container e verificar log: `Connected to Postgres at 192.168.15.189 ... insert_function=insert_frames_pecas_v2`. Sem erros.

### Task D2: Smoke test sintético (TDD — escrever ANTES de publicar mensagens)

**Files:**
- Create: `scripts/iris-05/smoke_test_e2e.py`
- Create: `scripts/iris-05/fixtures/synthetic_frame_payload.json`

- [ ] **Step 1 (RED):** Escrever o smoke test antes de qualquer mensagem real:

```python
# scripts/iris-05/smoke_test_e2e.py
# 1. Conecta no Postgres .189
# 2. Limpa estado: TRUNCATE pecas, frames, frames_pecas, defeitos, defeitos_agg CASCADE
# 3. Conecta no RabbitMQ da Workstation IRIS
# 4. Publica N=10 mensagens sintéticas (peca=PVI_SMOKE_001, type_id=1, subcomponente_id válido,
#    bbox 2D, class_id de classe_defeitos seeded ou dummy)
# 5. Aguarda 5s
# 6. Asserts:
#    - SELECT count(*) FROM pecas WHERE peca='PVI_SMOKE_001' == 1
#    - SELECT count(*) FROM frames_pecas WHERE peca_id=... == 10
#    - SELECT count(*) FROM defeitos WHERE peca_id=... >= 10
#    - SELECT count(*) FROM defeitos_agg WHERE peca_id=... >= 1  (trigger agregação disparou)
# 7. Print PASS / FAIL com detalhe
```

Rodar **antes** do `database-writer` estar conectado/configurado → **FAIL esperado** (timeout ou DB vazio).

- [ ] **Step 2 (GREEN):** Garantir que Track D1 está completa (database-writer rodando e conectado). Rerodar smoke test → **PASS esperado**.

- [ ] **Step 3:** Validar payload `insert_frames_pecas_v2` aceitou shape body sem ajuste:
  - Sem erros no log do `database-writer`.
  - Função não levantou exception (verificar `pg_stat_statements` se ativado, ou log do PG).

- [ ] **Step 4:** Validar trigger de agregação:

```sql
SELECT peca_id, class_id, count(*) FROM defeitos_agg
WHERE peca_id IN (SELECT id FROM pecas WHERE peca='PVI_SMOKE_001')
GROUP BY peca_id, class_id;
```

Esperar pelo menos 1 row (trigger `fn_trigger_agrega_defeitos_body` agregou os defeitos do smoke test).

---

## Track E — Validação de performance (TV de retrabalho)

### Task E1: Pré-popular DB com dataset sintético

**Files:**
- Create: `scripts/iris-05/seed_performance_dataset.sql`

- [ ] **Step 1:** Script SQL que popula:
  - 100 carrocerias (`pecas`) com PVIs sintéticos `PVI_PERF_0001..0100`
  - Para cada carroceria: 50 `defeitos` distribuídos entre os 9 subcomponentes (~6 por subcomponente)
  - Frames + frames_pecas correspondentes (`generate_series` ajuda)

- [ ] **Step 2:** Rodar `VACUUM ANALYZE` após o seed para o planner ter estatísticas atualizadas.

### Task E2: `EXPLAIN ANALYZE` da query da TV

**Files:**
- Create: `scripts/iris-05/perf_check_retrabalho.sql`

- [ ] **Step 1:** Query típica que o frontend-iris faz (1 carroceria, 1 estação):

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT d.*, s.subcomponente_name, s.group_name
FROM defeitos d
JOIN frames_pecas fp ON d.frame_id = fp.frame_id
JOIN pecas p ON fp.peca_id = p.id
JOIN subcomponente s ON d.subcomponente_id = s.id
WHERE p.peca = 'PVI_PERF_0042'
  AND s.group_name = 'superior_direita';
```

- [ ] **Step 2:** Rodar 5 vezes (descartar primeira por cold cache). Extrair `Execution Time` médio.

- [ ] **Step 3:** **Critério de aceite #6:** Execution Time < 100 ms. Se falhar, investigar plano (index scan vs seq scan); se necessário criar índice adicional **fora deste plano** (raise issue, não bloquear).

---

## Track F — Pendências deferidas (não há tasks executáveis)

Apenas documentar e linkar nos sítios certos para tracking. **Não bloqueiam o merge do IRIS-05.**

- [ ] **F1 — Lista oficial de Styles GM SCDS Paint** — solicitar a Gustavo. Substituir placeholders `TBD-00X` por Styles reais antes do bench Buy-Off (06/07). Registrar no ClickUp `[3.5]` como subtask.
- [ ] **F2 — CAD files para `subcomponente_3d_file`** — depende de [G5] (envio de carroceria/CAD GM → Joinville). Atualizar `subcomponente` com paths reais (UPDATE explícito) quando arquivos chegarem.
- [ ] **F3 — Nomes finais das estações de retrabalho** — confirmar com Gustavo. Design VK Body define 4 estações (`superior_direita`, `superior_esquerda`, `lateral_direita`, `lateral_esquerda`); SCDS pode operar com granularidade diferente — se mudar, UPDATE em `group_name`/`id_group`.
- [ ] **F4 — Política de retenção/arquivamento** — decisão pendente até SOR final (06/10). Documentar quando definida.

---

## Critérios de merge para a branch `feat/iris-05-seeds`

1. Track A completo: Postgres `.189` UP, database `vk_iris_03007` + user `vk_iris` criados, conectividade da Workstation IRIS validada.
2. Track B completo: `smoke_test_schema.sh` PASS — todas as 9 tabelas e 5 índices presentes.
3. Track C completo: seeds `types` (≥ 3 placeholders) e `subcomponente` (12 painéis, 4 `group_name`) aplicados.
4. Track D completo: `database-writer` apontando para `.189`, `smoke_test_e2e.py` PASS, trigger de agregação validada.
5. Track E completo: `EXPLAIN ANALYZE` da query de retrabalho < 100 ms com dataset 100×50.
6. Track F documentada — pendências registradas no ClickUp `[3.5]` como subtasks ou follow-ups, **sem bloquear merge**.

---

## Estimativa de esforço

| Track | Esforço efetivo | Bloqueador externo |
|---|---|---|
| A — Provisionamento PG | 0,5 dia | Vinicius (IP + firewall) |
| B — Schema deploy | 0,5 dia | depende de A |
| C — Seeds iniciais | 0,5 dia | Gustavo (lista Styles real — placeholders OK para smoke) |
| D — DB-writer + smoke E2E | 1 dia | depende de B+C |
| E — Performance | 0,5 dia | depende de D |
| F — Pendências documentadas | 0 (apenas registro) | — |

**Total efetivo:** ~3 dias de trabalho. **Total corrido:** 3–5 dias contando esperas externas (Vinicius, Gustavo).
