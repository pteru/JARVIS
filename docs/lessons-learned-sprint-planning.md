# Guia: Sprint Planning com Claude Code + ClickUp + Google Docs

> Lições aprendidas da sessão de sprint planning de 2026-04-06, cobrindo SpotFusion, VisionKing e DieMaster.

## Visão Geral do Fluxo

```
1. Carregar contexto do produto (skill)
2. Ler anotações da reunião (Google Docs via MCP)
3. Buscar tarefas existentes na sprint (ClickUp via MCP)
4. Cruzar anotações x tarefas existentes → identificar gaps
5. Propor tarefas novas ao usuário
6. Criar tarefas aprovadas no ClickUp
7. Adicionar à sprint como localização secundária
8. Atribuir responsáveis
```

## Fase 1 — Preparação

### Carregar o ClickUp Navigator primeiro

O navigator (`/clickup-navigator`) contém os IDs de todos os folders, listas e sprints. Sem ele, não é possível operar no ClickUp.

**IDs críticos:**

| Recurso | ID |
|---|---|
| [01] SMART DIE (sprints) | `90115085362` |
| [01] SMART DIE HARD (sprints) | `90115287009` |
| [02] SPOT FUSION (sprints) | `90115784429` |
| [03] VISION KING (sprints) | `90115784442` |
| [01] SMART DIE (regular) | `7213380` |
| [02] SPOT FUSION (regular) | `7213400` |
| [03] VISION KING (regular) | `90071039181` |

### Carregar a skill do produto

Usar `/spotfusion`, `/visionking` ou `/diemaster` para carregar o contexto técnico. Isso permite entender o vocabulário da reunião (nomes de serviços, sensores, projetos) e classificar tarefas corretamente.

## Fase 2 — Leitura do Estado Atual da Sprint

### Onde buscar tarefas existentes

As tarefas da sprint podem estar em **dois lugares**:

1. **No folder da sprint** (localização primária = sprint) — buscar via `filter_tasks(folder_ids=[sprint_folder_id])`
2. **Nas listas regulares com tag `sprint`** (localização primária = lista regular, sprint como secundária) — buscar via `filter_tasks(folder_ids=[regular_folder_id], tags=["sprint"])`

**IMPORTANTE:** Buscar apenas no folder da sprint é insuficiente. A maioria das tarefas fica nas listas regulares com tag `sprint`. Sempre buscar nos dois lugares.

### Exemplo de busca completa

```
# Buscar no folder da sprint
filter_tasks(folder_ids=["90115784442"], statuses=[...])

# Buscar nas listas regulares com tag sprint
filter_tasks(folder_ids=["90071039181"], tags=["sprint"], statuses=[...])
```

### Erro cometido nesta sessão

Na primeira tentativa com SpotFusion, buscamos todas as tarefas do folder regular (sem filtro de tag), retornando 100+ tarefas — ruído desnecessário. A busca com `tags=["sprint"]` retorna apenas as relevantes.

## Fase 3 — Leitura das Anotações da Reunião

### Google Docs via MCP

Usar `read_doc(doc_id)` com o ID extraído da URL. Aceita a URL completa também.

**Estrutura típica das anotações (geradas pelo Gemini):**
- `### Resumo` — visão geral dos temas
- `### Detalhes` — transcrição organizada por tópico
- `### Próximas etapas sugeridas` — action items com responsáveis

**Atenção:** As anotações do Gemini podem conter erros de transcrição (nomes de pessoas, termos técnicos, nomes de projetos). Sempre confirmar com o usuário antes de criar tarefas baseadas em termos que pareçam estranhos.

### Erros de transcrição encontrados nesta sessão

| O Gemini transcreveu | O correto era |
|---|---|
| Siler | Sealer |
| Yama | Neoyama |
| Estelantes | Stellantis |
| "bet" / "resider" | batch / resizer (termos técnicos de containers) |

**Regra:** Sempre apresentar a lista de tarefas propostas ao usuário para revisão antes de criar. Nunca criar automaticamente.

## Fase 4 — Cruzamento e Proposta

### Estrutura da análise

Apresentar em duas tabelas:

1. **Itens já cobertos** — mapear cada action item da reunião para a tarefa existente no ClickUp
2. **Itens sem tarefa** — propor nome, lista, assignee para cada

### Classificação de tarefas por prefixo

| Prefixo | Lista destino |
|---|---|
| `sw:`, `front:`, `back:`, `fw:` | [XX] Software |
| `hw:`, `sensor:` | [XX] Projeto Eletrônico / Hardware |
| `ds:`, `model:` | [XX] Modelos |
| `lab:` | [XX] Laboratório |
| `doc:` | [XX] Documentação |
| `projeto-específico:` (sjc, arcelor, sealer, etc.) | Lista do projeto ([01001], [03002], [03008], etc.) |

### O que NÃO vira tarefa

