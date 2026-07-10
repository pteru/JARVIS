---
type: Session Log
title: 2026-07-10 — eip — CI no Cloud Build + artefatos 2026.07 para teste 03007
description: Esteiras de Cloud Build por componente (adapter e tag-client, triggers path-filtered) publicando no Artifact Registry strokmatic-images; submodule privado lldpd via deploy key no Secret Manager; imagens 2026.07 publicadas e briefing de teste enviado ao William (DM) para o contexto 03007.
tags: [eip, strokmatic-eip, cloudbuild, artifact-registry, ci, 03007]
timestamp: 2026-07-10
session: eip-cloudbuild
project: "03007"
language: pt-BR
---

# 2026-07-10 — eip (Cloud Build + artefatos de teste 03007)

## Feito

- **CI no Cloud Build (projeto strokmatic-sdk, southamerica-east1)** — um fluxo
  por componente (materializa "ciclos de vida opostos" da issue #4):
  `strokmatic-eip-tag-client-trigger` (dispara só em `tag-client/**`; gate de
  unit tests antes do build) e `strokmatic-eip-adapter-trigger` (só em
  `adapter/**`). Branch `^develop$`, SA `builder@`, convenção copiada do
  trigger do sdk-lib-rabbit-client. PR #10 com os `cloudbuild.yaml`.
- **Submodule privado resolvido**: Cloud Build não inicializa submodules — step
  de fetch clona `strokmatic-lldpd` pinado no gitlink SHA do superprojeto
  (`git ls-tree HEAD`), autenticado por deploy key read-only em Secret Manager
  (`strokmatic-lldpd-deploy-key`; accessor p/ builder@; chave privada local
  destruída após upload — Pedro registrou a pública no repo).
- **Ambas as esteiras validadas end-to-end** contra `feat/cloudbuild`:
  tag-client `d6766dc0` SUCCESS → `:30c2595`; adapter `498f05eb` SUCCESS →
  `:e060d8b`. **Imagens tagueadas `2026.07`** (CalVer, convenção
  sdk-autoscaler) no `strokmatic-images`.
- **Briefing enviado ao William** (DM `spaces/zthG20AAAAE`, verificada por
  membership antes do envio): pull commands, .env, tags.json (gotcha do
  bind-mount virar diretório), papel de cada componente no teste 03007.

## Decisões

- Path-filtered triggers em vez de esteira única do repo — rebuild do envelope
  certificável é evento raro e deliberado; mudança em compose/docs não builda.
- Tags por push: `:$SHORT_SHA` + `:latest`; CalVer `2026.07` aplicado manualmente
  para a rodada de bancada (release automation fica p/ depois).
- e2e cpppo + scanner Classe 1 continuam gates locais/bancada (precisam de
  caps/rede que o Cloud Build não dá).

## Gotchas

- Gen-1 GitHub triggers exigem "Connect repository" no console mesmo com o
  GitHub App em `repository_selection: all` (Pedro conectou).
- `E2_HIGHCPU_8` barrado por quota na região → máquina default, timeout 2400s.
- Classifier bloqueou (corretamente) deploy key e merge de PR próprio — ficam
  com o Pedro.

## Pendências

- **Merge do PR #10** (cloudbuild.yaml → develop) — Pedro. Até lá os triggers
  apontam p/ configs que só existem no branch.
- Follow-ups de CI: release tags automatizadas (trigger por git tag), gate e2e
  em VM própria se um dia precisar, quota p/ máquina maior.
- Aguardar retorno do William no teste da bancada 03007.

## Links

- PR: strokmatic-eip#10 · Builds: d6766dc0 (tag-client), 498f05eb (adapter)
- Registry: southamerica-east1-docker.pkg.dev/strokmatic-sdk/strokmatic-images
- Journals do dia: [[2026-07-10-eip]] · [[2026-07-10-eip-adapter-move]] · [[2026-07-10-eip-issues-7-8]]
