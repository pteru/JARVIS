---
name: okf-cascade
description: Consolida conhecimento do journal nos bundles temáticos (camadas de projeto, concepts da KB) — loop gated por tópico
---

# /okf-cascade [tópico]

Consolidação journal → bundles (spec `2026-07-10-okf-cascade-design.md`).
O dono é o gate: NUNCA commitar páginas-alvo sem aprovação explícita dele.

## Sem argumento

Rode `python3 ~/JARVIS/scripts/okf/cascade.py status` e apresente o backlog;
o dono escolhe o tópico.

## Com tópico

1. `python3 ~/JARVIS/scripts/okf/cascade.py briefing <tópico>` — alvos +
   entradas não-absorvidas (mais antiga primeiro).
2. Leia as páginas-alvo atuais. Proponha os edits consolidados:
   - Decisões/arquitetura/topologia/gotchas → páginas-alvo.
   - Pendências, status e conteúdo `pessoal`: NUNCA cascateiam.
   - Proveniência em texto simples: `(Fonte: sessão <nome>, YYYY-MM-DD)` —
     PROIBIDO hyperlink para `journal/` a partir de pmo/KB/engineering-docs.
3. Mostre o diff ao dono e AGUARDE aprovação.
4. Aprovado → aplique e committe NO REPO ALVO pelas convenções dele
   (PMO: rebase antes de push + atualizar "Histórico de Mudanças" do
   overview.md; KB: `okf.py index` no diretório tocado; pathspec escopado,
   nunca `git add -A`).
5. `python3 ~/JARVIS/scripts/okf/cascade.py mark <tópico> <entrada-mais-nova>
   --date <hoje>` e committe `journal/CASCADE.md` no JARVIS.
6. Verifique: `okf.py lint <bundle-alvo> --strict` limpo; nenhum link para
   `journal/` nas páginas alteradas.
