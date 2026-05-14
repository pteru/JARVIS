# IRIS-05 — database schema deploy

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Project:** 03007 IRIS GM SCDS Paint
**ClickUp:** [3.5] IRIS-05 spec (`868jk1hyc`)
**Deadline interno:** 09/06 (spec → implementação → integração)

## 1. Goal

Provisionar o banco de dados do IRIS GM SCDS como **um deploy novo do schema `sql-vk-body` em uma instância Postgres dedicada** (greenfield, sem migração) e popular as tabelas de catálogo (`types`, `subcomponente`) com os dados específicos do cliente GM para a linha de Paint do SCDS.

O schema atual não precisa de mudanças. Toda a semântica IR-específica é **tratada upstream** (`camera-acquisition` adapta-se via IRIS-02; `pixel-to-object` adapta-se via IRIS-03) — para o banco, IRIS é só "mais um produto body". Imagens IR são salvas como PNG (mesma extração de bounding boxes que body); não há atributos térmicos.

## 2. Scope

**In:**
- Deploy da instância Postgres no host `192.168.15.189` (rede Strokmatic-side).
- Execução do DDL `sql-vk-body/schema_body.sql` + functions + triggers.
- Populate de `types` com os Styles GM do programa SCDS Paint (lista a confirmar com engenharia GM).
- Populate de `subcomponente` com os painéis pertinentes para inspeção IRIS (teto, capô, porta-malas, portas, colunas, caixas de roda, etc.) — incluindo `group_name` e `id_group` mapeados para as **4 estações de retrabalho confirmadas no design VK Body** (Figma file `ZDfitEWm0gYTmGYbyxRnf7`, frame "proposta - lista accordion"): `superior_direita`, `superior_esquerda`, `lateral_direita`, `lateral_esquerda`.
- Configuração do serviço `database-writer` apontando para a nova instância via env vars.
- Smoke test end-to-end com 1 carroceria sintética.

**Out (rejeitado ou deferido):**
- Novas tabelas — schema body atual cobre tudo.
- Novos índices — todos os índices necessários para a query da TV de retrabalho já existem (ver §5).
- Função de inserção nova — `insert_frames_pecas_v2(JSONB)` é a função usada em produção body/Stellantis 03010 e serve direto (a confirmar no smoke test).
- Atributos térmicos (temperatura, ΔT, ranges) — câmera IR não é calibrada radiometricamente; só geramos detecções 2D de defeito como qualquer outro VK body.
- Retenção / arquivamento de imagens — deferido (decisão posterior).
- Generalização `sql-vk-common` — William está mapeando isso no Sealer; IRIS não depende.
- Migração de dados — deploy é greenfield. Demo Stellantis 03010 não é migrada.

## 3. Architecture

```
            ┌──────────────────────────────────────────┐
            │ Host 192.168.15.189 (Strokmatic-side)    │
            │                                           │
            │  ┌────────────────────────────────────┐   │
            │  │ Postgres (dedicated instance)      │   │
            │  │                                    │   │
            │  │  Schema: vk-body (deploy 03007)    │   │
            │  │    • pecas (peca = PVI)            │   │
            │  │    • types (type_code = Style GM)  │   │
            │  │    • subcomponente (+ group_name)  │   │
            │  │    • frames, frames_pecas          │   │
            │  │    • defeitos, defeitos_agg        │   │
            │  │    • inspecao, classe_defeitos     │   │
            │  │                                    │   │
            │  │  Function: insert_frames_pecas_v2  │   │
            │  └────────────────────────────────────┘   │
            └──────────────────────────────────────────┘
                ▲                              ▲
                │ INSERT (via RabbitMQ msgs)   │ SELECT (via REST)
                │                              │
        ┌───────┴────────┐            ┌────────┴─────────┐
        │ database-writer │            │ backend-iris      │
        │  (Python)       │            │  (IRIS-06, futuro)│
        └─────────────────┘            └──────────────────┘
                ▲                              ▲
                │ frame messages               │ frontend-iris
                │ (4 cameras × N frames)       │ (IRIS-07, lê tag PVI
                │                              │  do Redis, query
                │                              │  por estação)
```

**Pontos-chave:**
- Cada câmera publica detecções **independentemente**; `insert_frames_pecas_v2` desambigua por `peca = PVI` (primeiro insert cria, seguintes associam via `frames_pecas`).
- Filtro da TV de retrabalho por estação = `JOIN subcomponente ON ... WHERE group_name = 'superior'` (o frontend tem config local indicando qual `group_name` cobre).

