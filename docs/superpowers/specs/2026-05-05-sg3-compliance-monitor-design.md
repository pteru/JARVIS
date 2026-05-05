# SG3 Compliance Monitor — Design (Fase 1: GM)

**Data:** 2026-05-05
**Autor:** Pedro Teruel
**Status:** Spec aprovado em brainstorm; aguardando plano de implementação

## 1. Contexto e objetivo

A Strokmatic precisa monitorar prazos de vencimento de documentos de integração da equipe nos clientes que usam a plataforma SG3 (GM e Hyundai). Falhas de compliance bloqueiam acesso à planta e param obras. Hoje o controle é manual e disperso.

Esta Fase 1 cobre **apenas GM** e estabelece a base reusável para Hyundai (Fase 2). O sistema deve:

- Refletir o estado de compliance do SG3 GM em uma fonte única consultável.
- Capturar prazos definidos fora do SG3 (cartas de subcontratação, aprovações de comprador/jurídico GM por email, declarações de responsabilidade, CNDs Lume, PGR/PCMSO).
- Cruzar a pasta Drive de contratos GM com o cadastro SG3 (drift detection).
- Alertar diariamente um grupo (Google Chat) com prazos próximos, vencidos, pendências de estado e drift.

### 1.1 Restrições e premissas

- **Escala pequena:** ~10 colaboradores, 2-3 clientes (Fase 1 só GM), 5-10 documentos por pessoa.
- SG3 acessado hoje só via portal web. Investigação de API é a primeira tarefa de implementação.
- Notificação centralizada num Google Chat space único (`spaces/AAQAoCUA9zA`) — sem alertas individuais por colaborador na Fase 1.
- Source-of-truth = Google Sheet com 13 abas (humanos editam abas estáticas, scripts atualizam abas dinâmicas).
- Cron diário 07:00 BRT (uma execução por dia).
- Hyundai e fluxos divergentes ficam fora do escopo.

## 2. Arquitetura

Pipeline modular tipo `vk-health` com 5 estágios (3 collectors paralelos + sync + check):

```
[collect-sg3.mjs] ──┐
[collect-drive.mjs] ┼──→ data/sg3-monitor/{date}/*-snapshot.json ──→ [sync-sheet.mjs] ──→ Google Sheet ──→ [check-expiries.mjs] ──→ Google Chat space
[collect-emails.mjs]┘
```

Os 3 collectors rodam em paralelo (independentes). Sync depende dos snapshots; check depende da Sheet sincronizada. Falha de um collector não derruba o pipeline — o sync usa o snapshot mais recente disponível.

### 2.1 Layout de diretórios

```
scripts/sg3-monitor/
  run.sh                           # orquestrador (cron entry-point)
  bootstrap.mjs                    # spike + carga inicial (rodado uma vez)
  collect-sg3.mjs
  collect-drive-contratos.mjs
  collect-emails.mjs
  sync-sheet.mjs
  check-expiries.mjs
  lib/
    sg3-client.mjs                 # API ou Playwright (escolhido em runtime conforme config)
    contract-pdf-parser.mjs        # extrai responsável/vigência/objeto de PDFs
    contract-name-parser.mjs       # regex de filename → contrato_id, VENC -, etc.
    email-classifier.mjs           # aplica classifiers do email-rules.json
    expiry-rules.mjs               # lead-time matching, cálculo de prazo_efetivo
    sheet-schema.mjs               # validação de colunas, FK e tipos
    notifier.mjs                   # wrapper sobre notifier MCP com fallback

config/sg3-monitor/
  config.json                      # lead times, sheet URL, cron config
  email-rules.json                 # master_label + classifiers
  clients/
    gm.json                        # SG3 base URL, scrape targets, auth file paths

data/sg3-monitor/
  {YYYY-MM-DD}/
    sg3-snapshot.json
    drive-snapshot.json
    email-snapshot.json
    sync-report.json
    last-report.md
    sg3.log / drive.log / email.log / sync.log / check.log
  bootstrap/
    gap-report.md
  alertas-log.json                 # dedupe registry
  auth/
    gm-storage-state.json          # Playwright session

logs/
  sg3-monitor.log                  # cron stdout/stderr

tests/
  sg3-monitor/
    unit/
    integration/
    fixtures/
```

