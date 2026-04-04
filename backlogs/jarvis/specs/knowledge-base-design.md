# Knowledge Base — Design Spec

> **Data:** 2026-04-03
> **Autor:** Pedro Teruel + JARVIS
> **Status:** Draft

---

## 1. Objetivo

Criar uma base de conhecimento completa e detalhada que substitua o Pedro Teruel como fonte de informação para a equipe Strokmatic. Quando um engenheiro ou gestor de projetos precisar saber "como X funciona?", "onde encontro Y?", "por que Z foi decidido?" ou "como opero W?" — a resposta deve estar na KB, não em uma ligação para o Pedro.

## 2. Requisitos

### Público-Alvo
- **Engenheiros de software** (~15 pessoas: firmware, backend, frontend, data science) — precisam de arquitetura, fluxo de dados, detalhes de serviços, runbooks
- **Equipe PMO** — precisam de status de projetos, cronogramas, contatos, processos de compras/entregas

### Decisões de Design
| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Formato | Markdown em repositório git | Time já usa GitHub diariamente |
| Repositório | `teruelskm/knowledge-base` (privado) | Repo pessoal do Pedro — decisão deliberada para manter controle de acesso independente da org. Pedro adiciona colaboradores individualmente. Futuramente pode ser transferido para `strokmatic/` se necessário. |
| Idioma | PT-BR | Substituir o Pedro falando com a equipe |
| Profundidade | Deep (nível de código) | Cobrir desde visão geral até detalhes de implementação |
| Credenciais | Referência apenas | Aponta para local acessível pela equipe (não paths do JARVIS) |
| Q&A | Google Chat bot @JARVIS (fase 2) | Interface natural, com log de perguntas/respostas |
| Auto-update | Git + dispatches + Chat gaps (fase 2+) | KB se mantém atualizada conforme o trabalho progride |

### Tópicos Cobertos
1. **Arquitetura** — como cada produto funciona, fluxo de dados, serviços, diagramas
2. **Localização** — onde encontrar arquivos, configs, deploys, repositórios
3. **Decisões** — histórico de decisões com contexto, alternativas e motivo
4. **Status** — projetos ativos, cronogramas, quem está trabalhando em quê
5. **Operações** — runbooks de deploy, rollback, acesso a produção, troubleshooting
6. **Responsabilidades** — mapa de ownership, contatos internos e externos

## 3. Estrutura do Repositório

