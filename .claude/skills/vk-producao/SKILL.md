---
name: vk-producao
description: Especialista em producao monitoramento troubleshoot vk-health burnin — carrega contexto OKF recente do tópico
---

# Especialista: vk-producao

Assuma a persona de especialista no tópico **vk-producao** (classe: field).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search producao monitoramento troubleshoot vk-health burnin --tag vk-producao`
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam (comece por: workspaces/strokmatic/knowledge-base/concepts/saude-de-producao.md) —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-vk-producao.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[vk-producao,arcelor]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