### 2.2 Reaproveitamento JARVIS

- `gsheet` MCP → leitura/escrita da Sheet
- `google-workspace` MCP → Drive listing, downloads, Gmail searches, Chat post
- `email-analyzer` MCP → extract_entities, extract_timeline para parsing de corpos
- `notifier` MCP → fallback Telegram pessoal e escalação
- Padrão de cron + snapshots herdado de `vk-health`

### 2.3 Configuração e secrets

```
config/sg3-monitor/config.json:
{
  "sheet_id": "<criada pelo bootstrap>",
  "sheet_name": "GM Compliance Monitor — Fase 1",
  "lead_times": {
    "aso": [15, 7, 1],
    "nr10": [15, 7, 1],
    "nr35": [15, 7, 1],
    "nr12": [15, 7, 1],
    "cnd_federal": [15, 7, 1],
    "cnd_estadual": [15, 7, 1],
    "cnd_municipal": [15, 7, 1],
    "cnd_trabalhista": [15, 7, 1],
    "cnd_fgts": [15, 7, 1],
    "pgr": [60, 30, 15],
    "pcmso": [60, 30, 15],
    "carta_subcontratacao": [60, 30, 15],
    "aprovacao_juridico": [60, 30, 15],
    "cadastro_sg3": [30, 15, 7],
    "alocacao": [30, 15, 7],
    "default": [30, 15, 7]
  },
  "notification": {
    "primary":   { "channel": "google_chat", "space": "spaces/AAQAoCUA9zA" },
    "fallback":  { "channel": "telegram", "chat_id": "<usuário>" },
    "escalation": {
      "criteria": { "severity": "VENCIDO", "age_hours": 72, "blocks_alocacao_ativa": true },
      "channel": "telegram", "chat_id": "<usuário>"
    }
  },
  "cron": "0 7 * * *"
}

~/.secrets/sg3-credentials.json:
{ "gm": { "username": "...", "password": "..." } }
```

## 3. Data model — Google Sheet com 13 abas

### 3.1 Convenções

- Coluna `id` (slug minúsculo com hífens) como chave primária e referência para FKs.
- `_origem`: `sg3` | `email` | `drive` | `manual` — quem criou/atualizou a linha.
- `_atualizado_em`: timestamp ISO da última escrita.
- `_revisado_humano` (em abas com extração LLM): `true`|`false`. Falsa silencia ações automatizadas que dependam do dado e exibe `[NÃO REVISADO]` no alerta.
- Datas em `YYYY-MM-DD`.
- FKs validadas em cada `sync-sheet` run; quebras viram warnings (não bloqueia sync).

### 3.2 Abas

#### 1. `empresas`
`id, razao_social, cnpj, tipo (principal|subcontratada|mei), responsavel_email, notas`

#### 2. `colaboradores`
`id, nome_completo, cpf, empresa_id→empresas, email, telefone, ativo, notas`

#### 3. `pessoas_gm`
`id, nome, email, telefone, tem_user_sg3, papeis (CSV: responsavel_contrato|responsavel_planta|comprador|juridico), plantas (CSV planta_ids), notas`

#### 4. `plantas`
`id, cliente (=GM Fase 1), nome, endereco, patrimonial_nome, patrimonial_email, notas`

#### 5. `contratos`
`id (=número GM 5000XXXXXXX), cliente, objeto, data_inicio, data_fim, responsavel_contrato_id→pessoas_gm, extracao_status (auto|manual|falhou), extracao_warnings, notas`

#### 6. `cadastros_sg3`
`id (=contrato_id+planta_id), contrato_id→contratos, planta_id→plantas, responsavel_planta_id→pessoas_gm, status_aprovacao, data_aprovacao, data_vencimento, sg3_url, notas`

#### 7. `cartas_subcontratacao`
```
id, subcontratada_id→empresas, contrato_id→contratos, plantas_cobertas (CSV planta_ids),
data_emissao, data_vencimento_propria,
assinaturas (pendente|strokmatic|strokmatic+sub|completa),
aprovacao_comprador_id→aprovacoes_email,
aprovacao_juridico_id→aprovacoes_email,
arquivo_url,
prazo_efetivo (calculado: min(carta, contrato.data_fim, CNDs Lume vigentes)),
notas
```