```
knowledge-base/
├── README.md                      # Ponto de entrada — o que é, como usar
├── INDEX.md                       # Índice mestre — links para todas as páginas
├── CHANGELOG.md                   # Histórico de mudanças na KB
│
├── produtos/                      # Deep-dives por produto
│   ├── diemaster/
│   │   ├── visao-geral.md         # O que é, contexto de negócio
│   │   ├── arquitetura.md         # Arquitetura completa + diagramas Mermaid
│   │   ├── servicos/              # Um arquivo por microsserviço (13 serviços)
│   │   │   ├── get-data.md
│   │   │   ├── database-writer.md
│   │   │   ├── inference.md
│   │   │   ├── backend.md
│   │   │   ├── connect.md
│   │   │   ├── data-processing.md
│   │   │   ├── loader.md
│   │   │   ├── plc-monitor.md
│   │   │   ├── setting.md
│   │   │   ├── status.md
│   │   │   ├── trigger.md
│   │   │   └── infra-setup.md
│   │   ├── firmware/              # Hub, Switch, protocolos
│   │   │   ├── firmware-hub.md
│   │   │   └── firmware-switch.md
│   │   ├── frontend.md            # Angular 17, rotas, estado
│   │   ├── banco-de-dados.md      # PostgreSQL 15, schema, migrations, soft-delete
│   │   ├── ml-modelos.md          # ONNX/PyTorch, treino, draw-in prediction (2.07mm RMSE)
│   │   ├── deploys/               # Um arquivo por planta/deployment
│   │   │   ├── gm-sjc-01001.md
│   │   │   ├── gm-flint-01002.md
│   │   │   ├── schulz-01003.md
│   │   │   ├── 01004.md
│   │   │   └── 01005.md
│   │   ├── troubleshooting.md     # Problemas conhecidos, debugging
│   │   └── decisoes.md            # Decisões específicas do produto
│   │
│   ├── spotfusion/
│   │   ├── visao-geral.md
│   │   ├── arquitetura.md
│   │   ├── servicos/              # 26+ serviços (enumeração completa derivada de workspaces.json)
│   │   │   ├── get-data.md
│   │   │   ├── database-writer.md
│   │   │   ├── inference.md
│   │   │   ├── backend.md
│   │   │   ├── frontend.md
│   │   │   └── ...                # Demais serviços enumerados no scaffolding
│   │   ├── pipeline-inferencia.md # 4 variantes, SpINN
│   │   ├── banco-de-dados.md      # Padrão EAV, PostgreSQL 15
│   │   ├── ml-modelos.md          # Optuna, ClearML, TensorRT
│   │   ├── deploys/               # 7+ plantas (enumeração de config/project-codes.json)
│   │   │   ├── gm-scs-02001.md
│   │   │   ├── gm-sjc-02002.md
│   │   │   ├── gm-gravatai-02003.md
│   │   │   ├── hyundai-02004.md
│   │   │   ├── nissan-02005.md
│   │   │   ├── gm-rosario-02006.md
│   │   │   ├── gm-alvear-02007.md
│   │   │   └── gm-joinville-02008.md
│   │   ├── troubleshooting.md
│   │   └── decisoes.md
│   │
│   └── visionking/
│       ├── visao-geral.md
│       ├── arquitetura.md
│       ├── servicos/              # 22 submodules (enumeração de workspaces.json)
│       │   ├── camera-acquisition.md
│       │   ├── image-saver.md
│       │   ├── inference.md
│       │   ├── database-writer.md
│       │   ├── backend.md
│       │   ├── frontend.md
│       │   └── ...                # Demais serviços enumerados no scaffolding
│       ├── camera-aquisicao.md    # GigE/WiFi/3D, GenICam, C++
│       ├── pipeline-inferencia.md # YOLO v8/v10, ONNX Runtime, Kalman
│       ├── perfis/                # Perfis de deploy por tipo de inspeção
│       │   ├── steel.md
│       │   ├── body.md
│       │   ├── sparktest.md
│       │   └── sealer.md
│       ├── banco-de-dados.md
│       ├── plc-integracao.md      # Siemens S7, config de tags
│       ├── deploys/               # 10+ deployments (de config/project-codes.json)
│       │   ├── arcelormittal-laminacao-03002.md
│       │   ├── arcelormittal-carrocerias-03003.md
│       │   ├── iris-scds-03004.md
│       │   ├── iris-gvt-03005.md
│       │   ├── usiminas-03006.md
│       │   ├── stellantis-03007.md
│       │   ├── hyundai-03008.md
│       │   └── ...                # Demais deployments enumerados no scaffolding
│       ├── monitoramento.md       # Health checks, Prometheus, alertas
│       ├── troubleshooting.md
│       └── decisoes.md
│
├── plataforma/                    # Infraestrutura cross-product
│   ├── sdk/
│   │   ├── visao-geral.md         # O que tem no SDK, como produtos consomem
│   │   ├── indice-repos.md        # Lista completa dos 28+ repos SDK com descrição
│   │   ├── rabbit-client.md
│   │   ├── logging.md
│   │   ├── observability.md
│   │   ├── ui-components.md
│   │   ├── bos6000-toolkit.md
│   │   ├── image-exporter.md
│   │   ├── video-cronoanalysis.md
│   │   ├── label-studio.md
│   │   ├── agent-standards.md     # Plugin marketplace
│   │   └── ...                    # Demais repos enumerados no scaffolding
│   ├── github.md                  # Org, repos, branches, rulesets
│   ├── gcp.md                     # Cloud Build, GCR, service accounts
│   ├── ci-cd.md                   # Pipelines de build e deploy
│   ├── docker.md                  # Convenções de imagem, compose patterns
│   ├── submodulos.md              # Workflow monorepo + submodules, gotchas
│   ├── testes.md                  # Framework E2E, portas alocadas, TDD
│   ├── seguranca.md               # Dívida técnica de segurança, política de credenciais, eval()
│   ├── monitoramento.md           # Prometheus, Grafana, alertas
│   └── rede-local.md              # Máquinas LAN, VPN, topologia
│
├── operacoes/                     # Runbooks & procedimentos
│   ├── deploy-producao.md         # Passo-a-passo deploy em produção
│   ├── rollback.md                # Como reverter um deploy problemático
│   ├── acesso-producao.md         # SSH, VPN, mapa de credenciais
│   ├── banco-de-dados.md          # Acesso, backups, migrations
│   ├── rabbitmq.md                # Gestão de filas, dead letters
│   ├── incidentes.md              # Playbook de resposta a incidentes
│   └── manutencao.md              # Procedimentos de manutenção programada
│
├── pmo/                           # Gestão de projetos
│   ├── projetos-ativos.md         # Lista de projetos com status atual
│   ├── codigo-projetos.md         # Sistema de numeração 01xxx/02xxx/03xxx
│   ├── cronograma.md              # Roadmap, marcos, prazos
│   ├── fornecedores.md            # Contatos de fornecedores, contratos
│   ├── ferramentas.md             # ClickUp, Drive, Figma, Miro
│   └── processos/
│       ├── abertura-projeto.md    # Como abrir um novo projeto
│       ├── compras.md             # Workflow de compras
│       └── entregas.md            # Processo de entrega/comissionamento
│
├── decisoes/                      # Log de decisões cross-product
│   ├── 2024.md                    # Decisões históricas
│   ├── 2025.md
│   └── 2026.md                    # Ano corrente, cronológico
│
├── referencias/                   # Material de referência rápida
│   ├── credenciais.md             # Mapa de credenciais (onde encontrar, não valores)
│   ├── contatos.md                # Equipe, responsabilidades, contatos externos
│   ├── glossario.md               # Termos do domínio (PT-BR + EN)
│   ├── portas-servicos.md         # Tabela de portas (produção + testes)
│   ├── ferramentas.md             # Índice de ferramentas (o que, por quê, onde)
│   └── links-uteis.md             # Figma, Miro, Drive, ClickUp, dashboards
│
└── registro-qa/                   # Trilha de auditoria Q&A
    ├── README.md                  # Como funciona o registro
    ├── 2026-04.md                 # Arquivos mensais
    └── pendentes.md               # Perguntas sem resposta / lacunas na KB
```

