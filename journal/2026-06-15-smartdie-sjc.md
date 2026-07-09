---
type: Session Log
title: 2026-06-15 — smartdie-sjc — signal-viewer para DieMaster 01001 + diagnóstico DP10
description: Construção do signal-viewer (Vite+Express+Plotly) para os 18 painéis foco do teste GM SJC S10 e diagnóstico do artefato de médias v1→v2 no sensor DP10.
tags: [smartdie, "01001", diemaster, backfill]
timestamp: 2026-06-15
session: smartdie-sjc
language: pt-BR
project: "01001"
product: DieMaster
---

# 2026-06-15 — smartdie-sjc

## Feito

- Localizada a sessão histórica correta (`cd50fbf9-0aa5-42a0-99b6-e202cd74b943`,
  2026-03-31 → 2026-04-08) sobre o reprocessamento de sinais do teste GM SJC S10
  (01001), usada como base para retomar o trabalho.
- Confirmado acesso via mirror local do banco `smart-die` (container
  `database-server`, porta `localhost:2345`) como alternativa à VPN
  indisponível; credencial em `~/.secrets`/env do container. Ambos os
  endpoints (VPN original e mirror local) salvos na memória do projeto.
- Definido o conjunto foco de 18 painéis: 13 com timestamp real adquirido
  (4234–4258, pares) + 5 rotulados hz333 (4581, 4583, 4585, 4794, 4796).
- Construído o `signal-viewer` (workspaces/strokmatic/pmo/projects/01001/signal-viewer)
  espelhando a arquitetura do `sdk-inspection-grouping` (Vite + Express + TS),
  trocando Three.js por Plotly.js: API server em `:3901`, Vite dev em `:5174`,
  abas DRAWIN/GAP, seletor de sensor/painel/curva, overlay CL/LWL/LCL/UWL/UCL.
- Diagnosticado que os refinamentos v2 (`corrected_time_arrays_v2.json`,
  2026-04-07) nunca haviam sido gravados de volta no banco — o que estava
  em produção era ainda a versão v1 (2026-03-31).
- Criado `t_forming` — eixo de tempo secundário relativo ao instante de
  transição de forming — como referência default, sincronizando todas as
  curvas de todos os sensores/painéis em t=0.
- Investigado a fundo o sensor DP10: o que parecia stick-slip real acabou
  sendo identificado como artefato da própria transformação v1→v2 — a curva
  mestre `t(x)` (média das curvas red) sofre desaceleração de ~60x perto do
  platô de assíntota (x≈44.85mm), gerando plateau+re-rise espúrio quando
  outras curvas passam por essa região.
- Ranqueado todos os sensores por dispersão do instante de "stall" —
  DP10, DP08, DP11 formam o grupo de "abrupt-staller" (σ > 0.05s) que
  precisa de master trimado; os demais (DP01/02/03/05/06/09/12) têm
  dispersão baixa (σ < 0.03s).
- Confirmado que a estratégia v2 unificou blue e green num único ramo
  absolute-x→t (abandonando o tratamento diferenciado por grupo do
  Mar-31: blue com 9-section dt-scaling, green com dt×0.962 uniforme).

## Decisões

- Curvas **red são a referência mestre e não devem ser alteradas** —
  regra inegociável mantida em todas as reaplicações de v3.
- Aplicar o tratamento v3 (absolute-x→t + extrapolação por decaimento
  exponencial) apenas onde há truncamento real: DP02 e DP11 (já feito),
  e DP10 como terceiro candidato confirmado por inspeção visual ampliada
  (não só nos 18 painéis foco).
- Antes de re-gerar v2, corrigir a causa raiz identificada no DP10
  (assíntota por interrupção abrupta em instantes diferentes por curva)
  via trimming da curva mestre, em vez de aceitar o artefato como
  fenômeno físico.
- Seguir plano: regenerar v2 com o fix de trimming, reanalisar DP10 para
  v3, e decidir se o mesmo fix se estende a todos os sensores ou só ao
  grupo abrupt-staller (DP10/DP08/DP11).

## Pendências

- Regenerar `corrected_time_arrays_v2` com a correção de trimming da
  curva mestre (pendente no momento em que a extração da sessão foi
  cortada).
- Reaplicar v3 a DP10 após a regeneração e comparar contra o v2 corrigido.
- Decidir e aplicar (ou não) o fix de trimming aos sensores de baixa
  dispersão, hoje deixados como estão.
- Persistir de volta no banco (`smart-die`) qualquer novo v2/v3 gerado —
  lição da própria sessão foi que o v2 anterior nunca chegou a ser
  gravado.

## Links

- Sessão original explorada: `cd50fbf9-0aa5-42a0-99b6-e202cd74b943`
  (2026-03-31 → 2026-04-08).
- Ferramenta: `workspaces/strokmatic/pmo/projects/01001/signal-viewer/`
  (referência de arquitetura: `sdk-inspection-grouping`).
- Reprocessamento DieMaster: ver `project_diemaster_reprocessing.md` na
  memória (dumps/modelos em `pmo/01001/BACKUP_25_03/doc/`).
