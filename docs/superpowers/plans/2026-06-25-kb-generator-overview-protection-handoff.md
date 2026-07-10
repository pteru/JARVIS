---
type: Implementation Plan
title: Handoff — Proteger overviews curados do kb-generator
description: O serviço **kb-generator** edita automaticamente `overview.md`/`status.md`/`sprint.md` de cada projeto PMO (via LLM, diariamente) e **sobrescreveu conteúdo curado manualmente**. Precisamos: **(1) p...
timestamp: 2026-06-25
---

# Handoff — Proteger overviews curados do kb-generator

**Criado:** 2026-06-25 · **Por:** sessão de organização PMO (03010/03007)
**Para:** rodar em sessão futura · **Status:** investigação pausada a pedido; este doc é o ponto de partida

---

## Objetivo

O serviço **kb-generator** edita automaticamente `overview.md`/`status.md`/`sprint.md` de cada projeto PMO (via LLM, diariamente) e **sobrescreveu conteúdo curado manualmente**. Precisamos: **(1) pausar** o serviço, **(2) entender** por que ele dropou o conteúdo curado, **(3) implementar uma proteção** para projetos com curadoria manual (ex.: 03010, 03007).

## Contexto — o incidente (2026-06-25)

Durante o push da organização do PMO, o `git pull --rebase` deu **conflito em `projects/03010/reports/md/overview.md`**: o kb-generator havia regenerado a seção **"Custo Total"**, substituindo a tabela curada por prosa automática ("**RESTRIÇÃO FINANCEIRA ativa…**"). Foi resolvido com `--theirs` (mantida a versão curada com o cronograma alinhado ao Kick-off). A versão curada está em `origin/master` (commit **b5bbab68**).

⚠️ **Risco:** a próxima execução do kb-generator pode sobrescrever de novo as edições manuais de `overview.md` (cronograma KO, decisões de projeto, etc.).

---

## Estado atual (o que já foi descoberto)

### Onde roda / como pausar
- **NÃO roda nesta máquina.** Roda no **servidor de deploy `strokmatic@192.168.15.2`**, em `/opt/jarvis-kb-generator/`.
- Agendado no **crontab do usuário `strokmatic` no servidor remoto** (instalado por `deploy.sh`):
  ```
  30 23 * * * . /home/strokmatic/.nvm/nvm.sh && cd /opt/jarvis-kb-generator && bash run.sh >> /opt/jarvis-kb-generator/logs/cron.log 2>&1 # kb-generator
  ```
  → **diário às 23:30 UTC**. Por isso não aparece no `crontab -l` local.
- Opera sobre o **próprio clone** `/opt/jarvis-kb-generator/data/pmo-clone`, commita como **`JARVIS kb-generator <jarvis-kb-generator@strokmatic.internal>`** e dá **push em `origin/master`** do `teruelskm/pmo`.
- Os outros serviços-irmãos (`gdrive-index`, `email-index`, `meeting-index`) têm o **mesmo padrão de deploy remoto** (provável mesmo servidor) — ver `infra/services/*/deploy.sh`.

### Mecanismos de skip já existentes (no código)
- `index.mjs:20` → `const SKIP_PUSH = process.env.HM_SKIP_PUSH === '1'` — **`HM_SKIP_PUSH=1` pula só o push** (ainda commita no clone). **NÃO é pausa total.**
- `run.sh` → usa `flock` (uma instância por vez).
- `lib/report-generator.mjs:91` → comentário "*This prevents the LLM from accidentally dropping manually-added content*" — **há lógica de proteção a revisar** (por que falhou no Custo Total?).
- `lib/revision-tracker.mjs` + tabela **"Histórico de revisões"** → o serviço distingue fontes **`(manual)` vs `(auto)`**. Pista: talvez dê para marcar seções/arquivos como manuais.
- `prompts/edit-overview-status-sprint.md:22` → instrui o LLM a "**Preserve TODO o conteúdo existente que não foi afetado**" — mas houve drift do LLM.