## 4. Formato das Páginas

Cada página segue um template consistente:

```markdown
# [Título]

> Última atualização: YYYY-MM-DD | Fonte: [link para repo/commit]

## Contexto
Por que isso existe, propósito de negócio, quem se importa.

## Como Funciona
Explicação técnica — do alto nível ao detalhe de código.
Diagramas Mermaid para arquitetura e fluxo de dados.

## Configuração
Arquivos de config, variáveis de ambiente, feature flags.
Aponta para paths no repositório do produto (não paths do JARVIS).

## Problemas Conhecidos
Issues conhecidos, pegadinhas, workarounds.
Seção de maior valor — o que só o Pedro sabe hoje.

## Histórico de Decisões
Por que foi construído assim, alternativas consideradas, quem decidiu.

## Ver Também
Referências cruzadas para outras páginas da KB.
```

### Formato do Log de Decisões

```markdown
### YYYY-MM-DD — [Título da Decisão]

**Contexto:** Qual problema estávamos resolvendo
**Opções consideradas:** Quais alternativas existiam
**Decisão:** O que foi escolhido
**Motivo:** Por quê (a parte mais importante)
**Consequências:** O que isso implica daqui pra frente
**Responsável:** Quem tomou a decisão
```

### Formato do Registro Q&A

```markdown
### YYYY-MM-DD HH:MM — [Pergunta resumida]

**Quem perguntou:** Nome ou @handle
**Pergunta:** Texto completo da pergunta
**Resposta:** Texto completo da resposta fornecida
**Página KB atualizada:** [link] (se aplicável)
**Lacuna identificada:** sim/não (se sim, issue aberta)
```

