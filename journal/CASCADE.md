---
type: Reference
title: Cascade — marcas d'água journal → bundles
description: Estado da consolidação por tópico — última entrada absorvida e alvos de cada especialista. Ferramenta scripts/okf/cascade.py; spec 2026-07-10-okf-cascade-design.md.
tags: [okf, journal, cascade]
timestamp: 2026-07-10
language: pt-BR
---

# Cascade — marcas d'água

Entrada "não-absorvida" = nome do arquivo ordena depois da marca d'água
(match por TAG). `—` em Alvos = tópico sem destino de cascade (pulado).
Nunca editar entradas do journal; o estado vive só aqui.

| Tópico | Alvos (páginas) | Última absorvida | Último run | Notas |
|--------|-----------------|------------------|------------|-------|
| sealer | workspaces/strokmatic/pmo/projects/03008/knowledge/index.md | 2026-07-08-sealer.md | 2026-07-10 | — |
| iris-scds | workspaces/strokmatic/pmo/projects/03007/knowledge/index.md | 2026-07-16-iris-plc-rewire.md | 2026-07-18 | — |
| stellantis | workspaces/strokmatic/pmo/projects/03010/knowledge/index.md | 2026-07-08-stellantis.md | 2026-07-10 | — |
| arcelor | workspaces/strokmatic/pmo/projects/03002/knowledge/index.md | 2026-07-08-arcelor-vpn.md | 2026-07-10 | — |
| nissan-smyrna | workspaces/strokmatic/pmo/projects/02008/knowledge/index.md | — | — | — |
| sparktest | — | — | — | camada 03011 ainda não existe |
| mercedes-vk | — | — | — | camada 03904 ainda não existe |
| smartdie | — | — | — | camada 01001 ainda não existe |
| magna | — | — | — | prospecção; journal-only por ora |
| eip | — | — | — | docs vivem no workspace strokmatic-eip |
| automacao | workspaces/strokmatic/knowledge-base/concepts/integracao-plc.md | 2026-07-16-iris-plc-rewire.md | 2026-07-18 | — |
| vk-producao | workspaces/strokmatic/knowledge-base/concepts/saude-de-producao.md | 2026-07-08-arcelor-vpn.md | 2026-07-10 | — |
| dados-producao | — | — | — | candidato: concept novo de dados de produção |
| blender | — | — | — | candidato: página KB da ferramenta |
| gm | — | — | — | candidato: página KB normas GM |
| pmo | workspaces/strokmatic/knowledge-base/pmo/processos/organizacao-local-drive.md | 2026-07-08-okf.md | 2026-07-10 | — |
| okf | — | — | — | specs datados são históricos — não recebem cascade |
| jarvis | — | — | — | engineering-docs datados — não recebem cascade |
| administrativo | — | — | — | journal-only por ora |
| propriedade-intelectual | — | — | — | journal-only por ora |
| pessoal | — | — | — | NUNCA cascateia (design) |
| iris-plc-rewire | — | — | — | conteúdo já cascateia via iris-scds (→03007) e automacao (→concept); só retrieval |