#### 8. `aprovacoes_email`
```
id (slug derivado de gmail_message_id), tipo (comprador_gm|juridico_gm|patrimonial|outro_sg3),
carta_id→cartas_subcontratacao, aprovador_id→pessoas_gm,
data_email, remetente, assunto, corpo_resumido,
prazo_definido (data extraída do corpo — relevante para juridico_gm),
gmail_message_id, gmail_link,
status (aprovado|pendente|rejeitado),
_revisado_humano
```

#### 9. `docs_empresa`
`id, empresa_id→empresas, tipo (pgr|pcmso|cnd_federal|cnd_estadual|cnd_municipal|cnd_trabalhista|cnd_fgts|outro), data_emissao, data_vencimento, arquivo_url, notas`

#### 10. `docs_colaborador`
`id, colaborador_id→colaboradores, tipo (aso|nr10|nr35|nr12|outro), data_emissao, data_vencimento, arquivo_url, notas`

#### 11. `declaracoes_responsabilidade` — granularidade `(colaborador × planta)`
```
id (=<colaborador_id>-<planta_id>),
colaborador_id→colaboradores, planta_id→plantas,
data_emissao, assinaturas (pendente|strokmatic|strokmatic+sub|completa),
arquivo_url, versao, notas
```

#### 12. `alocacoes` — granularidade `(colaborador × cadastro_sg3) = (colaborador × contrato × planta)`
```
id (=<cadastro_sg3_id>-<colaborador_id>),
colaborador_id→colaboradores, cadastro_sg3_id→cadastros_sg3,
data_inicio, data_vencimento_propria,
status_sg3 (pendente_aprovacao|aprovada|docs_pendentes|liberada|vencida|bloqueada),
pendencias_sg3 (CSV de tipos de doc faltantes),
data_email_patrimonial,
decl_resp_id→declaracoes_responsabilidade,
decl_resp_uploaded_sg3, decl_resp_data_upload_sg3,
prazo_liberacao_efetivo (calculado: menor data entre todas as dependências ativas),
bottleneck_doc (calculado: descrição do doc que limita o prazo, ex: "ASO João vence 2026-05-12"),
notas
```

`prazo_liberacao_efetivo` e `bottleneck_doc` são preenchidos por `check-expiries.mjs` a cada run (escritos de volta na Sheet). São **só leitura** para humanos.

#### 13. `contratos_drive`
```
id (=Google Drive file_id), file_name, file_url, file_mime_type,
data_criacao, data_modificacao,
contrato_id→contratos (auto-sugerido por filename, humano confirma),
status_drive (aguardando_faturamento|faturado),
em_sg3 (calculado por sync), notas
```

### 3.3 Fora da Sheet

- `data/sg3-monitor/{date}/*-snapshot.json` — payloads brutos por collector.
- `data/sg3-monitor/alertas-log.json` — registry de dedupe.
- `data/sg3-monitor/bootstrap/gap-report.md` — relatório one-shot pós-bootstrap.
- `config/sg3-monitor/*.json` — lead times, regras de email, configs por cliente.

## 4. Ingestão

### 4.1 collect-sg3.mjs

**Resolução API vs Playwright:** decidida em runtime com base em `config/sg3-monitor/clients/gm.json`. A configuração é populada pelo `bootstrap.mjs` após investigação inicial (DevTools no portal mapeia chamadas REST/GraphQL; se não houver, configura Playwright com selectors).

**Fluxo Playwright (plano B esperado):**

```
1. Carrega storage-state da última sessão.
2. Tenta acessar página interna; se redirecionar para login → relogar com creds de ~/.secrets/sg3-credentials.json.
3. MFA: se exigido, pausa o headless e dispara push notification "abrir Playwright UI para MFA"; aguarda 5min antes de abortar.
4. Salva storage-state atualizado.
5. Navega pelas 3 áreas (cadastros, alocações com pendências, status liberação).
6. Escreve data/sg3-monitor/{date}/sg3-snapshot.json com:
   { collected_at, source: "playwright"|"api", status: "ok"|"auth_expired"|"failed",
     cadastros_sg3: [...], colaboradores: [...], alocacoes: [...] }
```