## 5. Estratégia de Geração de Conteúdo

### Fontes de Verdade (ordem de prioridade)

1. **Memória JARVIS & histórico de sessões** — decisões, pegadinhas, conhecimento de arquitetura acumulado
2. **Exploração do codebase** — código real nos 3 monorepos, docker-compose, configs, READMEs
3. **Contexto mestre Strokmatic** (`docs/strokmatic-master-context.md`) — inventário de 3.218 tasks
4. **Documentação existente** — `docs/plans/`, `backlogs/plans/`, READMEs de produto, `docs/lessons-learned.md`
5. **Arquivo de reports** — PR reviews, sandbox specs, relatórios de health monitoring
6. **Export ClickUp** — histórico de tasks com contexto

### Processo de Geração

Para cada produto, um agente JARVIS explora o monorepo e extrai:
- Lista de serviços, entry points, configs Docker, variáveis de ambiente
- Nomes de filas/exchanges RabbitMQ (do código)
- Schemas de banco a partir de migrations ou models
- Endpoints de API a partir de route definitions
- Perfis de deploy a partir de docker-compose files

Essa extração factual é combinada com o conhecimento contextual da memória JARVIS (o "por quê", as pegadinhas, as decisões) para produzir cada página.

### Conteúdo que Requer Input do Pedro
- Racional de decisões que nunca foi documentado
- Informações de fornecedores e contatos
- Nuances de status de projeto que não estão no ClickUp
- Estratégia de acesso a credenciais (onde a equipe deve encontrar senhas?)

### Escopo Estimado
| Seção | Páginas | Fonte Principal |
|-------|---------|-----------------|
| Produtos — serviços | ~45 | Codebase + memória JARVIS |
| Produtos — arquitetura/deploys | ~20 | Codebase + master context |
| Plataforma | ~14 | Codebase + configs |
| Operações | ~7 | Memória JARVIS + scripts |
| PMO | ~8 | ClickUp export + memória |
| Referências | ~6 | Configs + memória |
| Decisões (seed) | ~3 | Memória JARVIS + lessons-learned |
| **Total** | **~100-105** | |

### Ondas de Execução (prioridade por valor imediato)

A geração de conteúdo acontece em ondas, cada uma entregando valor incremental:

| Onda | Conteúdo | Páginas | Por quê primeiro |
|------|----------|---------|-----------------|
| **1 — Fundação** | README, INDEX, arquitetura de cada produto (3), troubleshooting de cada produto (3), referências rápidas (credenciais, contatos, portas, glossário) | ~12 | Maior valor imediato — as perguntas mais frequentes respondidas |
| **2 — Operações** | Runbooks (deploy, rollback, acesso, DB, RabbitMQ, incidentes, manutenção) | ~7 | Segundo maior impacto — equipe precisa operar sem o Pedro |
| **3 — Serviços DM** | Todos os serviços DieMaster + firmware + frontend + DB + ML | ~17 | Produto por produto, começando pelo menor (mais rápido de validar) |
| **4 — Serviços SF** | Todos os serviços SpotFusion + pipeline + DB + ML | ~15 | Segundo produto |
| **5 — Serviços VK** | Todos os serviços VisionKing + câmera + perfis + PLC + monitoramento | ~20 | Produto mais complexo, mais serviços |
| **6 — Plataforma** | SDK, GitHub, GCP, CI/CD, Docker, submodules, testes, segurança, rede | ~14 | Infraestrutura cross-product |
| **7 — PMO & Decisões** | Projetos ativos, cronograma, fornecedores, processos, logs de decisão | ~11 | Menor urgência — PMO tem alternativas (ClickUp, Drive) |
| **8 — Deploys** | Todas as páginas de deploy por planta (DM + SF + VK) | ~20+ | Páginas especializadas — valor alto mas escopo mais restrito |

Cada onda gera um PR no repo da KB para revisão do Pedro antes de merge.

### Critérios de Aceitação por Tipo de Página

