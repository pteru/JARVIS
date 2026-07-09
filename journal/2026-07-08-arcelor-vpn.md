---
type: Session Log
title: "2026-07-08 — arcelor-vpn — correção do inference OBB e detecção do vk02 caído"
description: VPN Checkpoint restabelecida, migração do inference vk01 para modelo detection com remapeamento de classes, e descoberta de que o vk02 está fora do ar.
tags: [vk-producao, arcelor, "03002", backfill]
timestamp: 2026-07-08
session: arcelor-vpn
project: "03002"
product: VisionKing
language: pt-BR
---

# 2026-07-08 — arcelor-vpn

## Feito

- Corrigido o acesso VPN Checkpoint (cshell não reconhecido pelo navegador);
  acesso a vk01/vk02/vk03 confirmado em seguida.
- Investigado o diagnóstico do William: após troca do modelo de inferência
  para o novo OBB (9 classes), `rules.json` (jul/2025) e as env vars
  `DEFECT_CLASSES`/`DEFECT_CLASS_MAPPING` ainda usavam nomenclatura antiga —
  as 3 regras antigas estavam "mortas" e a tabela `defeitos` parou de
  receber linhas desde 24/abr/2026 (bug de formato `position`: polígono OBB
  quebra a função Postgres, que espera bbox plano).
- Localizado em `192.168.15.190` um modelo `detect` (não-OBB) com as mesmas
  9 classes e formato bbox compatível com a função do banco — resolve o bug
  de `position` sem esperar novo treino.
- Escrito plano de correção em 6 fases com gate de confirmação
  (`docs/superpowers/plans/2026-05-15-vk01-inference-detection-classmap.md`)
  e executadas as fases 0–4:
  - Fase 0: backups (compose, rules.json, `classe_defeitos`).
  - Fase 1: cadastradas `farpa` (id 9) e `mancha` (id 10) em `classe_defeitos`.
  - Fase 2: modelo detection copiado `.190` → vk01 (md5 verificado).
  - Fase 3: `rules.json` reescrito (2 regras) e recarregado a quente.
  - Fase 4: compose editado (`MODEL_TYPE=detection`, `MODEL_PATH`,
    `DEFECT_CLASSES`, `DEFECT_CLASS_MAPPING`) e `visionking-inference`
    recriado; build do engine TensorRT acompanhado via logs.
- Mapeadas as 3 camadas do pipeline (nome cru do modelo → `rules.json` →
  `DEFECT_CLASSES`/`DEFECT_CLASS_MAPPING` → `classe_defeitos`) e confirmado
  que `risco_analise`/`risco_aprova` permanecem como código em todas as
  camadas — só o `defect_class_name` já exibe "Risco"/"Risco Leve".
- Identificada causa raiz de por que a regra de split `po_flux→carepa`
  (corridas F–M) nunca disparava: `corrida_tracking` chega como **string**
  JSON na camada de inferência (só vira dict depois, no result-writer); o
  `rule_engine._get_value_by_path` não desce em string, então a condição
  falha sempre.
- Medida a distribuição de classes gravadas: `risco_aprova` (Risco Leve)
  dominava com 70,8% do volume; aplicado filtro para descartá-la (mesmo
  tratamento de `reflexo`) — após o recreate, `risco_aprova` some da tabela
  e `risco_analise` passa a ~89%.
- Ativado o `vk-health` (`enabled: true`), destravando o cron `*/15min`;
  primeiro ciclo completo rodou com sucesso (severidade WARNING, alerta
  conhecido de Grafana ausente no vk02).
- Detectado que o **vk02 está fora do ar** — confirmado por três ângulos
  independentes (host JARVIS, vk01 via LAN interna, cron do vk-health):
  ping e SSH falham mesmo a partir do vk01 na mesma rede interna, ou seja,
  não é problema de VPN — o host caiu ou desconectou da rede desde ~20:42.
  Efeito colateral novo: vk03 em tempestade de reconexão Redis
  (`EHOSTUNREACH` a cada ~3s, sem backoff) apontado para o Redis morto do
  vk02.

## Decisões

- Adotar o modelo `detect` da `.190` (bbox plano) em produção no vk01 em vez
  de esperar retreino OBB — resolve o bug de gravação de imediato.
- Manter `risco_analise`/`risco_aprova` como código técnico em todas as
  camadas; renomear só é cosmético via `defect_class_name`, sem tocar em
  `rules.json`/`DEFECT_CLASS_MAPPING`.
- Descartar `risco_aprova` na gravação (mesmo padrão do `reflexo`) por
  volume desproporcional (70%+) com baixo valor (status "aprova", não
  reprova peça).
- Novas classes `farpa`/`mancha` cadastradas com `status=aprova`
  (conservador — não reprovam peça automaticamente).

## Pendências

- Corrigir o bug de tipo `corrida_tracking` (string vs dict) na camada de
  inferência para destravar o split `po_flux→carepa` por corrida (F–M).
- vk02 precisa de recuperação física/remota — down desde ~20:42, sem
  auto-recuperação.
- Tratar a tempestade de reconexão Redis do vk03 apontada para o vk02
  morto (sem backoff).
- Investigar imagens escuras no CT — verificar se iluminadores estão
  operando e se há sujeira na lente (adiado a pedido do usuário).
- Monitorar disco vk01 (root 84,7%, `img_saved` 52% subindo ~1%/dia) —
  agravado com vk01 como nó único enquanto vk02 estiver fora.
- Verificação manual direta do vk01 (solicitada ao final da sessão) ainda
  não concluída no digest disponível.

## Links

- `docs/superpowers/plans/2026-05-15-vk01-inference-detection-classmap.md`
- `reports/vk-health/03002/latest.md`