- Atribuições de papel ("Will como ponto focal PLC")
- Follow-ups administrativos rápidos ("compartilhar link", "agendar conversa")
- Itens sem detalhamento suficiente

### Erros de classificação nesta sessão

- Tarefas do **Sealer** foram inicialmente associadas à lista IRIS SCDS (`[03007]`), quando deveriam ir para **Hyundai Sealer** (`[03008]`). O Sealer é o projeto 03008, não o 03007.
- Sempre confirmar com o usuário quando um projeto tem nome ambíguo ou múltiplas listas possíveis.

## Fase 5 — Criação de Tarefas

### Assignees — usar IDs numéricos, NÃO nomes

**Bug crítico encontrado:** O `clickup_create_task` aceita `assignees` como array de strings, mas nomes completos (ex: `"Eduardo Gabriel do Valle"`) **não são resolvidos automaticamente**. As tarefas são criadas com assignees vazios sem erro.

**Solução:** Sempre usar IDs numéricos diretamente.

**Tabela de IDs (equipe Strokmatic em 2026-04-06):**

| Nome | ID |
|---|---|
| Pedro Teruel | `3148447` |
| Arthur Henrique Mallman | `55072352` |
| Eduardo Gabriel do Valle | `81390364` |
| Rodrigo Carvalho | `81390374` |
| Vinicius Gabriel Sotero | `60982611` |
| Vanessa Vieira de Sousa | `81509024` |
| Weslley Poleto | `81507234` |
| William Chiou Abe | `54925168` |
| Guilherme Teixeira Santos | `87301649` |
| Jonas de Melo | `87308991` |
| Vinicius Figueredo | `87344642` |
| Patrick Pacheco | `49048885` |

### Fornecedores externos

Pessoas externas (ex: Paulo) **não são membros do workspace** e não devem ser adicionadas como assignees. Criar a tarefa sem assignee e mencionar o fornecedor na descrição.

### Campos padrão para tarefas de sprint

```
tags: ["sprint"]
due_date: último dia da sprint (ex: "2026-04-19")
description: seguir template em config/orchestrator/clickup-task-template.md
priority: conforme criticidade (urgent/high/normal/low)
```

### Template de descrição

**Obrigatório:** Seguir o template em `config/orchestrator/clickup-task-template.md`. Sempre em PT-BR.

Seções obrigatórias:
- **Contexto** — de onde surgiu, projeto, referência à reunião
- **Objetivo** — estado final desejado (não o processo)
- **Critérios de aceite** — checkboxes verificáveis (`- [ ]`)

Seções opcionais:
- **Abordagem sugerida** — apenas se discutido na reunião
- **Dependências** — links para tarefas/issues relacionadas
- **Observações** — riscos, decisões em aberto

Prefixos do nome da tarefa (`sw:`, `fw:`, `ds:`, `front:`, `doc:`, etc.) determinam a lista de destino. Ver tabela completa no template.

## Fase 6 — Vincular à Sprint

### Localização secundária (padrão correto)

Após criar a tarefa na lista regular, adicionar à sprint como localização secundária:

```
add_task_to_list(task_id, sprint_list_id)
```

**IDs das listas de sprint (abril 2026):**

| Sprint | List ID |
|---|---|
| SD Sprint 33 (6/4 - 19/4) | `901113431727` |
| SF Sprint 29 (6/4 - 19/4) | `901113431731` |
| VK Sprint 29 (6/4 - 19/4) | `901113431716` |

### Atribuir assignees DEPOIS de criar

Como os nomes não são resolvidos automaticamente no `create_task`, **sempre usar `update_task`** com IDs numéricos logo após a criação:

```
update_task(task_id, assignees=["81390364", "3148447"])
```

**Ou** já criar com IDs numéricos desde o início (preferível — evita segunda chamada).

## Fase 7 — Dependências

Usar `add_task_dependency(task_id, depends_on, type="waiting_on")` para tarefas que só podem iniciar após outra.

Exemplo desta sessão:
- "Definir formato do carrinho da câmera" depende de "Definição do eixo com fornecedor"
- "Entregar placas ao Paulo" depende de "Paulo resolver problema de reset"

## Checklist Final

- [ ] Todas as tarefas criadas com tag `sprint`
- [ ] Todas vinculadas à sprint como localização secundária
- [ ] Todos os assignees verificados (não vazio)
- [ ] Dependências criadas onde necessário
- [ ] Nenhuma duplicata com tarefas existentes
- [ ] Nomes de projetos/pessoas confirmados com o usuário
- [ ] Fornecedores externos sem assignee no ClickUp

## Estatísticas desta Sessão (2026-04-06)

| Produto | Tarefas criadas | Sprint |
|---|---|---|
| SpotFusion | 2 | SF Sprint 29 |
| VisionKing | 10 | VK Sprint 29 |
| DieMaster | 7 | SD Sprint 33 |
| **Total** | **19** | |