**Página de serviço** (deve conter):
- Entry point e imagem Docker
- Variáveis de ambiente documentadas
- Filas RabbitMQ consumidas/publicadas
- Tabelas de banco acessadas
- Endpoints de API (se aplicável)
- Pelo menos 2 problemas conhecidos/pegadinhas
- Diagrama Mermaid de interação com outros serviços

**Página de arquitetura** (deve conter):
- Diagrama Mermaid do fluxo de dados completo
- Lista de todos os serviços com papel de cada um (1 linha)
- Stack tecnológico (linguagem, framework, DB, cache, MQ)
- Padrões de comunicação (sync/async, protocolos)

**Página de deploy** (deve conter):
- Endereço da planta / ambiente
- Serviços rodando e suas versões/profiles
- Topologia de rede (IPs, portas)
- Procedimento de acesso (VPN, SSH)
- Particularidades do ambiente (hardware, rede, restrições)

**Página de operação/runbook** (deve conter):
- Pré-requisitos (acesso, ferramentas)
- Passos numerados com comandos exatos
- Como verificar sucesso
- O que fazer se falhar
- Contato de escalação

**Página de referência** (deve conter):
- Tabela estruturada com dados consultáveis
- Links para fontes primárias
- Data da última verificação

### Workflow de Revisão

1. JARVIS gera uma onda de páginas em branch `wave-N`
2. Abre um PR único por onda (5-20 páginas) com checklist dos critérios de aceitação
3. Pedro revisa via PR comments no GitHub
4. Páginas aprovadas: merge para `main`
5. Páginas com correções: JARVIS aplica feedback, push no mesmo PR
6. Opcionalmente, Pedro pode delegar revisão de produto específico para domain expert (ex: Arthur Mallman para SpotFusion, Vinicius Sotero para VisionKing)

### Resolução de Conflitos entre Fontes

Quando fontes divergem (ex: código difere do master context), a prioridade é:
1. **Código atual** — verdade absoluta para estado técnico
2. **Memória JARVIS** — verdade para contexto e decisões
3. **Master context / docs** — pode estar desatualizado
4. **ClickUp export** — snapshot pontual, pode estar obsoleto

Conflitos identificados são marcados com `⚠️ VERIFICAR` no texto para Pedro resolver na revisão.

## 6. Mecanismo de Atualização Automática (Fase 2)

### Feed 1 — Monitor de Atividade Git

Um cron job JARVIS monitora os repos de produto para merges em `main`/`master`. Quando um merge toca um serviço que tem página na KB, o sistema:
1. Marca a página como potencialmente desatualizada
2. Extrai o que mudou (diff + commit messages)
3. Abre um PR no repo da KB com sugestões de atualização

**Implementação:** Script shell/Node.js rodando no cron do JARVIS, usando `gh api` para detectar merges e `claude --print` para gerar drafts de atualização.

### Feed 2 — Hook Pós-Dispatch JARVIS

Após cada conclusão de task JARVIS, um hook verifica se a task tocou áreas cobertas pela KB:
1. Adiciona entrada no `CHANGELOG.md` da KB
2. Opcionalmente abre PR com draft de atualização
3. Atualiza timestamp de "última atividade" nas páginas relevantes

**Implementação:** Post-dispatch hook no `settings.local.json`, invocando script que faz cross-reference entre paths modificados e páginas da KB.

### Feed 3 — Feedback Loop do Chat Q&A (Fase 3)

Quando o bot @JARVIS no Google Chat responde uma pergunta:
1. O exchange é logado em `registro-qa/YYYY-MM.md`
2. Se o bot não conseguiu responder (lacuna na KB), cria issue no repo tagged `lacuna`
3. Periodicamente, JARVIS revisa lacunas acumuladas e drafta novas páginas

**Implementação:** Google Chat App (Apps Script ou Cloud Function) que interage com a KB via Git e usa `claude --print` para responder perguntas com contexto da KB.

### Deduplicação entre Feeds