### Estrutura do serviço
`infra/services/kb-generator/`
- `index.mjs` (entrypoint, 8 KB) · `run.sh` (wrapper flock+log) · `deploy.sh` (rsync + instala cron remoto)
- `lib/`: `activity-detector.mjs`, `revision-tracker.mjs`, `context-assembler.mjs`, `report-generator.mjs`, `config.mjs`
- `prompts/`: `edit-overview-status-sprint.md`, `bootstrap.md`, `compress-context.md`
- `config/service.json`: repo `teruelskm/pmo` (master), clone `/opt/jarvis-kb-generator/data/pmo-clone`, `output_path_template: projects/{code}/reports/md`, `project_codes_path: config/project-codes.json`
- Spec/plano originais: `docs/superpowers/specs/2026-04-16-kb-generator-design.md` + `docs/superpowers/plans/2026-04-16-kb-generator.md`

---

## Tarefas

### 1. PAUSAR (fazer primeiro)
SSH no servidor de deploy e remover/comentar a linha de cron do kb-generator:
```bash
# senha do strokmatic@192.168.15.2: ver ~/.secrets/vk-ssh-password (mesma dos
# nós VK) — CONFIRMAR. deploy.sh espera a env SSHPASS.
export SSHPASS="$(cat ~/.secrets/vk-ssh-password)"
sshpass -e ssh -o StrictHostKeyChecking=no strokmatic@192.168.15.2 \
  "crontab -l | sed 's@^\(.*# kb-generator\)@# PAUSED 2026-06-25 \1@' | crontab - && crontab -l | grep kb-generator"
```
- Verifique também `gdrive-index`/`email-index`/`meeting-index` no mesmo crontab — decidir se pausa só o kb-generator ou todos (o gdrive-index é o que gera o `drive-index.*`, já tratado via `.gitignore`).
- **Alternativa menos invasiva** (se quiser manter rodando mas sem tocar overview): investigar se há flag p/ pular `overview.md` (provável que não exista ainda → vira a Tarefa 3).
- Registrar a pausa (data/motivo) p/ não esquecer de reativar.

### 2. INVESTIGAR
Ler, nesta ordem:
1. `lib/report-generator.mjs` (em especial a lógica perto da linha 91 — "prevents the LLM from dropping manually-added content"). Por que não preservou o Custo Total?
2. `lib/revision-tracker.mjs` + `prompts/edit-overview-status-sprint.md` — como decide o que editar e como (não) preservar.
3. `index.mjs` — fluxo: detecta atividade → monta contexto → edita os 3 arquivos → commita/pusha. Ver `lib/activity-detector.mjs` (o que dispara a edição de um projeto).
4. Reproduzir local com `HM_SKIP_PUSH=1` (e idealmente apontando p/ um clone descartável) para observar o diff que ele produziria em `03010/overview.md` **sem** pushar.

### 3. PROJETAR A PROTEÇÃO (decidir + implementar)
Opções (escolher após ler o código):
- **(a) Opt-out por projeto:** lista de códigos "curados manualmente" em `config/service.json` (ex.: `"manual_projects": ["03010","03007"]`) → kb-generator pula a edição desses overviews.
- **(b) Flag no próprio doc:** front-matter/marcador em `overview.md` (ex.: `<!-- kb-generator: manual -->`) que o serviço respeita.
- **(c) Marcação de seção:** blocos `<!-- kb:manual-start --> … <!-- kb:manual-end -->` que o LLM nunca toca (mais granular).
- **(d) Separar geração de curadoria:** kb-generator escreve só um arquivo gerado (ex.: `context.md`/digest) e **nunca** edita `overview.md` (que vira 100% manual).
- Reforçar `prompts/edit-overview-status-sprint.md` é insuficiente sozinho (drift do LLM já aconteceu) — preferir uma barreira **determinística** (a/b/c).

---

## Referências
- Memória: `reference_pmo_repo` (achado kb-generator + bloat .git resolvido + commits da sessão **b5bbab68** 03010 / **18b6b486** 03007).
- Versão curada de `03010/overview.md` (a preservar) está em `origin/master` pós-commit b5bbab68.
- Serviços-irmãos com mesmo padrão: `infra/services/{gdrive-index,email-index,meeting-index}/deploy.sh`.
- Dashboard operacional dos serviços: `infra/workflow/STATUS.md`.

## Pendência relacionada (não-bloqueante)
- `gm-supplypower/` (21 GB) gitignorado e **a relocar** para fora de `pmo/projects/03007/` (decisão do Pedro).
