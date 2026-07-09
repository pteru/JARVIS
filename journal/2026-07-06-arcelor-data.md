---
type: Session Log
title: "2026-07-06 — arcelor-data — mapeamento vk01/vk02→DAS e início da cópia real"
description: Reconstrução da sessão arcelor-data perdida, remapeamento da topologia local (DAS em vk01) e execução validada do rsync detached vk01→DAS.
tags: [dados-producao, arcelor, "03002", backfill]
timestamp: 2026-07-06
session: arcelor-data
project: "03002"
product: VisionKing
language: pt-BR
---

# 2026-07-06 — arcelor-data

## Feito

- Localizada a sessão original `arcelor-data` (UUID `28f3d517-674c-4c2a-bb5a-34e2b5d6ac46`,
  2026-05-11→15): o `/rename` tinha funcionado, mas o transcript foi purgado
  pela limpeza automática de 30 dias do Claude Code.
- Reconstruído o estado da migração a partir dos artefatos sobreviventes em
  `workspaces/strokmatic/pmo/projects/03002/data-mapping/`: campanhas 02 e 03
  totalmente extraídas para `backup_unificado`; camp_01 parou no meio (vk02
  ok, vk01 com ~7k bar_uuids pendentes); camp_04/05 e as cópias raw de
  camp_06/07 nunca rodaram.
- Escrito `SESSION-RECORD-arcelor-data.md` documentando identidade da sessão,
  universo de dados, 7 decisões-chave e o incidente de "Human:" phantom
  message.
- Mapeada a nova topologia local: vk01 (192.168.15.82) e vk02
  (192.168.15.83) com dados internos, DAS agora conectado fisicamente a vk01
  (`/media/vk01/`).
- Inventário completo por bar_uuid e frame_uuid: vk01 live 51.981 + backup
  `img_saved_bak` 40.639 (quase disjuntos, união 92.619); vk02 live 217.177;
  DAS (snapshot maio) 84.732. Delta a copiar: 225.063 bar_uuids / ~4,4 TB.
- Verificação: os 84.733 bar_uuids compartilhados são frame-count-idênticos e
  md5-idênticos (amostra 100/100, 58.023 frames, zero mismatch) — só o
  artefato `empty` excluído.
- Setup do pipeline de cópia: chave SSH dedicada root@vk01→vk02, dry-run
  detached via `systemd-run` (75,05M arquivos / ~4,89 TB confirmados),
  benchmarks reais (vk01 local 161 MB/s / 2.874 files/s; vk02 via SSH 107
  MB/s / 866 files/s) e lançamento do `das-sync-vk01.service` real (ETA ~6h,
  resumível).
- Iniciada análise de distribuição de materiais (BCM/BCH ~96% do volume de
  imagens; CTN interessante para modelos futuros; PFI/PFU/BRM baixa
  prioridade) para embasar decisão futura de o que enviar ao GCP.

## Decisões

- Cópia roda detached em vk01 via `systemd-run` (não tmux/screen — não
  instalados e evitado instalar pacote global em produção); independe do PC
  orquestrador.
- Ordem de execução: vk01 primeiro, vk02 depois (evita contenção no HDD
  único do DAS).
- Cópia de vk01 é duas fontes (usuário vk01 para `img_saved`, root para
  `img_saved_bak`), destino único `arcelor-bcm/vk01/img_saved/` no DAS.
- Materiais BCM/BCH tratados como tier 1 (envio); CTN tier 2 (guardar, não
  enviar agora); resto tier 3 (baixa prioridade) — sem exclusão definitiva,
  apenas priorização de envio ao GCP.
- Checagem de integridade por md5 sample obrigatória antes de qualquer
  cópia real sobre dados já presentes no DAS.

## Pendências

- Cópia real de vk01 (~3,43 TB) em andamento no fechamento do digest; vk02
  ainda não iniciado.
- Análise pendente: distribuição de frames por bar (detectar anomalias) e
  plot de frames ao longo do tempo (detectar períodos anômalos) — pedido
  pelo usuário, não iniciado no digest disponível.
- Detecção de imagens "stale"/vazias (captura toda preta/escura) — ainda não
  endereçada.
- Decisão final de quais famílias de material (além de BCM/BCH) seguem para
  GCP — só priorização foi definida, não a lista final de envio.
- Garantir que a nova sessão de trabalho (aquela em que este digest foi
  extraído) não seja purgada como a original — o usuário pediu
  explicitamente para evitar repetição do incidente.

## Links

- `workspaces/strokmatic/pmo/projects/03002/data-mapping/SESSION-RECORD-arcelor-data.md`
- `workspaces/strokmatic/pmo/projects/03002/data-mapping/copy-plan/COPY-PLAN.md`
- `workspaces/strokmatic/pmo/projects/03002/data-mapping/copy-plan/vk01_TO_COPY.txt`
- `workspaces/strokmatic/pmo/projects/03002/data-mapping/copy-plan/vk02_TO_COPY.txt`
- `workspaces/strokmatic/pmo/projects/03002/data-mapping/das_vs_gcs_comparison.md`