Falha `auth_expired` → snapshot.failed + alerta "🔐 SG3 GM precisa relogin manual" + pipeline segue com snapshot anterior. Mudanças de layout (selector mismatch) → snapshot com diff esperado vs encontrado.

### 4.2 collect-drive-contratos.mjs

Listagem recursiva da pasta-raiz GM (ID `1Em95Bq3gOkXrsM_c-r9dPWoV4nthcK-5`). Classificação por filename:

```
• /^(?:Contrato\s+)?5000\d{6,7}\b/ → contrato GM (5000XXXXXXX = contrato_id)
• /^GENERAL MOTORS LTDA - DANFE/ → DANFE; skip Fase 1
• /^VENC - (\d{2}\/\d{2}\/\d{4}) - .+/ → doc com prazo no filename → docs_empresa/docs_colaborador (best-effort)
• parent === 'GM - SG3' → templates; skip
• outros → linha em contratos_drive sem mapeamento; humano confirma
```

Subpasta determina `status_drive`: `Aguardando FATURAMENTO/` → `aguardando_faturamento`, `GM - CONTRATO FATURADO/` → `faturado`. Movimentação manual entre pastas é o gesto que define o status.

**`lib/contract-pdf-parser.mjs`** para PDFs de contrato:

```
1. download_file(file_id) → /tmp/sg3-monitor/<file_id>.pdf
2. pdftotext → texto
3. Se >500 chars: regex/heurística para responsável GM, vigência, objeto.
   Campos não encontrados → claude --print com texto (input cacheado).
4. Se vazio (PDF scaneado): fallback claude --print com PDF anexado.
5. Resultado: { responsavel_gm, vigencia, objeto, extracao_status, warnings[] }
```

Saída: `data/sg3-monitor/{date}/drive-snapshot.json`.

### 4.3 collect-emails.mjs

**Master query:** `label:sg3` (label único top-level aplicado manualmente quando email é relevante).

**email-rules.json:**

```json
{
  "master_label": "sg3",
  "classifiers": [
    { "type": "aprovacao_juridico_gm",
      "match": { "from_pattern": "marilza", "subject_pattern": "(subcontratação|carta)" },
      "extracao": { "carta_id": "<regex>", "prazo_definido": "<LLM>", "status": "..." },
      "confirmacao_humana": true },
    { "type": "aprovacao_comprador_gm",
      "match": { "from_domain": "gm.com", "subject_pattern": "(aprovação|aprovado).*(subcontratação|carta)" },
      "extracao": { "carta_id": "<regex>", "status": "..." } },
    { "type": "email_patrimonial",
      "match": { "to_pattern": "patrimonial", "from_pattern": "me" },
      "extracao": { "alocacao_inferida": "<LLM>" } },
    { "type": "outro_sg3", "fallback": true,
      "extracao": { "tipo_inferido": "<LLM>" } }
  ]
}
```

Para juridico_gm, `prazo_definido` extraído por LLM entra com `_revisado_humano = false` (formatação condicional vermelha; alertas saem com `[NÃO REVISADO]` até confirmação). Linhas em `aprovacoes_email` são imutáveis (nunca atualizadas, só inseridas) — uma linha por email único (`gmail_message_id`).

Saída: `data/sg3-monitor/{date}/email-snapshot.json`.

### 4.4 sync-sheet.mjs

Lê os 3 snapshots; faz upsert na Sheet via `gsheet` MCP. Estratégia por aba:

| Aba | Estratégia |
|-----|-----------|
| `cadastros_sg3`, `alocacoes` | Upsert por `id`. Sobrescreve campos dinâmicos do SG3 (`status_sg3`, `pendencias_sg3`, `data_vencimento`). Preserva colunas de preenchimento humano (`notas`, `data_email_patrimonial` — esta é manual, marcada após você enviar o email à patrimonial), e `decl_resp_uploaded_sg3` / `decl_resp_data_upload_sg3` (também manuais). `prazo_liberacao_efetivo` e `bottleneck_doc` são sobrescritos pelo `check-expiries.mjs`. |
| `contratos_drive` | Upsert por `file_id`. Sobrescreve `status_drive`, `data_modificacao`. Preserva `contrato_id` se humano já mapeou. |
| `contratos` | Upsert por `id`. Parser PDF preenche apenas campos vazios; nunca sobrescreve overrides manuais. |
| `pessoas_gm` | Insert apenas se não existir linha com mesmo `email`. Nunca sobrescreve. |
| `aprovacoes_email` | Insert apenas (linhas imutáveis dedupadas por `gmail_message_id`). |
| `empresas`, `colaboradores`, `plantas`, `cartas_subcontratacao`, `docs_empresa`, `docs_colaborador`, `declaracoes_responsabilidade` | Read-only para o sync. Apenas valida FKs e datas; nunca escreve. |

Validações (FK, datas ISO, required fields) saem em `data/sg3-monitor/{date}/sync-report.json` e compõem a seção "Saúde do pipeline" do alerta.

## 5. Engine de alertas (check-expiries.mjs)

### 5.1 Entrada

Lê a Sheet sincronizada e o `data/sg3-monitor/alertas-log.json` (dedupe).

### 5.2 Avaliações

**Temporais** — para linhas com data de vencimento (`docs_empresa`, `docs_colaborador`, `cartas_subcontratacao` via `prazo_efetivo`, `aprovacoes_email` (juridico) via `prazo_definido`, `cadastros_sg3`, `alocacoes`):

```js
const dias = diferencaDias(data_vencimento, hoje);
const lead_times = config.lead_times[tipo] ?? config.lead_times.default;
if (dias < 0)                          severity = "VENCIDO";        // alerta diário até resolver
else if (lead_times.includes(dias))    severity = "PRAZO";          // batendo um dos limiares
else                                   severity = null;
```

`prazo_efetivo` para `cartas_subcontratacao`:
```
prazo_efetivo = min(
  carta.data_vencimento_propria,
  contrato.data_fim,
  ...cnds_lume_vigentes.map(c => c.data_vencimento)
)
```

**Estado** — checks sem data:

- Alocação `aprovada` com `pendencias_sg3` não-vazio há >7 dias → "subir docs"
- Alocação `liberada` com `data_email_patrimonial` vazio → "enviar email à patrimonial X"
- Alocação `liberada` há ≥30 dias sem `data_email_patrimonial` → escalação
- `declaracoes_responsabilidade` `pendente|parcial` com alocação ativa dependendo → "fechar assinaturas"
- `declaracoes_responsabilidade` `completa` com alocação tendo `decl_resp_uploaded_sg3 = false` → "fazer upload no SG3"

**Liberações ativas** — para cada `alocacao` com `status_sg3 = liberada`, calcula `prazo_liberacao_efetivo` como o `min` das seguintes datas (todas opcionais; entradas inexistentes são ignoradas):

- `alocacao.data_vencimento_propria`
- `cadastro_sg3.data_vencimento`
- `contrato.data_fim`
- `carta_subcontratacao.prazo_efetivo` — apenas quando há subcontratação envolvida
- `aprovacao_juridico_gm.prazo_definido` — apenas quando há subcontratação envolvida
- `data_vencimento` de cada `docs_colaborador` obrigatório (ASO + NRs aplicáveis)
- `data_vencimento` de cada `docs_empresa` da subcontratada (PGR, PCMSO, CNDs Lume)

Se a `declaracao_responsabilidade` correspondente não estiver `completa`, a alocação é tratada como **bloqueada** (não aparece em "Liberações ativas") em vez de receber prazo curto — porque o `status_sg3 = liberada` deveria ser inconsistente nesse caso, e o valor faz parte das pendências de estado.

`bottleneck_doc` registra qual dependência produziu o `min()` — texto humano-legível, ex: `"CND Federal Lume vence 2026-06-04"`.

Resultado escrito de volta na aba `alocacoes` (colunas calculadas). Compõe a seção "Liberações ativas" do alerta (5.4) e do CLI `npm run sg3:status` (10).

**Drift** — incoerência entre Drive × Sheet × SG3:

- `contratos_drive` com `contrato_id` vazio → "mapear contrato"
- `contratos` da Sheet sem nenhum `cadastros_sg3` → "cadastrar em alguma planta"
- `cadastros_sg3` sem PDF correspondente em `contratos_drive` → "anexar contrato no Drive"