## 4. Deploy procedure

### 4.1 Postgres na 189

- [ ] Provisionar Postgres 15+ no host `192.168.15.189`. Definir usuário `vk_iris` com senha gerenciada via `~/.secrets/`.
- [ ] Criar database `vk_iris_03007`.
- [ ] Executar DDL na ordem:
  1. `sql-vk-body/schema_body.sql` (tables + indexes)
  2. `sql-vk-body/functions/fn_insere_frames_body_v2.sql` (e dependências)
  3. `sql-vk-body/functions/fn_insere_defeitos_body_v2.sql`
  4. `sql-vk-body/functions/fn_agrega_defeitos_body.sql`
  5. `sql-vk-body/triggers/fn_trigger_agrega_defeitos_body.sql`
  6. `sql-vk-body/functions/fn_process_aggregation_queue_batch.sql`
  7. `sql-vk-body/functions/fn_aggregate_defects_centroid.sql`

### 4.2 Populate inicial

Dados de catálogo a serem fornecidos pela engenharia GM antes do deploy do bench (06/07 Buy-Off):

**`types` — lista de Styles do programa SCDS Paint** (CSV/seed SQL):

```sql
INSERT INTO types (internal_id, type_code, type_name, type_description, type_width, type_height) VALUES
  (1, '<style_code_1>', '<modelo_1>', '...', <largura_mm>, <altura_mm>),
  (2, '<style_code_2>', '<modelo_2>', '...', <largura_mm>, <altura_mm>),
  ...
```

Confirmar com Gustavo (GM): quantos Styles ativos no SCDS Paint hoje? (Tracker, Montana, SPIN são candidatos; lista oficial vem do PVI/Style do PLC.)

**`subcomponente` — painéis inspecionados pelo IRIS** com `group_name` mapeado para uma das 4 estações de retrabalho (cada PC kiosk roda uma rota dedicada que filtra por essa coluna):

```sql
INSERT INTO subcomponente (subcomponente_code, subcomponente_name, type_id, subcomponente_3d_file, category_code, id_group, group_name) VALUES
  -- superior_direita (vista de cima, lado direito da carroceria)
  ('teto_rh_ex',        'Teto Externo Direito',             NULL, NULL, 'EXT', 1, 'superior_direita'),
  ('capo_rh_ex',        'Capô Externo Direito',             NULL, NULL, 'EXT', 1, 'superior_direita'),
  ('porta_mala_rh_ex',  'Porta-malas Externo Direito',      NULL, NULL, 'EXT', 1, 'superior_direita'),
  -- superior_esquerda (vista de cima, lado esquerdo)
  ('teto_lh_ex',        'Teto Externo Esquerdo',            NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  ('capo_lh_ex',        'Capô Externo Esquerdo',            NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  ('porta_mala_lh_ex',  'Porta-malas Externo Esquerdo',     NULL, NULL, 'EXT', 2, 'superior_esquerda'),
  -- lateral_direita (vista lateral direita)
  ('porta_di_rh_ex',    'Porta Dianteira Direita Externa',  NULL, NULL, 'EXT', 3, 'lateral_direita'),
  ('porta_tr_rh_ex',    'Porta Traseira Direita Externa',   NULL, NULL, 'EXT', 3, 'lateral_direita'),
  -- lateral_esquerda (vista lateral esquerda)
  ('porta_di_lh_ex',    'Porta Dianteira Esquerda Externa', NULL, NULL, 'EXT', 4, 'lateral_esquerda'),
  ('porta_tr_lh_ex',    'Porta Traseira Esquerda Externa',  NULL, NULL, 'EXT', 4, 'lateral_esquerda'),
  ...
```

A divisão de cada painel entre "direita" e "esquerda" no `subcomponente_code` é necessária porque o design das telas (frame "proposta - lista accordion") tem **4 rotas separadas, não 3** — `superior` precisa ser dividido em `superior_direita` e `superior_esquerda` para combinar com o que a TV mostra.

Listagem real depende de:
- Quais painéis o IRIS efetivamente inspeciona (campo de visão das 4 câmeras + receita).
- Confirmar com Gustavo: as 4 estações do design (superior_direita/esquerda + lateral_direita/esquerda) batem com a operação real do retrabalho SCDS? Pode haver mais granularidade (ex: traseira, dianteira inferior) ou menos (3 estações se SCDS consolidar superiores).
- Arquivos CAD 3D (`subcomponente_3d_file`) entram depois — pendência cyber/GM (envio de carroceria/CAD para Joinville [G5]).

