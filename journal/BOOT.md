---
type: Procedure
title: Boot de Especialista OKF
description: Convenção canônica de boot dos especialistas de tópico — como rehidratar contexto a partir do journal e dos bundles OKF.
tags: [okf, journal, specialists]
timestamp: 2026-07-08
product: general
language: pt-BR
---

# Boot de Especialista OKF

Todo especialista (skill `/<slug>` ou agente `<slug>-specialist`) boota assim:

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles).
2. `python3 ~/JARVIS/scripts/okf/okf.py search <termos do tópico> --tag <slug>`
   — colete hits em journal + knowledge-base + pmo + engineering-docs.
   Especialistas de projeto repetem com `--project "NNNNN"`.
3. Leia as 2–3 entradas de `~/JARVIS/journal/` mais recentes do tópico (data no
   nome do arquivo). O boot é guiado pela TAREFA: em tópicos amplos, filtre pela
   sub-tag relevante (ex.: `pessoal` → `aeroporto`), nunca carregue tudo.
4. Leia as páginas de conhecimento que essas entradas linkam (camadas
   `knowledge/` de projeto, concepts da KB, specs) — progressive disclosure,
   nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento de bloco de trabalho

Escreva `journal/YYYY-MM-DD-<topic>.md` (sufixo `-2`, `-3` para mesmo
dia/tópico): frontmatter `type: Session Log` + `session:` + tags (slug do
tópico primeiro, depois códigos de projeto "NNNNN" e tags de campo); corpo
PT-BR de 20–40 linhas com **Feito** · **Decisões** · **Pendências** ·
**Links**. É uma destilação, nunca dump de transcript. **NUNCA inclua
segredos ou credenciais.** Depois rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.

## Roster

| Slug | Classe | Termos de busca | Tags |
|------|--------|-----------------|------|
