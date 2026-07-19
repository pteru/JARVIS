---
type: journal
title: "sdk-line-twin — carroceria mesh real + posição ConveyorPosition_Filtered"
description: "Painel 3D passa a renderizar a mesh real do tracker (GLB decimado) e a carroceria segue a posição integrada no IRIS (R021), não o encoder cru GM."
tags: [sdk-line-twin-body-mesh, iris-scds, visionking]
timestamp: 2026-07-14T00:00:00Z
project: "03007"
product: VisionKing
language: pt-BR
status: done
---

# sdk-line-twin — carroceria mesh real + ConveyorPosition_Filtered

## Feito
- Branch `feat/body-mesh` (a partir de master; carroceria PLC-tracked já mergeada).
- **Correção 1 (mesh real)**: box da carroceria substituído pela malha real
  decimada do tracker (`tracker-lite.glb`, 8k faces). Nova rota gateway
  `GET /profile/asset/{name}` (FileResponse + guarda de nome). `scene.ts applyBody`
  carrega o GLB 1× (GLTFLoader), clona/tinge/escala por estilo, ancora o bico no
  X mundo da frente; box vira fallback. GLB tem rotação +90°X (Blender Y-up) —
  desfeita p/ a cena Z-up. Duas funções puras testadas (`bodyMeshScale`,
  `bodyMeshFrontAnchorXMm`).
- **Correção 2 (posição)**: `GM_LongPosition` → `ConveyorPosition_Filtered`
  (saída de R021_DynamicTracking) em bridge.json/binding.json; hil-map.json
  passa a sourcear de `hot/IF_Track.0.LongPos`. Notes corrigidas.
- **Achado crítico**: o parser de tags ignora DataValues decorados do L5X →
  `ScanTime_s` nascia 0.0, e o failsafe de R021 integrava zero (corpo congelado).
  Seedado `ScanTime_s: 0.05` no config do profile.json → integra 25 mm/scan,
  autônomo com GMSim. Verificado ao vivo.
- Testes: pytest 462 passed / 36 deselected / 1 xfailed; vitest 76; tsc + build limpos.

## Decisões
- TODOS os estilos usam a mesh do tracker (escalada por length + tingida por cor);
  estilos 1/2 continuam "ilustrativos" só em dimensão/cor. Carroceria sólida,
  ghosts LineCars intactos.
- `ScanTime_s=0.05` = período do relógio da sim (50 ms), não o 0.01 decorado do
  L5X — coerência física da velocidade visível.
- HIL: track 0 (conveyor principal) como fonte, com caveat p/ confirmar índice.

## Pendências
- Confirmar com Pedro o índice do IF_Track (0 vs 1) na bancada real.
- Validação visual (screenshot) fica com o orquestrador.
- Tabela real de estilos GM (dims/cores) ainda ilustrativa nos estilos 1/2.

## Links
- Report: `.superpowers/sdd/task-bodymesh-report.md`
- Asset: `profiles/iris-03007-v55/assets/tracker-lite.glb`
- R021: `profiles/iris-03007-v55/l5x/MainProgram_Program.L5X` (~linha 3915)
