# Auditoria Completa — Strokmatic + JARVIS

> **Data:** 2026-04-03 | **Escopo:** 3 produtos + backlogs/plans + infraestrutura

---

## Resumo Executivo

Auditoria profunda de seguranca, qualidade, padronizacao, testes e gestao de backlogs nos 3 produtos (DieMaster, SpotFusion, VisionKing) e no orquestrador JARVIS.

| Area | DM | SF | VK | JARVIS |
|------|----|----|----|----|
| Seguranca | 🔴 | 🔴 | 🔴 | 🟢 |
| Qualidade de Codigo | 🟡 | 🔴 | 🟡 | 🟢 |
| Padronizacao | 🟡 | 🔴 | 🟡 | 🟢 |
| Testes | 🟡 | 🔴 | 🔴 | N/A |
| Documentacao | 🟢 | 🟢 | 🟢 | 🟢 |
| Monitoramento | 🔴 | 🔴 | 🔴 | 🟢 |
| Gestao de Backlogs | — | — | — | 🟡 |

---

## 1. SEGURANCA — Cross-Product (CRITICO)

### 1.1 Credenciais Hardcoded

| Produto | Arquivos Afetados | Senhas Expostas | Severidade |
|---------|-------------------|-----------------|------------|
| **DieMaster** | 10+ (.env, docker-compose, Python scripts) | `<skm-password>`, `<smartdie-password>`, JWT keys | CRITICO |
| **SpotFusion** | 169 (.env em 22+ servicos, setup.env com 13 ocorrencias) | `<skm-password>`, `<sparkeyes-password>`, IPs internos | CRITICO |
| **VisionKing** | .env.example + servicos | `<skm-password>`, `<sissurface-password>` | CRITICO |

**Acao imediata:** Rotacionar todas as senhas expostas no historico git. Mover para GCP Secret Manager ou vault.

### 1.2 eval() — Execucao Arbitraria de Codigo

| Produto | Ocorrencias | Localizacao | Risco |
|---------|-------------|-------------|-------|
| **DieMaster** | 0 confirmado | — | — |
| **SpotFusion** | 15 servicos | `utils/Ilog/log.py:26` (le dados do Redis via eval) | CRITICO |
| **VisionKing** | 1 servico | `result/src/write_results.py:178` (eval de dados Redis) | CRITICO |

**Acao:** Substituir `eval()` por `json.loads()` ou `ast.literal_eval()`.

### 1.3 Bare except: (Erros Silenciosos)

| Produto | Ocorrencias |
|---------|-------------|
| DieMaster | Poucos (connect.py) |
| SpotFusion | **98 instancias** (15 em Ilog, 45 em pylogix, 38 em servicos) |
| VisionKing | 4 instancias |

### 1.4 VisionKing — Merge Conflicts Nao Resolvidos (CRITICO)

**Arquivo:** `services/controller/src/controller_functions.cpp` — contem marcadores `<<<<<<< HEAD` em 20+ linhas. Codigo nao compila.

### 1.5 VisionKing — C++ Unsafe (strcpy, VLAs)

**Arquivo:** `services/controller/src/controller_functions.cpp:52,94` — `strcpy()` sem bounds checking. Stack overflow potencial.

---

## 2. QUALIDADE DE CODIGO

### 2.1 Duplicacao de Codigo

| Componente | DM | SF | VK | Total |
|------------|----|----|----|----|
| RabbitMQ client | 3 variantes | 2 variantes (sync+async) | 5 copias (3 sync, 2 async) | **10 implementacoes** |
| Redis client | Inline por servico | **60+ copias** (Icache duplicado) | Inline por servico | **60+** |
| Logger | loguru (ok) | **15 copias** Ilog (com eval!) | Mix logging/loguru | **15+ duplicatas** |
| pylogix (PLC) | N/A | **4 copias** com build/ | N/A | **4 copias** |

**Oportunidade:** Extrair para SDK compartilhado:
- `sdk-lib-rabbit-client` (ja existe, mas nao adotado por SF)
- `sdk-lib-logging` (ja existe, mas nao adotado por SF)
- `sdk-lib-redis-client` (nao existe — criar)
- `sdk-lib-config-loader` (nao existe — criar)

### 2.2 Servicos sem requirements.txt