### 5.3 Dedupe

Chave: `<linha_id>:<dias_restantes>:<YYYY-MM-DD>` em `alertas-log.json`. Re-execução no mesmo dia é idempotente. Vencimentos passados disparam diariamente porque `dias_restantes` muda.

**Snooze opcional:** coluna `snooze_until` em abas com vencimento; se preenchida e futura, alertas sobre aquela linha são silenciados.

### 5.4 Mensagem

Texto-rich postado no Google Chat space. Formato fixo com 5 seções (omite seções vazias):

```
🚨 SG3 GM — Daily Compliance Report — YYYY-MM-DD

✅ LIBERAÇÕES ATIVAS  (tabela: colaborador → planta → prazo efetivo → bottleneck)
📅 PRAZOS PRÓXIMOS    (linhas com severity=PRAZO)
🔴 VENCIDOS           (linhas com severity=VENCIDO)
🟡 PENDÊNCIAS DE ESTADO
🔎 DRIFT DRIVE × SG3
📊 SAÚDE DO PIPELINE  (status dos 4 estágios + sync warnings)

🔗 Sheet: <link>
```

Exemplo da seção "Liberações ativas":
```
✅ LIBERAÇÕES ATIVAS (4)
   • João Silva → Gravataí        até 2026-05-12  (gargalo: ASO João vence 2026-05-12)
   • João Silva → São Caetano     até 2026-06-04  (gargalo: CND Federal Lume vence 2026-06-04)
   • Maria Santos → Gravataí      até 2026-08-15  (gargalo: contrato 5000078790)
   • Pedro Costa → São Caetano    até 2026-12-03  (gargalo: declaração responsabilidade)
```

Dia sem nada → mensagem curta `✅ Tudo OK em YYYY-MM-DD.` (confirma execução).
Linhas com `_revisado_humano = false` → prefixo `[NÃO REVISADO]`.

### 5.5 Routing

```
Primary:    Google Chat space spaces/AAQAoCUA9zA
Fallback:   Telegram pessoal (se Google Chat falhar)
Escalation: Telegram pessoal quando severity=VENCIDO + age >72h + bloqueia alocacao ativa
```

Falha total do canal → relatório do dia salvo em `data/sg3-monitor/{date}/last-report.md`. Falha consecutiva (>2 dias) num collector vira alerta separado escalado.

## 6. Bootstrap (spike + carga inicial combinados)

`scripts/sg3-monitor/bootstrap.mjs` executa **uma vez**:

1. Cria a Sheet "GM Compliance Monitor — Fase 1" com 13 abas, headers, formatação condicional, dropdowns enum. Compartilha com o space de notificação.
2. **Investigação SG3** (DevTools manual + scripted probe): mapeia chamadas REST/GraphQL ou identifica URLs/selectors. Persiste descobertas em `config/sg3-monitor/clients/gm.json`.
3. **Extração inicial automatizada do SG3** com a sessão autenticada do passo 2: empresas, colaboradores, plantas, pessoas_gm, cadastros_sg3, alocacoes, status, pendências, docs internos do SG3.
4. **Extração inicial do Drive**: lista completa da pasta GM, parse de todos os PDFs de contrato (responsável, vigência, objeto), classificação de docs com convenção `VENC -`.
5. **Extração inicial do Gmail**: tudo com label `sg3` nos últimos 12 meses → `aprovacoes_email`.
6. Sync da Sheet com tudo coletado.
7. **Gap report** (`data/sg3-monitor/bootstrap/gap-report.md`): lista lacunas que precisam preenchimento manual:
   - Colaboradores sem ASO em `docs_colaborador`
   - Plantas sem `patrimonial_email`
   - Empresas sem PGR/PCMSO em `docs_empresa`
   - CNDs Lume não cadastradas
   - Cartas de subcontratação não cadastradas
   - Pessoas GM sem `email` ou `papeis`

Após o bootstrap, ~30min-1h de cleanup manual cobre as lacunas. O cron diário começa a rodar e mantém tudo sincronizado dali em diante.

## 7. Manual entry contínuo

Edição direta na Sheet. Operações frequentes:

- **Nova carta de subcontratação** → linha em `cartas_subcontratacao`; upload do PDF assinado no Drive; aplicar label `sg3` no email de aprovação quando chegar.
- **Novo colaborador** → linha em `colaboradores` + ASO em `docs_colaborador`.
- **Renovação de doc** → atualizar `data_emissao` + `data_vencimento` na linha existente; dedupe automático.
- **Confirmar prazo extraído por LLM** → flipar `_revisado_humano` para `true` na linha de `aprovacoes_email`.

`npm run sg3:validate` (executa `sync-sheet.mjs --validate-only`) para checar FKs/datas após edições grandes, sem esperar o próximo cron.

## 8. Tratamento de falhas

| Falha | Comportamento |
|-------|---------------|
| SG3 auth expirada | Snapshot `auth_expired` + alerta "🔐 SG3 GM precisa relogin manual" + pipeline segue com snapshot do dia anterior |
| SG3 layout mudou (selector quebrado) | Snapshot `selector_mismatch` com URL/seletor + alerta com diff esperado vs encontrado |
| Drive sem permissão | Falha geral do collector + alerta crítico |
| PDF parser falha | Linha com `extracao_status = manual` + warnings; humano completa |
| LLM extraction falha | Campos vazios + `_revisado_humano = false` + warning |
| Gmail rate limit | Retry com backoff; snapshot parcial é aceito |
| Sheet sem permissão | Falha total + alerta crítico (manual recovery) |
| Notifier falha | Fallback Telegram pessoal; relatório salvo em `data/sg3-monitor/{date}/last-report.md` |
| Falha consecutiva (>2 dias) | Alerta escalado para Telegram pessoal |

## 9. Estratégia de testes

**Unit (`node:test`):**

- `lib/expiry-rules.mjs` — lead time matching, `prazo_efetivo`
- `lib/contract-name-parser.mjs` — regex de filename
- `lib/email-classifier.mjs` — classifier mapping com fixtures
- `lib/contract-pdf-parser.mjs` — fixtures texto extraído → campos esperados

**Integration** (Sheet de teste separada, "GM Compliance Monitor — TEST"):

- `sync-sheet.mjs` aplicado a snapshots fixados → assert rows criadas/atualizadas
- `check-expiries.mjs` com `--mock-today=YYYY-MM-DD` → assert mensagem bate com fixture

**Smoke manual:**

- `npm run sg3:collect-only` — collectors sem tocar Sheet
- `npm run sg3:dry-run` — pipeline completo mas notificação para space de teste

**Não automatizados (custo > benefício):** login Playwright real, LLM extraction end-to-end.

## 10. Escopo Fase 1 (resumo)

**In scope:**

1. `bootstrap.mjs` (spike SG3 + criação da Sheet + carga inicial automatizada + gap report)
2. `collect-sg3.mjs` (API ou Playwright)
3. `collect-drive-contratos.mjs` + `lib/contract-pdf-parser.mjs`
4. `collect-emails.mjs` com label `sg3` + classifier
5. `sync-sheet.mjs` (13 abas)
6. `check-expiries.mjs` (temporal + estado + drift + cálculo de liberações ativas)
7. Notificação Google Chat space `spaces/AAQAoCUA9zA` + escalação Telegram
8. CLI `npm run sg3:status` — tabela de liberações ativas on-demand (lê a Sheet e imprime)
9. Cron diário 07:00 BRT
10. Snooze (se tempo permitir)

**Out of scope (futuras fases):**

- Hyundai (Fase 2 — adaptação de configs por cliente)
- MCP server `sg3-monitor` + skill conversacional `/sg3` (Fase 3)
- DANFEs / notas fiscais
- Email automático de cobrança de renovação
- Dashboard web interativo
- OCR dedicado para PDFs scaneados (LLM-fallback cobre)

## 11. Decisões pendentes (não bloqueantes)

- API SG3 vs Playwright — decidido durante o spike no bootstrap.
- Estrutura completa do PGR/PCMSO/CND da Lume — humano cadastra durante cleanup pós-bootstrap.
- Heurística do parser de filename `VENC - DD/MM/AAAA -` é best-effort; cobertura real só será conhecida ao listar a pasta.
