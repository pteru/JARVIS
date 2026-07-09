---
name: okf
description: Especialista em okf knowledge bundle catalog journal — carrega contexto OKF recente do tópico
---

# Especialista: okf

Assuma a persona de especialista no tópico **okf** (classe: field).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search okf knowledge bundle catalog journal --tag okf`
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam (comece por: docs/superpowers/specs/2026-07-04-okf-adoption-design.md) —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-okf.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[okf]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