| Produto | Com requirements | Sem requirements |
|---------|-----------------|------------------|
| DieMaster | 2 (inference, data-processing) | 8 (usam .req sem versoes) |
| SpotFusion | 1 (get-data) | **22 servicos** |
| VisionKing | Maioria via pyproject.toml | Alguns sem |

### 2.3 Dockerfiles Faltando

| Produto | Com Dockerfile | Sem Dockerfile |
|---------|---------------|----------------|
| DieMaster | inference, backend, frontend | 10 servicos Python (host network) |
| SpotFusion | **1** (image-server) | **20+ servicos** |
| VisionKing | 2 (wifi-cam, spark-test) | **19 servicos** |

---

## 3. TESTES

### 3.1 Cobertura por Produto

| Produto | Servicos Total | Com Testes | Sem Testes | Testes E2E |
|---------|---------------|------------|------------|------------|
| DieMaster | 15 | 3 (backend, data-processing, inference) | **12** | ~40 E2E |
| SpotFusion | 26 | 2 (inference, data-enrichment) | **24** | 65 E2E |
| VisionKing | 22 | 6 (parcial) | **16** | ~20 E2E |

**Servicos criticos sem nenhum teste unitario:** 52 de 63 (83%)

### 3.2 Infra E2E

Todos os 3 produtos tem infra E2E solida (Docker Compose profiles, pytest markers, port isolation). O gap e em testes unitarios por servico.

---

## 4. MONITORAMENTO

| Capability | DM | SF | VK |
|-----------|----|----|-----|
| Prometheus metrics | ❌ | ❌ | ❌ (stack existe mas servicos nao expoe) |
| Health check endpoints | ❌ | ❌ | 1 de 22 |
| Centralized logging | ❌ | ❌ (custom Ilog via Redis) | ❌ |
| Alerting | ❌ | ❌ | Parcial (JARVIS vk-health cron) |

---

## 5. GESTAO DE BACKLOGS — Fragmentacao

### 5.1 Onde Vivem as Tarefas (8 Sistemas)

