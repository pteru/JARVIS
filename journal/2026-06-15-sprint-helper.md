---
type: Session Log
title: "2026-06-15 — sprint-helper — descrições e campos preenchidos em 3 sprints ClickUp (SF/VK/DM)"
description: Detalhamento de descrições, roteamento de primary lists e preenchimento de assignee/datas/pontos em 34 tarefas das sprints de SpotFusion, VisionKing e DieMaster, a partir das atas de início de sprint.
tags: [pmo, sprints, backfill]
timestamp: 2026-06-15
session: sprint-helper
language: pt-BR
project: "02006"
product: SpotFusion
---

# 2026-06-15 — sprint-helper

## Feito

- **SF Sprint 34** (9 atividades `to-do` sem descrição): descrições redigidas
  a partir da ata + transcrição do gdoc de início de sprint, revisadas com o
  usuário e gravadas no ClickUp (verificação de conteúdo, não só HTTP 200).
  2 tarefas novas criadas para lacunas reais identificadas contra as
  "próximas etapas" da ata; outras lacunas absorvidas em tarefas existentes
  ou deixadas de fora por decisão do usuário.
- Corrigida uma duplicata (`868k12gb1` duplicava a pré-existente
  `868jwfkdb`, achada fora do escopo por ter status `pending` em vez de
  `to-do`) — apagada pelo usuário e confirmado o desaparecimento (404) da
  sprint.
- Roteamento de *primary list* corrigido para as 11 tarefas da SF Sprint 34
  (home nas listas regulares `[02] Modelos/Software/Laboratório` e
  `[02006] Hyundai-Floor`, sprint como localização secundária via campo
  `locations`).
- Mesmo fluxo replicado para **VK Sprint 34** (17 tarefas, projetos
  iris-scds/03007 e stellantis/03010) e **DieMaster SD Sprint 38** (6
  tarefas, ds→[01] Modelos, geral→[01001] SJC), com ajustes pontuais do
  usuário (nomenclatura de calhas, SEALER-01/03, atribuição de CAD 4DR ao
  Weslley, etc.).
- Varredura final confirmou as 3 sprints corretas: 34 tarefas no total, 0
  violações de primary=sprint, todas com descrição e localização secundária
  íntegra.
- Auditoria e preenchimento de campos em massa nas 34 tarefas: assignee já
  100%; start date e due date preenchidos (15/06–28/06/2026); sprint points
  preenchidos (todos =1); priority mantida em branco por decisão do usuário
  (18 tarefas).
- 5 carry-overs com due date anterior ao início da sprint (12/06 e 04/06)
  tratados conforme recomendação do assistente, seguida pelo usuário.

## Decisões

- Auditoria de lacunas deve varrer **todos os status**, não só `to-do`/
  `backlog` — a duplicata só apareceu porque a tarefa pré-existente estava em
  `pending`.
- Campo `locations` é a fonte de verdade para localização secundária; o
  endpoint `/list/task` não lista membros secundários (alarme inicial de
  "faltando na sprint" era falso negativo).
- Tarefas da Hyundai roteadas para a lista `[02006]`.
- Espelhamento Iris→Stellantis fica com Pedro, sem task dedicada.
- Para os 5 carry-overs com due defasado, seguir a recomendação do
  assistente em vez de forçar `start=15/06` (ClickUp recusa start após due).

## Pendências

- Nenhuma pendência aberta ao final da sessão — as 3 sprints (34 tarefas)
  foram verificadas como corretas em descrição, roteamento e campos
  obrigatórios (exceto priority, deixada em branco por decisão).

## Links

- SF Sprint 34: `https://app.clickup.com/3081126/v/l/li/901113875404`
- VK Sprint 34: `https://app.clickup.com/3081126/v/l/li/901113875391`
- DieMaster SD Sprint 38: `https://app.clickup.com/3081126/v/l/li/901113875400`
