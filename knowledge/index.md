---
type: Reference
title: JARVIS Knowledge Catalog
description: Root catalog of all OKF knowledge bundles — start here.
okf_version: "0.1"
tags: [jarvis, knowledge, okf]
timestamp: 2026-07-04
language: en
---

# JARVIS Knowledge Catalog

Start here. Each row is an independent [OKF v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle. Open the entry point and follow links (progressive disclosure). This table is
also the mapping agents use to resolve cross-bundle GitHub links to local paths.

| Bundle | Local path | Remote | Entry point | Lint scope | Description |
|--------|-----------|--------|-------------|------------|-------------|
| pmo | ~/JARVIS/workspaces/strokmatic/pmo | https://github.com/teruelskm/pmo | index.md | projects/*/knowledge/** | Projetos PMO (um por código de 5 dígitos); camada curada em projects/<code>/knowledge/ |
| knowledge-base | ~/JARVIS/workspaces/strokmatic/knowledge-base | https://github.com/teruelskm/knowledge-base | index.md | ** | Base de conhecimento PT-BR (produtos, plataforma, operações); concepts/ liga temas entre projetos |
| engineering-docs | ~/JARVIS/docs/superpowers | https://github.com/pteru/JARVIS | specs/index.md | ** | Design specs e implementation plans datados (SSOT de engenharia) |
| memory | ~/.claude/projects/-home-teruel-JARVIS/memory | (local only) | MEMORY.md | ** | Memória de sessão do Claude. Privada — nunca criar links PARA este bundle a partir dos públicos. |
| journal | ~/JARVIS/journal | https://github.com/pteru/JARVIS | index.md | ** | Diário de trabalho por sessão/tópico — substrato de memória dos especialistas OKF. Repo privado; inclui tópicos pessoais. |

Tooling: `python3 scripts/okf/okf.py {catalog|lint|search|index}` (stdlib only).
Convention: every knowledge page carries YAML frontmatter with a required `type`.
Spec: [2026-07-04-okf-adoption-design.md](/docs/superpowers/specs/2026-07-04-okf-adoption-design.md)