| Sistema | Itens | Tipo | Primario? |
|---------|-------|------|-----------|
| **ClickUp** | 3.218 | Tasks com assignees, labels, datas | SIM (produtos) |
| **backlogs/products/** | 79 | Resumos markdown por produto | Secundario |
| **backlogs/plans/** | 18 specs | Specs detalhadas de features | Terciario |
| **backlogs/orchestrator/** | 38 specs | Features JARVIS | SIM (orquestrador) |
| **Monorepos .claude/backlog.md** | 3 copias | Mirrors sincronizados via MCP | Derivativo |
| **Changelogs** | 26 itens completos | Historico de atividade | Log |
| **docs/plans/** | 7 documentos | Roadmaps estrategicos | Advisory |
| **docs/superpowers/** | 9 specs/plans | Features especializadas | Emergente |

### 5.2 Problemas Identificados

**Duplicacao ~35-40%:**
- CICD-02 aparece em 3 backlogs de produto + 1 spec = 4 lugares
- SEC-01 aparece em 3 backlogs de produto
- TEST-01 aparece em 3 backlogs de produto

**7 Planos Orfaos (1.872 linhas):**
- `pr-review-service-v2.md` (413 linhas) — sem item no backlog
- `plugin-document-templates.md` (235 linhas) — sem item no backlog
- `p7-downstream-services-spec.md` (203 linhas) — sem item
- `drawin-prediction-algorithm-search.md` (192 linhas) — sem item
- `relatorio_visualizacao_data_processing.md` (170 linhas) — sem item
- `pr25-review-remediation-*.md` (3 arquivos, 288 linhas) — sem itens

**6 Itens Stale (sem atividade 60+ dias):**
- DM GIT-01 (branches nao merged)
- SF GIT-01 (upstream tracking)
- SF OPT-01 (cleanup 42GB → 2GB)
- VK CLEAN-01/02 (remover legacy 2GB+)

**Changelogs de produto vazios:**
- `strokmatic.diemaster-changelog.md` — criado mas vazio
- `strokmatic.spotfusion-changelog.md` — vazio
- `strokmatic.visionking-changelog.md` — vazio

**Sync ClickUp → Markdown: MANUAL** (sem automacao)

### 5.3 Proposta de Consolidacao

```
CAMADA 1: Fonte Primaria
├── ClickUp (produtos: VK, SF, DM) — tasks, sprints, assignees
└── backlogs/orchestrator/ (features JARVIS) — specs locais

CAMADA 2: Mirrors Sincronizados (Automatico)
├── backlogs/products/*.md (sync mensal de ClickUp)
├── backlogs/plans/*.md (specs detalhadas, linkadas a items)
└── monorepos .claude/backlog.md (sync via MCP baseline)

CAMADA 3: Status e Reportes
├── changelogs/ (atualizado na conclusao)
├── reports/ (diario/semanal/mensal)
└── knowledge-base (atualizado via Phase 2 auto-update)
```

**Acoes para consolidar:**
1. Criar `scripts/sync-clickup-to-backlogs.sh` — parse exports, gera markdown
2. Adotar planos orfaos — criar items no backlog correspondente
3. Popular changelogs de produto — backfill de commits recentes
4. Mover `docs/plans/` e `docs/superpowers/` para `backlogs/plans/` com convencao de nomes
5. Fechar itens stale ou reclassificar como "deferred"

---

## 6. PLANO DE REMEDIACAO PRIORIZADO

### P0 — Imediato (esta semana)

| # | Acao | Produtos | Esforco |
|---|------|----------|---------|
| 1 | Rotacionar credenciais expostas em git | DM, SF, VK | 2h |
| 2 | Resolver merge conflicts no controller C++ | VK | 1h |
| 3 | Substituir eval() por json.loads() | SF (15 servicos), VK (1) | 2h |
| 4 | Substituir bare except: por excecoes especificas | SF (98), VK (4) | 4h |

### P1 — Curto prazo (2 semanas)

| # | Acao | Produtos | Esforco |
|---|------|----------|---------|
| 5 | Extrair SDK compartilhado (logger, redis, rabbit, config) | SF, VK, DM | 16h |
| 6 | Adicionar requirements.txt com versoes a todos os servicos | SF (22), DM (8) | 4h |
| 7 | Adicionar health checks ao docker-compose | VK, SF, DM | 4h |
| 8 | Padronizar logging em loguru (SDK) | SF (15 servicos), VK (7) | 8h |
| 9 | Criar sync ClickUp → markdown backlogs | JARVIS | 3h |
| 10 | Adotar planos orfaos + popular changelogs | JARVIS | 2h |

### P2 — Medio prazo (1 mes)

| # | Acao | Produtos | Esforco |
|---|------|----------|---------|
| 11 | Adicionar testes unitarios aos 52 servicos sem testes | Todos | 80h |
| 12 | Adicionar metricas Prometheus aos top 5 servicos | VK, SF | 8h |
| 13 | Criar Dockerfiles padronizados para servicos sem | SF (20), VK (19) | 16h |
| 14 | Padronizar build C++ (CMake) | VK | 8h |
| 15 | Consolidar locais de backlog/plans | JARVIS | 4h |

### P3 — Longo prazo (trimestre)

| # | Acao | Esforco |
|---|------|---------|
| 16 | Logging centralizado (ELK/Loki) | 20h |
| 17 | CI/CD com gate de testes obrigatorio | 16h |
| 18 | Credential scanning automatico em pre-commit | 4h |
| 19 | Chaos engineering tests | 20h |
| 20 | SDK cleanup do repo SF (42GB → 2GB) | 8h |

---

## Numeros Finais

| Metrica | Valor |
|---------|-------|
| Credenciais hardcoded | **180+ arquivos** |
| eval() calls inseguros | **16 servicos** |
| Bare except: | **102 instancias** |
| Servicos sem testes | **52 de 63 (83%)** |
| Servicos sem Dockerfile | **49 de 63 (78%)** |
| Servicos sem health check | **62 de 63 (98%)** |
| Servicos sem metricas Prometheus | **63 de 63 (100%)** |
| Duplicatas de codigo RabbitMQ | **10 implementacoes** |
| Duplicatas Redis (SF) | **60+ copias** |
| Planos orfaos | **7 (1.872 linhas)** |
| Items stale no backlog | **6** |
| Taxa de duplicacao de backlog | **~35-40%** |
