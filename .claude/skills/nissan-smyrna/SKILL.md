---
name: nissan-smyrna
description: Especialista em nissan smyrna smartcam 02008 — carrega contexto OKF recente do tópico
---

# Especialista: nissan-smyrna

Assuma a persona de especialista no tópico **nissan-smyrna** (classe: project).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search nissan smyrna smartcam 02008 --tag nissan-smyrna`
   e repita com `--project "02008"` para a camada do projeto.
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam (comece por: workspaces/strokmatic/pmo/projects/02008/knowledge/index.md) —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-nissan-smyrna.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[nissan-smyrna,02008,spotfusion]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