### 4.3 Configurar `database-writer`

Env vars no compose do `database-writer`:

```yaml
environment:
  DB_WRITER_POSTGRES_HOST: "192.168.15.189"
  DB_WRITER_POSTGRES_DB: "vk_iris_03007"
  DB_WRITER_POSTGRES_USER: "vk_iris"
  DB_WRITER_POSTGRES_PASSWORD: "${VK_IRIS_DB_PASSWORD}"
  INSERT_FUNCTION: "insert_frames_pecas_v2"
  MESSAGE_PROCESSING_MODE: "INDIVIDUAL"  # ou BATCH se latência permitir
```

`INSERT_FUNCTION` mantém default body. **Validação:** ver §6.

## 5. Índices — já existentes no body schema (ver `schema_body.sql`)

| Índice | Tabela | Uso na TV de retrabalho |
|---|---|---|
| `peca_idx` (btree) | `pecas.peca` | lookup por PVI (rota crítica do fluxo retrabalho) |
| `idx_defeitos_peca_id_class_id` | `defeitos(peca_id, class_id)` | agregação por classe de defeito |
| `idx_frames_pecas_peca_id` | `frames_pecas(peca_id)` | listar frames de uma carroceria |
| `idx_defeitos_frame_id` | `defeitos(frame_id)` | join frame → defeitos |
| `frames_frame_uuid_idx_hash` | `frames.frame_uuid` (hash) | lookup direto por uuid |

**Conclusão:** zero criação de índices no IRIS-05. Performance da TV cabe nos índices existentes (validar no smoke test §6.4).

## 6. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | Postgres rodando na `.189`, database `vk_iris_03007` criado com schema body completo | `psql -h 192.168.15.189 -U vk_iris -d vk_iris_03007 -c '\dt'` lista todas as tabelas |
| 2 | `types` populada com Styles GM (≥ 1 row de teste) | `SELECT * FROM types` |
| 3 | `subcomponente` populada com painéis + `group_name` por estação | `SELECT DISTINCT group_name FROM subcomponente` retorna ≥ 4 estações: `superior_direita`, `superior_esquerda`, `lateral_direita`, `lateral_esquerda` |
| 4 | `database-writer` aponta para nova instância, processa mensagem de teste sem erro | log do container + `SELECT count(*) FROM frames` aumenta |
| 5 | `insert_frames_pecas_v2(JSONB)` aceita payload IRIS sem ajuste (frame + peca={pvi}) | smoke test com payload sintético |
| 6 | Query da TV retorna em < 100 ms para 1 carroceria com ~50 defeitos | `EXPLAIN ANALYZE SELECT ... WHERE peca='<pvi>' AND group_name='superior'` |
| 7 | Trigger `fn_trigger_agrega_defeitos_body` dispara `defeitos_agg` corretamente após N inserts | inspecionar tabela após smoke test |

## 7. Pendências (não bloqueiam a spec — entram no plan ou nos próximos artefatos)

1. **Lista oficial de Styles GM SCDS Paint** — pedir a Gustavo. Necessário antes do populate definitivo (após Buy-Off bench, antes da instalação SCDS).
2. **Arquivos CAD 3D dos subcomponentes (`subcomponente_3d_file`)** — depende do envio de carroceria/CAD GM para Joinville ([G5], pendência atrasada).
3. **Confirmar nomes finais das estações de retrabalho** — design VK Body define 4: `superior_direita`, `superior_esquerda`, `lateral_direita`, `lateral_esquerda` (frame "proposta - lista accordion" no Figma `ZDfitEWm0gYTmGYbyxRnf7`). GM pode operar com divisão diferente — confirmar com Gustavo.
4. **Decisão sobre retenção/arquivamento** — deferido, mas TBD antes do SOR final 06/10.

## 8. Próximos passos

1. **User review** desta spec.
2. Plan de implementação (`docs/superpowers/plans/2026-05-13-iris-05-database-schema-deploy.md`) com tarefas TDD: provisionamento PG, scripts de populate, smoke test, validação `insert_frames_pecas_v2`.
3. Coordenar com Vinicius (rede) para reservar `192.168.15.189`.
4. Spec do IRIS-06 (backend) — consumirá esse schema; pode começar em paralelo após este aprovado.