Feed 2 (pós-dispatch) tem prioridade sobre Feed 1 (monitor git) porque tem contexto mais rico da task executada. Para evitar PRs duplicados:
- Feed 2 registra em `kb-updates.json` quais páginas foram atualizadas e o commit SHA correspondente
- Feed 1 consulta `kb-updates.json` antes de abrir PR — se o commit já foi coberto por Feed 2, ignora
- Alternativamente, ambos os feeds escrevem em branch `staging`, e um job de consolidação semanal abre um único PR

### Detecção de Obsolescência

Cada página tem um timestamp "Última atualização" que é comparado com atividade git recente nos paths relevantes do repo do produto. Um job semanal JARVIS gera um relatório de obsolescência — páginas que não foram atualizadas apesar de mudanças de código no domínio delas.

**Formato do relatório:**
```markdown
# Relatório de Obsolescência — YYYY-MM-DD

## Páginas Potencialmente Desatualizadas
| Página | Última Atualização | Último Commit Relevante | Gap |
|--------|-------------------|------------------------|-----|
| produtos/visionking/servicos/inference.md | 2026-03-15 | 2026-04-01 | 17 dias |
```

**Limiares de obsolescência por tipo de página:**
| Tipo de Página | Limiar | Motivo |
|---------------|--------|--------|
| Serviço | 14 dias | Muda frequentemente com desenvolvimento |
| Arquitetura | 30 dias | Muda com decisões de design |
| Deploy | 60 dias | Muda com releases e comissionamentos |
| Operações/Runbook | 30 dias | Procedimentos devem ser atuais |
| PMO/Status | 7 dias | Status muda semanalmente |
| Referências | 90 dias | Dados relativamente estáveis |
| Decisões | Nunca obsoleto | Histórico permanente |

## 7. Fases de Implementação

### Fase 1 — Conteúdo Inicial (este plano)
- Criar repo `teruelskm/knowledge-base` (privado)
- Scaffolding da estrutura de diretórios
- Gerar todas as ~85-95 páginas a partir das fontes de verdade
- Pedro revisa e complementa com conhecimento não documentado
- **Entregável:** KB completa, navegável via GitHub

### Fase 2 — Auto-Update
- Feed 1: Monitor de atividade git (cron)
- Feed 2: Hook pós-dispatch JARVIS
- Detecção de obsolescência semanal
- **Entregável:** KB se mantém atualizada automaticamente

### Fase 3 — Chat Bot @JARVIS
- Google Chat App para consultas em linguagem natural
- RAG (Retrieval-Augmented Generation) sobre o conteúdo da KB
- Log de Q&A + detecção de lacunas
- Feed 3: Feedback loop de perguntas sem resposta
- **Entregável:** Equipe consulta a KB via chat, com auditoria

## 8. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Conteúdo gerado com imprecisões | Alta | Alto | Pedro revisa cada página antes de publish |
| KB fica desatualizada rapidamente | Média | Alto | Fase 2 — auto-update + detecção de obsolescência |
| Equipe não adota / não consulta | Média | Alto | Fase 3 — Chat bot reduz fricção de acesso |
| Credenciais vazam para KB | Baixa | Crítico | Política de referência-apenas + .gitignore patterns |
| Volume de páginas dificulta manutenção | Média | Médio | INDEX.md centralizado + auto-update |
| Volume de revisão sobrecarrega Pedro | Alta | Alto | Ondas de execução limitam a ~20 páginas por PR. Pedro pode delegar revisão por produto (ex: Arthur → SF, Vinicius → VK) |
| Informação conflitante entre fontes | Média | Médio | Prioridade definida (código > memória > docs > ClickUp). Conflitos marcados com ⚠️ VERIFICAR |

## 9. Critérios de Sucesso

- [ ] Todas as ~100-105 páginas geradas e revisadas (pelo Pedro ou domain expert delegado)
- [ ] Cada página atende os critérios de aceitação do seu tipo
- [ ] INDEX.md com links funcionais para todas as páginas
- [ ] Nenhum valor de credencial no repositório
- [ ] Pelo menos 3 membros da equipe com acesso de leitura ao repo
- [ ] Pedro consegue responder "está na KB" em vez de explicar pessoalmente
