# Guia Claude Code — Strokmatic

**Data:** 2026-03-23<br>
**Audiência:** Desenvolvedores Strokmatic<br>
**Formato:** Walkthrough + Demos ao vivo

---

## Índice

1. [Instalação e Setup](#1-instalação-e-setup) — Claude Code + GitHub CLI + autenticação
2. [Configuração Inicial](#2-configuração-inicial) — modelo, permissões, CLAUDE.md
3. [Conceitos Essenciais](#3-conceitos-essenciais) — tools, atalhos, slash commands
4. [Funcionalidades Nativas](#4-funcionalidades-nativas) — Plan mode, subagents, worktrees, gh CLI, MCP, hooks
5. [Plugin Superpowers](#5-plugin-superpowers) — brainstorming, TDD, debugging, code review
6. [Skills Customizados](#6-skills-customizados) — docs, Google Workspace, engenharia, como criar
7. [Roteiro de Demos ao Vivo](#7-roteiro-de-demos-ao-vivo) — 7 demos com comandos prontos
8. [Dicas e Boas Práticas](#8-dicas-e-boas-práticas) — prompts, modos, segurança

---

## 1. Instalação e Setup

### Pré-requisitos

- **GitHub CLI (`gh`)** — para integração com GitHub (PRs, issues, reviews)
- Terminal com suporte a cores (qualquer terminal moderno)
- Conta Anthropic com plano **Pro**, **Max**, **Team** ou **Enterprise**

### Instalação

```bash
# 1. Instalar Claude Code (instalador nativo — não precisa de Node.js)
curl -fsSL https://claude.ai/install.sh | bash

# Verificar instalação
claude --version

# Alternativa via npm (requer Node.js 18+):
sudo apt install npm
npm install -g @anthropic-ai/claude-code

# 2. Instalar GitHub CLI (se ainda não tiver)
sudo apt install gh        # Ubuntu/Debian
# ou: brew install gh      # macOS
```

### Autenticação

**Claude Code (OAuth)** — não é necessário gerar API keys:

```bash
claude login
```

Abre o browser para autenticação com sua conta Anthropic. Após autorizar, o terminal fica autenticado.

**GitHub CLI:**

```bash
gh auth login
```

Escolha "GitHub.com" → "HTTPS" → "Login with a web browser". Isso permite que o Claude Code crie PRs, reviews e issues em seu nome.

### Primeiro Uso

```bash
# Abrir uma sessão interativa no diretório do projeto
cd ~/meu-projeto
claude
```

O Claude Code analisa o repositório automaticamente (estrutura de arquivos, git status, linguagens) e está pronto para receber comandos.

---

## 2. Configuração Inicial

### Modelo

O Claude Code suporta múltiplos modelos. Para trocar durante uma sessão:

```
/model
```

Modelos disponíveis:

| Modelo       | Uso recomendado                                   |
| ------------ | ------------------------------------------------- |
| **Opus 4**   | Tarefas complexas, arquitetura, debugging difícil |
| **Sonnet 4** | Uso geral, boa relação velocidade/qualidade       |
| **Haiku 4**  | Tarefas rápidas, perguntas simples                |

### Tema

```
/config
```

Permite configurar tema (escuro/claro), notificações e outras preferências.

### Permissões

O Claude Code pede confirmação antes de executar ações potencialmente destrutivas (deletar arquivos, fazer git push, etc.). Você pode pré-aprovar ferramentas específicas:

```
/permissions
```

Exemplo: permitir `npm install`, `npm test`, `git status` sem confirmação.

### Arquivo `CLAUDE.md` — Instruções do Projeto

O arquivo mais importante para personalizar o comportamento. Crie um `CLAUDE.md` na raiz do projeto:

```markdown
# Instruções do Projeto

## Stack

- Backend: NestJS + TypeScript
- Frontend: Angular 17
- Banco: PostgreSQL 15
- Mensageria: RabbitMQ

## Convenções

- Commits em inglês, formato Conventional Commits
- Testes com Jest (backend) e Jasmine (frontend)
- Nunca commitar .env ou credenciais

## Estrutura

- services/backend/ — API REST
- services/frontend/ — Dashboard Angular
- services/data-processing/ — Pipeline Python
```

O Claude Code lê esse arquivo automaticamente em toda sessão e segue as instruções. É como um "onboarding permanente" — tudo que você teria que explicar para um colega novo, coloque aqui.

**Localização dos arquivos de instrução:**

| Arquivo                               | Escopo                     | Compartilhado via git? |
| ------------------------------------- | -------------------------- | ---------------------- |
| `CLAUDE.md` (raiz do projeto)         | Todo o projeto             | Sim                    |
| `.claude/CLAUDE.md`                   | Projeto (diretório oculto) | Sim                    |
| `~/.claude/CLAUDE.md`                 | Global (todos os projetos) | Não                    |
| `~/.claude/projects/<path>/CLAUDE.md` | Projeto (pessoal)          | Não                    |

---

## 3. Conceitos Essenciais

### Context Window

O Claude Code opera com uma janela de contexto de até **1M tokens** (Opus). Ele automaticamente:

- Lê arquivos relevantes ao seu pedido
- Comprime mensagens antigas quando o contexto se aproxima do limite
- Mantém a sessão fluindo sem limite de duração

Comando útil para liberar contexto manualmente:

```
/compact
```

Resume a conversa num sumário e libera espaço.

### Ferramentas (Tools)

O Claude Code não é apenas um chat — ele tem **ferramentas** que executa autonomamente:

| Ferramenta    | O que faz                                     |
| ------------- | --------------------------------------------- |
| **Read**      | Lê arquivos do disco                          |
| **Edit**      | Edita arquivos (mostra diff antes de aplicar) |
| **Write**     | Cria novos arquivos                           |
| **Bash**      | Executa comandos no terminal                  |
| **Glob**      | Busca arquivos por padrão (ex: `**/*.ts`)     |
| **Grep**      | Busca conteúdo em arquivos (regex)            |
| **Agent**     | Cria sub-agentes para tarefas paralelas       |
| **WebSearch** | Pesquisa na web                               |
| **WebFetch**  | Baixa conteúdo de URLs                        |

### Atalhos de Teclado

| Atalho      | Ação                                              |
| ----------- | ------------------------------------------------- |
| `Escape`    | Cancela a geração atual                           |
| `Shift+Tab` | Alterna entre modos (Normal → Plan → Auto-Accept) |
| `Tab`       | Aceita sugestão de autocomplete                   |
| `Ctrl+C`    | Cancela/sai                                       |
| `Ctrl+D`    | Encerra a sessão                                  |
| `Ctrl+O`    | Mostra/esconde extended thinking                  |
| `Ctrl+R`    | Busca reversa no histórico                        |
| `Ctrl+G`    | Abre o prompt atual no editor de texto            |
| `Alt+P`     | Trocar modelo sem limpar o prompt                 |
| `↑` / `↓`   | Navega histórico de mensagens                     |
| `?`         | Lista todos os atalhos disponíveis                |

### Slash Commands Nativos

| Comando        | Descrição                                            |
| -------------- | ---------------------------------------------------- |
| `/help`        | Ajuda geral                                          |
| `/model`       | Trocar modelo (opus, sonnet, haiku)                  |
| `/compact`     | Compactar contexto (liberar espaço)                  |
| `/clear`       | Limpar conversa                                      |
| `/resume`      | Retomar sessão anterior                              |
| `/config`      | Configurações                                        |
| `/permissions` | Gerenciar permissões de ferramentas                  |
| `/memory`      | Ver/editar memória persistente e CLAUDE.md           |
| `/status`      | Status da sessão e assinatura                        |
| `/cost`        | Custo e tokens acumulados da sessão                  |
| `/init`        | Gerar um CLAUDE.md inicial para o projeto            |
| `/hooks`       | Ver hooks configurados                               |
| `/agents`      | Criar/gerenciar subagentes customizados              |
| `/effort`      | Ajustar nível de raciocínio (low, medium, high, max) |
| `/theme`       | Trocar tema de cores                                 |
| `/vim`         | Ativar modo vim de edição                            |

> Dica: digite `/` para ver todos os comandos disponíveis e buscar pelo nome.

---

## 4. Funcionalidades Nativas

### 4.1 Plan Mode vs Act Mode

O Claude Code tem dois modos de operação:

- **Act Mode** (padrão): Lê, edita, executa — faz as coisas
- **Plan Mode**: Analisa, planeja, propõe — sem modificar nada

Alterne com `Shift+Tab` ou digitando:

```
/plan          # Entra em Plan Mode
```

**Quando usar Plan Mode:**

- Antes de tarefas complexas (refatoração, nova feature)
- Para entender código desconhecido
- Para pedir uma análise de arquitetura

**Exemplo prático:**

```
[Plan Mode]
> Analise a arquitetura do serviço database-writer e proponha
> como adicionar suporte a batch inserts sem quebrar o fluxo atual
```

O Claude analisa os arquivos, mapeia dependências, e apresenta um plano detalhado sem tocar em nenhum código.

### 4.2 Subagents (Agentes Paralelos)

O Claude Code pode criar **sub-agentes** que trabalham em paralelo. Útil para:

- Pesquisar em múltiplos diretórios simultaneamente
- Executar tarefas independentes em paralelo
- Isolar explorações complexas sem poluir o contexto principal

O Claude decide automaticamente quando usar subagents, mas você pode solicitar:

```
> Pesquise em paralelo: (1) como o RabbitMQ é configurado no backend,
> (2) quais filas existem no docker-compose, e (3) se há dead-letter
> queues configuradas
```

### 4.3 Git Worktrees

Para trabalho isolado sem afetar sua branch atual:

```
> Crie uma worktree para implementar a feature X isoladamente
```

O Claude cria um git worktree (cópia isolada do repo), trabalha lá, e ao final você decide se quer mesclar as mudanças.

### 4.4 Memory (Memória Persistente)

O Claude Code mantém memória entre sessões:

```
/memory
```

Tipos de memória:

- **Preferências do usuário** — "prefiro código conciso", "use PT-BR nos commits"
- **Feedback** — correções que você deu que devem persistir
- **Contexto do projeto** — decisões, convenções, informações que não estão no código

**Exemplo:**

```
> Lembre que neste projeto usamos KeyDB na porta 4000,
> não Redis na porta padrão
```

Na próxima sessão, ele já sabe disso.

### 4.5 MCP (Model Context Protocol)

MCP é um protocolo aberto que permite conectar o Claude Code a **ferramentas externas**:

- Google Workspace (Docs, Sheets, Drive)
- Bancos de dados
- APIs internas
- Sistemas de monitoramento
- Qualquer serviço com um MCP server

**Configuração** (em `.claude/settings.json` ou `.claude.json`):

```json
{
  "mcpServers": {
    "meu-servidor": {
      "command": "node",
      "args": ["caminho/para/server.js"],
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
```

Com MCP, o Claude Code pode:

- Ler e escrever Google Docs
- Criar planilhas no Google Sheets
- Enviar notificações via Telegram
- Consultar APIs internas

### 4.6 Hooks (Automações)

Hooks são scripts que executam automaticamente em eventos do Claude Code:

| Evento         | Quando executa                |
| -------------- | ----------------------------- |
| `SessionStart` | Ao iniciar uma sessão         |
| `PreToolUse`   | Antes de usar uma ferramenta  |
| `PostToolUse`  | Depois de usar uma ferramenta |
| `Stop`         | Quando o Claude para de gerar |

**Exemplo prático:** um hook que roda `npm test` automaticamente após cada edição de arquivo `.ts`.

Configuração em `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "command": "npm test --silent 2>&1 | tail -5"
      }
    ]
  }
}
```

### 4.7 Integração com GitHub CLI (`gh`)

O Claude Code usa o **GitHub CLI** (`gh`) nativamente para interagir com o GitHub. Isso significa que ele pode gerenciar PRs, issues, releases e repositórios diretamente pelo terminal.

#### Instalação e autenticação do `gh`

```bash
# Instalar (Ubuntu/Debian)
sudo apt install gh

# Autenticar
gh auth login
```

#### O que o Claude Code consegue fazer via `gh`

| Operação               | Exemplo de pedido                                                 |
| ---------------------- | ----------------------------------------------------------------- |
| **Criar PR**           | "Crie um PR desta branch para develop com descrição das mudanças" |
| **Revisar PR**         | "Leia o PR #42 e faça um code review"                             |
| **Listar PRs abertos** | "Quais PRs estão abertos neste repo?"                             |
| **Criar issue**        | "Crie uma issue para o bug de conexão Redis"                      |
| **Ver checks de CI**   | "O CI do PR #42 passou?"                                          |
| **Comentar em PR**     | "Comente no PR #42 que a correção do lint foi feita"              |
| **Merge de PR**        | "Faça merge do PR #42 com squash"                                 |
| **Ver releases**       | "Quais foram as últimas 5 releases?"                              |

#### Exemplos práticos

**Criar um PR completo com descrição estruturada:**

```
> Crie um PR desta branch para develop. Inclua um resumo
> das mudanças, o que foi testado, e o que o reviewer
> deve prestar atenção.
```

O Claude analisa o diff, os commits, e gera automaticamente:

- Título conciso
- Descrição com resumo, lista de mudanças, e plano de teste
- Labels se aplicável

**Revisar um PR de um colega:**

```
> Leia o PR #15 do repo diemaster-backend e faça um
> code review focado em segurança e performance
```

O Claude baixa o diff via `gh`, analisa o código, e apresenta o review com comentários por arquivo.

**Ciclo completo — commit + PR em um pedido:**

```
> Commit as mudanças atuais com uma mensagem descritiva,
> push para a branch, e crie um PR para develop
```

> **Nota:** O Claude Code sempre pede confirmação antes de `git push`, `gh pr create` e `gh pr merge`. Você mantém o controle.

### 4.8 Modo `--print` (Automação)

Para usar o Claude Code em scripts e pipelines CI/CD:

```bash
echo "Liste todos os TODOs neste projeto" | claude --print --model sonnet
```

Flags úteis:

- `--print` / `-p` — modo não-interativo, retorna texto
- `--model` — escolher modelo
- `--allowedTools` — pré-aprovar ferramentas
- `--max-budget-usd` — limitar gasto

Combinado com `gh`, permite automações poderosas:

```bash
# Revisar todos os PRs abertos automaticamente
gh pr list --json number,title | \
  jq -r '.[] | "Revise o PR #\(.number): \(.title)"' | \
  while read prompt; do
    echo "$prompt" | claude --print --model sonnet
  done
```

---

## 5. Plugin Superpowers

O plugin **Superpowers** adiciona skills de processo ao Claude Code. São workflows estruturados que guiam o Claude em tarefas complexas.

### 5.1 Brainstorming (`/brainstorm` ou automático)

Antes de implementar qualquer feature, o Claude:

1. Faz perguntas para entender o que você quer
2. Propõe 2-3 abordagens com trade-offs
3. Apresenta o design seção por seção
4. Só implementa após aprovação

**Quando é ativado:** Automaticamente quando você pede algo criativo ("crie um componente", "adicione uma feature", "construa um módulo").

### 5.2 TDD — Test-Driven Development

Workflow disciplinado:

1. Escreve o teste primeiro (RED)
2. Implementa o mínimo para passar (GREEN)
3. Refatora mantendo os testes verdes (REFACTOR)

```
> Implemente um serviço de validação de configuração de topologia
> usando TDD
```

### 5.3 Debugging Sistemático

Quando algo está falhando, em vez de chutar soluções:

1. Reproduz o erro
2. Formula hipóteses
3. Testa cada hipótese isoladamente
4. Aplica a correção com evidência

```
> O database-writer está falhando com "connection refused"
> intermitentemente. Debug isso.
```

### 5.4 Code Review

Revisão estruturada de código com checklist:

- Correção lógica
- Performance
- Segurança
- Manutenibilidade
- Testes

```
> Faça um code review das mudanças na branch feat/batch-inserts
```

### 5.5 Plan Writing & Execution

Para tarefas grandes, o Claude cria um plano detalhado com:

- Passos numerados
- Dependências entre passos
- Estimativa de complexidade
- Checkpoints de revisão

Depois executa passo a passo, reportando progresso.

---

## 6. Skills Customizados

Skills são slash commands personalizados que adicionam capacidades ao Claude Code. Alguns exemplos do que é possível construir:

### 6.1 Documentos Office

| Comando      | O que faz                           | Exemplo                                          |
| ------------ | ----------------------------------- | ------------------------------------------------ |
| `/docx`      | Cria/edita documentos Word          | "Gere um relatório de status do projeto em Word" |
| `/xlsx`      | Cria/edita planilhas Excel          | "Crie uma planilha com o inventário de sensores" |
| `/pptx`      | Cria/edita apresentações PowerPoint | "Monte uma apresentação do pipeline VisionKing"  |
| `/md-to-pdf` | Exporta Markdown para PDF           | "Exporte este relatório para PDF"                |

### 6.2 Google Workspace (via MCP)

| Comando    | O que faz                      | Exemplo                                       |
| ---------- | ------------------------------ | --------------------------------------------- |
| `/gdoc`    | Cria/lê/edita Google Docs      | "Crie um doc com a ata da reunião"            |
| `/gsheet`  | Cria/lê/edita Google Sheets    | "Crie uma planilha de acompanhamento de PRs"  |
| `/gslides` | Cria/lê/edita Google Slides    | "Monte uma apresentação com estes dados"      |
| `/gdrive`  | Navega e organiza Google Drive | "Liste os arquivos da pasta do projeto 01005" |

### 6.3 Engenharia

| Comando       | O que faz                                    | Exemplo                                            |
| ------------- | -------------------------------------------- | -------------------------------------------------- |
| `/cad`        | Visualiza arquivos 3D (STEP, STL, OBJ)       | "Abra o modelo STEP da carcaça e mostre dimensões" |
| `/cae`        | Análise de elementos finitos (CalculiX)      | "Monte uma análise modal desta peça"               |
| `/mechanical` | Processa arquivos mecânicos (DXF, STEP, DWG) | "Extraia as cotas deste DXF"                       |

### 6.4 Diagramas

| Comando    | O que faz                     | Exemplo                                   |
| ---------- | ----------------------------- | ----------------------------------------- |
| `/mermaid` | Diagramas com tema Strokmatic | "Crie um fluxograma do pipeline de dados" |

### 6.5 Como Criar Seus Próprios Skills

Crie uma pasta em `.claude/skills/<nome>/SKILL.md`:

```markdown
---
name: meu-skill
description: Faz algo útil quando invocado
---

Instruções detalhadas do que o Claude deve fazer
quando este skill for invocado.

Pode incluir:

- Templates de output
- Ferramentas que deve usar
- Passo a passo do workflow
```

Depois basta usar `/meu-skill` em qualquer sessão naquele projeto.

---

## 7. Roteiro de Demos ao Vivo

### Demo 1: Entendendo Código Desconhecido (2 min)

Abra o Claude Code num repositório e peça para explicar a arquitetura:

```bash
cd ~/projeto
claude
```

```
> Explique a arquitetura deste projeto. Quais são os principais
> serviços, como se comunicam, e qual o fluxo de dados?
```

O Claude lê a estrutura, dockerfiles, configs, e monta um mapa completo.

### Demo 2: Plan Mode — Analisar Antes de Agir (2 min)

Pressione `Shift+Tab` para Plan Mode:

```
[Plan Mode]
> Quero adicionar healthchecks Docker a todos os serviços.
> O que seria necessário?
```

O Claude analisa cada Dockerfile/docker-compose e apresenta um plano sem modificar nada.

### Demo 3: Debugging com Evidência (3 min)

```
> Este teste está falhando: npm test -- --testPathPattern=user.spec
> Debug isso.
```

O Claude roda o teste, lê o erro, formula hipóteses, testa cada uma, e aplica a correção.

### Demo 4: Gerar um Documento Word (2 min)

```
/docx
> Crie um relatório de status do projeto com:
> - Resumo executivo
> - Status dos serviços (tabela)
> - Próximos passos
> - Riscos identificados
> Salve como relatorio-status.docx
```

### Demo 5: Refatoração com Testes (3 min)

```
> Refatore o módulo de processamento de dados para usar async/await
> em vez de callbacks. Use TDD — escreva os testes primeiro.
```

O Claude segue o ciclo RED → GREEN → REFACTOR automaticamente.

### Demo 6: Criar PR via GitHub CLI (2 min)

Faça uma pequena mudança (ex: adicionar um comentário num arquivo) e peça:

```
> Commit esta mudança e crie um PR para develop com
> descrição das mudanças
```

O Claude faz `git add`, `git commit` (pede confirmação), `git push`, e `gh pr create` — tudo com descrição gerada automaticamente.

### Demo 7: Criar uma Planilha Google Sheets (2 min)

```
/gsheet
> Crie uma planilha "Inventário de Serviços" com colunas:
> Serviço, Stack, Porta, Status Healthcheck, Última Atualização
> Preencha com os dados dos serviços deste repositório
```

---

## 8. Dicas e Boas Práticas

### Escreva Bons Prompts

| Em vez de...          | Escreva...                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| "arruma o bug"        | "O endpoint /api/users retorna 500 quando o campo email é vazio. Corrija a validação."                                            |
| "melhora esse código" | "Refatore `processData()` para usar async/await e adicione tratamento de erro para conexões Redis."                               |
| "cria um teste"       | "Crie testes unitários para o serviço de autenticação cobrindo: login válido, senha errada, usuário inexistente, token expirado." |

**Regra geral:** Quanto mais contexto e critérios de sucesso, melhor o resultado.

### Quando Usar Cada Modo

| Situação                             | Modo                           |
| ------------------------------------ | ------------------------------ |
| Quero entender o código              | Plan Mode                      |
| Quero que implemente algo            | Act Mode                       |
| Tarefa complexa com múltiplos passos | Plan Mode primeiro, depois Act |
| Bug simples                          | Act Mode direto                |
| Refatoração grande                   | Plan → aprovar plano → Act     |

### Quando Usar Subagents

- Pesquisas em múltiplos repos/diretórios
- Tarefas independentes que podem rodar em paralelo
- Investigações exploratórias que podem gerar muito output

### `CLAUDE.md` é Seu Melhor Amigo

Invista tempo no `CLAUDE.md` do projeto. É o ROI mais alto que você pode ter:

- **Convenções** que o Claude deve seguir
- **Arquitetura** resumida (ele não precisa redescobrir toda vez)
- **Armadilhas** conhecidas ("nunca use porta 3000, já está em uso")
- **Comandos** úteis ("para rodar os testes: `make test LAYER=contracts`")

### Segurança

- O Claude Code **pede confirmação** antes de: git push, deletar arquivos, executar comandos destrutivos
- **Nunca** coloque credenciais no `CLAUDE.md` — use referências a arquivos `.env`
- Revise os diffs antes de aceitar edições em código de produção
- Use `--max-budget-usd` em automações para evitar gastos inesperados

### Integração com IDEs

O Claude Code funciona no terminal, mas também tem extensões oficiais:

| IDE                                         | Como instalar                                    |
| ------------------------------------------- | ------------------------------------------------ |
| **VS Code**                                 | Instalar extensão "Claude Code" pelo marketplace |
| **JetBrains** (PyCharm, IntelliJ, WebStorm) | Instalar plugin pelo marketplace da IDE          |

As extensões oferecem a mesma experiência do terminal, integrada ao editor. Você pode usar todos os mesmos comandos, tools e skills.

> Dica: mesmo sem extensão, o Claude Code no terminal já lê e edita arquivos no seu projeto. A extensão é conveniência, não requisito.

---

## Referências

- [Documentação oficial Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- [Superpowers Plugin](https://github.com/anthropics/claude-code-plugins)
