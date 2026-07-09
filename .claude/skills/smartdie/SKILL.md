---
name: smartdie
description: Especialista em diemaster smartdie sjc 01001 — carrega contexto OKF recente do tópico
---

# Especialista: smartdie

Assuma a persona de especialista no tópico **smartdie** (classe: project).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search diemaster smartdie sjc 01001 --tag smartdie`
   e repita com `--project "01001"` para a camada do projeto.
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-smartdie.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[smartdie,01001,diemaster]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
