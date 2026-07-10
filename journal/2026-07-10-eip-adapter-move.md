---
type: Session Log
title: 2026-07-10 — eip — PR #5 merged, move adapter/ (opção B fase 3) e verdade sobre o Phase 0
description: PR #5 (EIP stack) mergeado no develop; descoberta de que Phase 0 + re-aplicação Bucket-A já estavam completos no master desde maio (README estava stale); move da árvore OpENer para adapter/ executado e validado (mv 100% puro, scanner test Classe 1 PASS incl. CT20-3), PR #6 aberto; follow-up issues #7 (PEL reclaim) e #8 criadas.
tags: [eip, ethernet-ip, strokmatic-eip, adapter, layout, opener]
timestamp: 2026-07-10
session: eip-adapter-move
project: "03007"
language: pt-BR
---

# 2026-07-10 — eip (merge da stack + move adapter/)

## Feito

- **PR #5 (EIP stack, issue #4) MERGED** no `develop` (criado a partir do master,
  que não tinha develop). Follow-up issues abertas: **#7** (PEL reclaim no
  startup — stop entregue-e-não-ackado fica órfão pós-crash) e **#8** (rollup:
  precisão do contrato, higiene do hash do poller, healthchecks no compose).
- **Correção de narrativa**: o audit `2026-05-07-phase0-eip-fork-audit.md` mostra
  que Phase 0 (inventário A/B/C, sem unknowns) **e** a re-aplicação layered dos
  Bucket-A já estão no master desde maio (LLDP objects → nvdata → network stack →
  build wiring → drop do sample_application sem Python embedding → redis_bridge →
  EDS). O README dizia "Phase 0 pending" — stale. R2 (myglobals.h) e R8 (Python
  embedding) fechados por não-existência no master.
- **Move `adapter/` (opção B fase 3) executado** em `feat/adapter-layout`
  (5 commits): mv 100% puro verificado (219 files, 0 edits) → path-fixes
  (.gitmodules, compose `build: ./adapter`, scripts, .gitignore) → README truth
  refresh → fixup Dockerfile (gitdir pointers do submodule quebravam no build
  context novo; rm build-stage-only) → fix de guidance git inválida
  (`git diff -Xsubtree` não existe; usar diff path-to-path + `git apply
  --directory=adapter`).
- **Validação completa**: build C OK; docker build OK; compose OK; tag-client
  26/26; submodule saudável; **scanner test Classe 1 PASS (exit 0) incl.
  CT20-3** com imagem buildada da árvore movida. **PR #6 aberto** → develop.

## Decisões

- `data/`, `fuzz/` e `TODO` foram junto para `adapter/` (artefatos do fork
  upstream — confirmado pelo reviewer).
- Merges de upstream OpENer daqui em diante: `git merge -Xsubtree=adapter`.

## Pendências

- ~~Merge do PR #6~~ — **MERGED 2026-07-10 17:14Z** após auto-review APPROVE
  WITH COMMENTS (4 pontos endereçados: scanner PASS já postado; .gitmodules
  section rename; nota no .travis.yml; comentário stale do IP corrigido em vez
  de issue — CT20-6 já tinha resolvido o hardcode).
- Gotchas ambientais a tocar depois: default image tag do `run_scanner_test.sh`
  aponta p/ imagem de maio (`strokmatic-eip:fixup`); `build/` untracked da raiz
  ficou órfão (stale caches — deletar); Docker cria dir root-owned quando
  bind-mount não existe (aconteceu com `adapter/build/`).
- Issues #7/#8; rotação da senha Redis do histórico; artefatos da cert original
  (report ODVA) com Matheus.

## Links

- PRs: strokmatic-eip#5 (merged) · #6 (aberto) · Issues: #7, #8
- Audit Phase 0: `docs/superpowers/audits/2026-05-07-phase0-eip-fork-audit.md`
- Journal anterior do bloco: [[2026-07-10-eip]]
