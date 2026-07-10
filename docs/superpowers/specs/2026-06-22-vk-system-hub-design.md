---
type: Design Spec
title: VK system-hub — Fase 0 Design
description: Em 22/06/2026 vk01 perdeu acesso de rede durante um swap físico de câmera USB. A hipótese mais provável é kernel hang/panic concorrente com a manipulação física. O ponto cego operacional foi: quand...
timestamp: 2026-06-22
---

# VK system-hub — Fase 0 Design

**Data**: 2026-06-22
**Autor**: Pedro Teruel
**Status**: Draft para revisão
**Implementação**: Diferida para janela de bench testing dos PCs vk01/vk02 em Joinville (~semana de 29/06)
**Repositório alvo**: `strokmatic/visionking` (branch `feat/system-hub`)
**Spec relacionada**: `2026-06-20-vk-camera-watchdog-design.md`, `2026-06-21-vk-camera-watchdog-l4-power-cycle.md`

---

## 1. Contexto

Em 22/06/2026 vk01 perdeu acesso de rede durante um swap físico de câmera USB. A
hipótese mais provável é kernel hang/panic concorrente com a manipulação física.
O ponto cego operacional foi: quando vk01 morre, **toda a observability local
morre junto** (Prometheus, Grafana, Redis e Postgres rodam no próprio host). O
operador da planta perde a tela de monitoramento; o engenheiro remoto perde a
métrica recente; não há postmortem automático.

Isto soma a um cenário mais amplo de fragilidade da plataforma Intel Raptor Lake
(Vmin Shift Instability), 6 kernel panics preservados em pstore e 150 reboots
registrados. A substituição de hardware (CPU + MB AM5) já está encaminhada,
mas o vetor operacional permanece: precisamos de uma arquitetura em que **a
queda de um nó não cega a operação nem destrói forensics**.

## 2. Objetivo

Construir um **hub central no vk03** que:

1. Recebe heartbeat e estado de saúde de vk01 e vk02 em tempo real.
2. Preserva último estado conhecido quando um nó cai.
3. Detecta indisponibilidade cross-nó de forma independente da observability
   in-band do nó (que pode morrer com ele).
4. Recolhe automaticamente postmortem de kernel panic ou shutdown unclean.
5. Expõe a visão consolidada para **operadores da planta** via expansão do
   frontend existente — JARVIS é consumidor secundário.

Não-objetivos:

- Substituir Prometheus/Grafana locais de cada nó (continuam fonte de verdade).
- Mover bases de dados de inspeção (Postgres) para vk03 — fora do escopo.
- Alta disponibilidade do hub (se vk03 cai, JARVIS continua falando direto com
  vk01/vk02 como fallback).

## 3. Audiência primária

| Audiência | Como acessa |
|---|---|
| **Operador da planta** | Frontend Angular `services/frontend/` em vk03 — view nova "System Status" |
| Engenheiro remoto | JARVIS `scripts/vk-health/` lê do hub via Redis + Prometheus de vk03 |
| Cliente final | Não acessa — visualização interna Strokmatic |

## 4. Decisões confirmadas (resumo)

| # | Decisão | Resolução |
|---|---|---|
| 1 | Frontend acessa Redis via | Backend NestJS adiciona `/api/system-hub/*` |
| 2 | Onde a spec vive | JARVIS `docs/superpowers/specs/` |
| 3 | Transporte postmortem | `rsync` sobre SSH key existente |
| 4 | Schema Redis | `hub:<host>:<key>` em DB 15 do `visionking-redis` |
| 5 | Como nó sabe que é hub | Campo `role` no topology |
| 6 | Topology multi-nó | Estender single-node com `role`; single-node vira caso particular |
| 7 | Fields publicados | `last_seen`, `uptime`, `cameras_enumerated`, `mce_count_24h`, `pipeline_throughput`, `gpu_util`, `inference_lag_ms` |
| 8 | TTLs | heartbeat=30s, status=60s, MCE counter=86400s |
| 9 | Senha hub | Reusar `REDIS_PASSWORD` existente |
| 10 | Hostname | Short hostname (`vk01`, `vk02`, `vk03`) |
| 16 | MCE coletor | `rasdaemon` (apt) |
| 17 | Hardware watchdog | Diferido para bench |
| 18 | Deploy | `deployment-runner` para novas instalações; `install.sh` standalone para existentes |
| 22 | JARVIS integration | vk-health primário lê do hub; mantém scrape direto como fallback |
| 23 | `data/vk-health/03002/` | Mantém formato atual |
| 24 | Boot postmortem trigger | Panic + unclean shutdown, classificados |
| 25 | Conteúdo tarball | dmesg-b-1 + journalctl -k -b -1 + lsusb + nvidia-smi + dmidecode |
| 26 | Retention | 90 dias com auto-rotate |

## 5. Arquitetura — visão em camadas

```
┌────────────────────────────────────────────────────────────────────┐
│  Camada 5 — JARVIS local                                           │
│    scripts/vk-health/collect.sh                                    │
│      primário: scrape hub vk03 (Redis + Prometheus)                │
│      fallback: scrape direto vk01/vk02                             │
│      → Telegram jarvis-alerts                                      │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ scrape REST + Redis read
                              │
┌────────────────────────────────────────────────────────────────────┐
│  Camada 4 — Operador da planta                                     │
│    frontend (existente, view nova) ◀──── backend NestJS (rota nova)│
│                                            ◀────  Redis DB 15      │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌────────────────────────────────────────────────────────────────────┐
│  Camada 3 — Hub (roda no nó com role=hub, ex.: vk03)               │
│    Redis visionking-redis (DB 15, namespace hub:*)                 │
│    scripts/system-hub/watchdog.sh                                  │
│    scripts/system-hub/postmortem-receiver.sh                       │
│    /var/lib/vk-hub/postmortems/                                    │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ redis SET + rsync SSH
                              │
┌────────────────────────────────────────────────────────────────────┐
│  Camada 2 — Worker (roda em vk01, vk02, e também vk03)             │
│    scripts/system-monitor/heartbeat-pusher.sh                      │
│    scripts/system-monitor/mce-collector.sh                         │
│    scripts/system-monitor/boot-postmortem-sender.sh                │
│    scripts/system-monitor/usb-camera-presence.sh                   │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ lê /proc, /sys, sysfs
                              │
┌────────────────────────────────────────────────────────────────────┐
│  Camada 1 — Sistema operacional                                    │
│    rasdaemon (apt)                                                 │
│    sysctl drop-in /etc/sysctl.d/99-vk-hardening.conf               │
│    systemd-pstore                                                  │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌────────────────────────────────────────────────────────────────────┐
│  Camada 0 — Stack existente (sdk-observability-stack)              │
│    Prometheus + Grafana + node_exporter + cAdvisor                 │
│    (mantido como está em cada nó)                                  │
└────────────────────────────────────────────────────────────────────┘
```

Os caminhos **redis SET (heartbeat)** e **rsync SSH (postmortem)** são
explicitamente independentes da stack Prometheus do nó — se a stack do nó
travar primeiro, o heartbeat continua até o sistema operacional cair de fato.

## 6. Convenções de schema

### 6.1 Redis (DB 15)

Prefixo: `hub:<host>:<key>` onde `<host>` é o short hostname.

| Chave | Tipo | TTL | Descrição |
|---|---|---|---|
| `hub:vk01:heartbeat` | string (epoch) | 30 s | Atualizada a cada 5 s pelo heartbeat-pusher |
| `hub:vk01:uptime` | string (seconds) | 30 s | Uptime atual do nó |
| `hub:vk01:cameras_enumerated` | string (int) | 30 s | Contagem de devices `2bdf:0001` no USB |
| `hub:vk01:pipeline_throughput` | string (fps) | 60 s | Frames/s do camera-acquisition (lido via Redis local app) |
| `hub:vk01:gpu_util` | string (pct) | 30 s | nvidia-smi util % |
| `hub:vk01:inference_lag_ms` | string (int) | 60 s | Média móvel 1 min do lag do inference service |
| `hub:vk01:mce_count_24h` | string (int) | 86400 s | Contador de eventos MCE/WHEA das últimas 24 h |
| `hub:vk01:last_panic_ts` | string (epoch) | sem TTL | Último panic detectado (preserva entre reboots) |
| `hub:vk01:role` | string | sem TTL | Role declarado no topology (worker / hub / both) |
| `hub:status:vk01` | string (enum) | 60 s | Escrita pelo watchdog: `HEALTHY` / `WARN` / `CRIT` / `OFFLINE` |
| `hub:status:vk01:reason` | string | 60 s | Texto humano da última classificação |
| `hub:postmortem:latest` | list (LPUSH) | sem TTL | Caminhos dos N postmortems mais recentes |

Todas as chaves do hub usam **DB 15** para isolamento. A senha é a mesma
`${REDIS_PASSWORD}` do `visionking-redis`.

### 6.2 Filesystem do hub

```
/var/lib/vk-hub/
├── postmortems/
│   ├── vk01/
│   │   └── 2026-06-22T180230Z/
│   │       ├── dmesg-b-1.txt
│   │       ├── journalctl-k.txt
│   │       ├── lsusb.txt
│   │       ├── nvidia-smi.txt
│   │       ├── dmidecode.txt
│   │       ├── pstore-raw/
│   │       │   └── dmesg-efi-*
│   │       └── metadata.json
│   └── vk02/
└── watchdog-state.json    # estado da última varredura (debug)
```

## 7. Componentes — `scripts/system-monitor/` (worker)

Roda em **todos os nós** (vk01, vk02, vk03 — vk03 é hub *e* worker dele mesmo).

### 7.1 heartbeat-pusher.sh

Loop bash em 5 s. Lê `/proc/uptime`, `lsusb`, `nvidia-smi`, `redis-cli` local
(para puxar stats do pipeline) e escreve no Redis do hub via `lib/hub-client.sh`.

Pseudocódigo:
```bash
while true; do
  HOST=$(hostname -s)
  HUB="redis-cli -h $HUB_HOST -p $HUB_PORT -a $REDIS_PASSWORD -n 15"
  ts=$(date +%s)
  $HUB SET "hub:$HOST:heartbeat" "$ts" EX 30
  $HUB SET "hub:$HOST:uptime" "$(awk '{print int($1)}' /proc/uptime)" EX 30
  $HUB SET "hub:$HOST:cameras_enumerated" "$(lsusb | grep -c 2bdf:0001)" EX 30
  $HUB SET "hub:$HOST:gpu_util" "$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits)" EX 30
  # ... outras métricas
  sleep 5
done
```

### 7.2 mce-collector.sh

Reage a eventos do `rasdaemon`. Estratégia:

1. Tail `rasdaemon.db` (sqlite) via watcher de mtime, **ou**
2. Subscribe ao `journalctl -kf | grep -iE "MCE|WHEA|edac"`

Cada evento incrementa `hub:<host>:mce_count_24h` (`INCR` + `EXPIRE 86400`) e
faz um `LPUSH hub:<host>:mce_events <json>` com janela curta (`LTRIM 0 99`).

### 7.3 boot-postmortem-sender.sh

Roda **uma vez no boot**. Unit `Type=oneshot` com
`ConditionPathExists=/sys/fs/pstore` ou `RequiresMountsFor=/sys/fs/pstore`.

Lógica:
1. Detectar se houve panic anterior:
   - `[ -n "$(ls /sys/fs/pstore/)" ]` → kernel panic confirmado
   - OU `last -x reboot | head -2 | grep -qv "system down"` → unclean shutdown
2. Empacotar tarball no formato definido em §6.2.
3. `rsync -az --remove-source-files /tmp/postmortem-<TS>/ vk-rsync@${HUB_HOST}:/var/lib/vk-hub/postmortems/<host>/<TS>/`
4. Atualizar `hub:<host>:last_panic_ts` no Redis do hub.
5. Limpar pstore (`rm /sys/fs/pstore/*` — só após upload bem-sucedido).

### 7.4 usb-camera-presence.sh

Suplementar ao heartbeat: dispara um one-shot push **imediato** quando há mudança
na contagem de câmeras (4 → 3 ou 3 → 4), para que o frontend reaja sem esperar
o intervalo de heartbeat. Implementado via `inotifywait` em `/sys/bus/usb/devices`.

### 7.5 lib/hub-client.sh

Wrapper sobre `redis-cli` para abstrair conexão:

```bash
hub_set() {
    local key="$1" val="$2" ttl="${3:-}"
    if [ -n "$ttl" ]; then
        redis-cli -h "$HUB_HOST" -p "$HUB_PORT" -a "$REDIS_PASSWORD" -n 15 SET "$key" "$val" EX "$ttl" >/dev/null
    else
        redis-cli -h "$HUB_HOST" -p "$HUB_PORT" -a "$REDIS_PASSWORD" -n 15 SET "$key" "$val" >/dev/null
    fi
}
```

### 7.6 Systemd units

| Unit | Type | Restart | Notes |
|---|---|---|---|
| `vk-heartbeat.service` | simple | always | `After=network-online.target` |
| `vk-mce-collector.service` | simple | always | `After=rasdaemon.service` |
| `vk-boot-postmortem-sender.service` | oneshot | no | `After=local-fs.target`, runs once |
| `vk-usb-camera-presence.service` | simple | always | inotify watcher |

### 7.7 Config — `/etc/vk/system-monitor.env`

```ini
HUB_HOST=10.244.70.25
HUB_PORT=6379
REDIS_PASSWORD=__from_topology__
NODE_ROLE=worker      # ou hub, ou both
HEARTBEAT_INTERVAL=5
```

## 8. Componentes — `scripts/system-hub/` (hub-only)

Roda **apenas no nó com role=hub** (vk03 no caso 03002).

### 8.1 watchdog.sh

Loop de 10 s:
1. Para cada `<host>` declarado no topology:
   - `hb_ts = HUB GET hub:<host>:heartbeat` (epoch ou nil)
   - `age = now - hb_ts`
   - Active probes (paralelo, com timeout 2s cada):
     - `ping -c 1 -W 1 <host>` → `ping_ok`
     - `nc -z -w 1 <host> 22` (ou 8050) → `ssh_ok`
2. Classifica conforme matriz (§9).
3. Aplica histerese (3 leituras consecutivas para CRIT).
4. Escreve `hub:status:<host>` e `hub:status:<host>:reason`.
5. Persiste snapshot completo em `/var/lib/vk-hub/watchdog-state.json` (debug).

### 8.2 postmortem-receiver.sh

Mecanismo escolhido: `rsync` sobre SSH key.

Setup:
- Usuário `vk-rsync` no vk03 com shell `/bin/rsync-only` (rrsync ou
  ForceCommand no authorized_keys com `restrict,command="..."`).
- Authorized keys com chaves públicas de vk01, vk02 (e vk03 pra si próprio).
- Destination root: `/var/lib/vk-hub/postmortems/<host>/`.

`postmortem-receiver.sh` é o nome simbólico — na prática é um daemon que tail
`inotifywait` em `/var/lib/vk-hub/postmortems/` e a cada arquivo novo:
1. Valida metadata.json
2. Comprime para `.tar.zst` se ainda não estiver
3. Atualiza `hub:postmortem:latest` (`LPUSH` + `LTRIM 0 49`)
4. Roda rotation: deleta dirs com mtime > 90 dias

### 8.3 Systemd units

| Unit | Type | Restart |
|---|---|---|
| `vk-hub-watchdog.service` | simple | always |
| `vk-hub-postmortem-receiver.service` | simple | always |

## 9. Matriz de classificação do watchdog

| heartbeat age | ping | ssh | Classificação | Hysteresis |
|---|---|---|---|---|
| < 30 s | OK | OK | `HEALTHY` | 1 leitura |
| 30–60 s | OK | OK | `WARN` (heartbeat stale, host responde) | 1 leitura |
| > 60 s | OK | OK | `WARN` (daemon problema, host alive) | 1 leitura |
| stale | OK | fail | `CRIT` (kernel ou ssh travado) | 3 leituras consecutivas |
| stale | fail | fail | `CRIT` (host offline) | 3 leituras consecutivas |
| stale | fail | fail E vizinhos OK | `CRIT — <host> isolado` | 3 leituras consecutivas |
| ping OK + ssh OK + heartbeat 0–5 s | OK | OK | `HEALTHY (recovered)` | 1 leitura para sair de CRIT |

Histerese de 3 leituras a 10 s = 30 s evita falsos positivos por blips de rede
ou GC do KeyDB.

## 10. Backend NestJS — rota nova

> **Nota de nomenclatura**: o backend e o frontend usados pelo deployment de
> Laminação 03002 (ArcelorMittal Steel) são os containers **`visionking-backend`**
> e **`visionking-frontend`**, cujos códigos vivem em `services/backend/` e
> `services/frontend/` (sem o sufixo `-ds`). Os pares `-ds` (`services/backend-ds/`
> e `services/frontend-ds/`) servem o deployment de Carrocerias e estão fora
> do escopo desta spec.

Em `services/backend/`, adicionar módulo `system-hub`:

```
src/system-hub/
├── system-hub.module.ts
├── system-hub.controller.ts      # /api/system-hub/*
├── system-hub.service.ts          # cliente Redis DB 15
└── dto/
    ├── node-status.dto.ts
    ├── postmortem-list.dto.ts
    └── ...
```

Rotas:

| Método | Path | Resposta |
|---|---|---|
| GET | `/api/system-hub/nodes` | lista nós + status + last-known fields |
| GET | `/api/system-hub/nodes/:host` | detalhe do nó |
| GET | `/api/system-hub/postmortems` | lista paginada |
| GET | `/api/system-hub/postmortems/:id` | metadata + links de download |
| GET | `/api/system-hub/postmortems/:id/download` | tar.zst stream |

Auth: reusa middleware existente do backend (sessão NestJS).

## 11. Frontend Angular — view nova

Em `services/frontend/`, adicionar route `/system-status`:

```
src/app/system-status/
├── system-status.module.ts
├── system-status-routing.module.ts
├── pages/
│   ├── overview/                  # grid 3 cards (vk01/vk02/vk03)
│   ├── node-detail/               # métricas detalhadas + histórico
│   └── postmortems/               # lista + download
└── services/
    └── system-hub.service.ts      # HTTP client
```

Poll: 5 s. Refresh manual disponível. Cores: `HEALTHY=verde`, `WARN=amarelo`,
`CRIT=vermelho`, `OFFLINE=cinza`. Sem som — operador da planta tem outros
canais auditivos.

## 12. Topology — campo `role`

Estender o schema atual de `topologies/laminacao-single-node.yaml`:

```yaml
nodes:
  vk01:
    hostname: vk01
    ip: 10.244.70.26
    role: worker             # NOVO
    capabilities: [...]

  vk02:
    hostname: vk02
    ip: 10.244.70.50
    role: worker

  vk03:
    hostname: vk03
    ip: 10.244.70.25
    role: hub                # NOVO — único hub do deployment

infrastructure:
  redis:
    enabled: true
    node: main_or_hub        # convenção: se role=hub existe, redis vai pra ele
    image: eqalpha/keydb:latest
    bind_lan: true           # NOVO — expõe na LAN além de docker network
    port: 6379
```

Em `laminacao-single-node.yaml` clássico (1 node faz tudo), o nó tem
`role: [worker, hub]` (lista). O deployment-runner trata como caso particular.

Criar novo arquivo: `topologies/laminacao-multi-node.yaml` para o caso 03002.

## 13. Hardening — sysctl + rasdaemon

### 13.1 Sysctl drop-in

`/etc/sysctl.d/99-vk-hardening.conf`:

```ini
# Memória — inferência precisa de paginação previsível
vm.swappiness = 10
vm.overcommit_memory = 1
vm.dirty_background_ratio = 5
vm.dirty_ratio = 15

# Kernel — auto-reboot em panic, hung task warning, NMI
kernel.panic = 30
kernel.panic_on_oops = 1
kernel.hung_task_timeout_secs = 120
kernel.hung_task_warnings = -1
kernel.softlockup_panic = 0      # warn-only, não derruba
kernel.nmi_watchdog = 1

# Filesystem — fds suficientes para o pipeline
fs.file-max = 2097152

# Rede — buffers maiores para handover de imagens cross-container
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
```

Aplicação: `sysctl --system` ou reboot. O instalador `scripts/system-monitor/install.sh`
copia e aplica.

### 13.2 rasdaemon

```bash
sudo apt-get install -y rasdaemon
sudo systemctl enable --now rasdaemon
```

O `mce-collector.sh` consome via `ras-mc-ctl --errors` ou direto do sqlite em
`/var/lib/rasdaemon/ras-mc_event.db`.

### 13.3 Hardware watchdog

**Diferido para bench testing**. Anotado no plano de bench Dia 1, passo de BIOS.

## 14. Deploy strategy

### 14.1 Novas instalações
`deployment-runner` (em `toolkit/deployment-runner/`) ganha suporte para
descrever serviços nativos (não-docker) com:

```yaml
native_services:
  - name: vk-heartbeat
    path: scripts/system-monitor/
    install_script: install.sh
    target_nodes_by_role: [worker, hub, both]
```

### 14.2 Instalações existentes (vk01/vk02/vk03 atuais)
`scripts/system-monitor/install.sh` e `scripts/system-hub/install.sh` —
standalone, idempotentes. Lógica:

1. `apt-get install -y rasdaemon` (idempotent).
2. Copia `systemd/*.service` para `/etc/systemd/system/`.
3. Copia scripts para `/opt/vk-system-monitor/`.
4. Copia env file template para `/etc/vk/system-monitor.env` se ausente.
5. `systemctl daemon-reload`.
6. `systemctl enable --now vk-heartbeat vk-mce-collector vk-usb-camera-presence`.
7. `systemctl enable vk-boot-postmortem-sender` (não start — só dispara no boot).
8. Aplica `/etc/sysctl.d/99-vk-hardening.conf` + `sysctl --system`.

Saída: log de instalação + verificação automática (`systemctl is-active` em cada unit).

## 15. JARVIS integration

### 15.1 Migração do `scripts/vk-health/collect.sh`

Adicionar fonte primária: hub.

```bash
# Pseudo
if curl -sf http://vk03.lan/api/system-hub/nodes | jq . >/dev/null; then
    # primário: pull único do hub
    collect_from_hub
else
    # fallback: scrape direto vk01/vk02/vk03 (modo atual)
    collect_from_each_node
fi
```

`data/vk-health/03002/<date>/snapshot-*.json` continua com mesmo schema —
apenas a fonte muda. Telegram alerts continuam em `jarvis-alerts`.

### 15.2 Sem alertas saindo do vk03

Conforme decidido: vk03 não tem internet, então não envia Telegram. JARVIS é
o único caminho de alerta externo. O hub só consolida estado.

## 16. Boot postmortem — fluxo end-to-end

```
┌───────────────────────────────────────────────────────────────────┐
│  vk01 KERNEL PANIC                                                │
│    pstore kwrite via efi-pstore                                   │
│    sistema reboota (kernel.panic=30 OU hardware watchdog)         │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  vk01 BOOT                                                        │
│    systemd-pstore copia pstore → /var/lib/systemd/pstore/         │
│    vk-boot-postmortem-sender.service dispara (oneshot)            │
│      detecta pstore não-vazio OU last -x unclean                  │
│      empacota tarball                                             │
│      rsync para vk03:/var/lib/vk-hub/postmortems/vk01/<TS>/       │
│      HUB SET hub:vk01:last_panic_ts                               │
│      rm /sys/fs/pstore/* (após upload OK)                         │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  vk03 RECEPÇÃO                                                    │
│    inotify dispara em /var/lib/vk-hub/postmortems/                │
│    valida metadata.json                                           │
│    comprime tar.zst se necessário                                 │
│    LPUSH hub:postmortem:latest <caminho>                          │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  CONSUMERS                                                        │
│    frontend exibe banner "vk01 voltou de panic às HH:MM"          │
│    JARVIS vk-health alerta jarvis-alerts no Telegram              │
└───────────────────────────────────────────────────────────────────┘
```

## 17. Cronograma

Instalação **diferida para bench testing** dos PCs em Joinville.

| Marco | Onde | Quando |
|---|---|---|
| Spec revisada por Pedro | JARVIS | 22–24/06 |
| Branch `feat/system-hub` no VK monorepo | strokmatic/visionking | 25/06 |
| `scripts/system-monitor/` implementado + testado em vagrant/lxd | local | 26–28/06 |
| `scripts/system-hub/` implementado + testado em par com worker simulado | local | 28–29/06 |
| Backend NestJS rota nova | local | 30/06–01/07 |
| Frontend Angular view nova | local | 01–02/07 |
| Install em vk03 (bench) | bancada Joinville | Dia 3 do plano de bench |
| Install em vk01 + vk02 reconstruídos (AM5) | bancada Joinville | Dia 4 do plano de bench |
| Soak conjunto 24h | bancada Joinville | Dia 7 do plano de bench |
| Cutover JARVIS para fonte primária = hub | JARVIS | Pós-retorno à planta |

## 18. Open questions

1. **Postmortem signing/verification**: assinar tarballs com chave do nó antes
   do upload? Defesa contra MitM em LAN — provavelmente over-engineering para
   ambiente fabril controlado.
2. **Schema versioning**: prefix `hub:v1:<host>:*` para suportar evolução do
   schema? Recomendação: começar sem versão, adicionar quando necessário.
3. **Multi-deployment no hub**: se um dia vk03 servir hub para outros
   deployments (improvável), namespace muda para `hub:<deployment>:<host>:*`?
4. **Postmortem privacy**: dumps podem conter dados sensíveis (caminhos,
   nomes de processos, IPs). Para envio ao cliente, sanitizar antes.
5. **Failover do hub**: se vk03 cai, frontend operador também cai (mora lá).
   Resposta atual: aceitar — eventos catastróficos são raros e JARVIS continua
   alertando via fallback direct scrape. Avaliar replicação cross-site
   em fase futura.

## 19. Métricas de sucesso

A Fase 0 é bem-sucedida se:

- [ ] Operador consegue ver `HEALTHY/WARN/CRIT/OFFLINE` de vk01/vk02 em < 30 s
  após uma queda real
- [ ] Postmortem de panic chega ao vk03 sem intervenção humana em > 95% dos casos
  testados em bancada
- [ ] Heartbeat não disputa recursos com pipeline de inspeção
  (overhead < 0,5% CPU em vk01)
- [ ] JARVIS continua funcional se o hub cair (fallback validado)
- [ ] Zero alerta falso-positivo em soak de 24 h

## 20. Riscos

| Risco | Mitigação |
|---|---|
| Exposure do Redis na LAN sem ACL | Adicionar ACL `hub-writer` se segurança da planta exigir; firewall na vk03 limitando 6379 a /24 da fábrica |
| `inotifywait` em `/var/lib/vk-hub/postmortems/` perder eventos por overrun | Watcher reinicia ao detectar overrun + scan periódico fallback |
| `rsync` SSH falhar e bloquear boot por timeout | `vk-boot-postmortem-sender.service` com `TimeoutStartSec=120s`; falha não bloqueia outros services |
| Drift entre topology declarado e instalação real | Comando `vk-hub-status` no install.sh imprime topology atual + verifica consistência |
| KeyDB DB 15 conflitando com app data se app começar a usar | Documentar reserva no README do `services/redis/` |

---

## 21. Recorte MVP-α — sinalização mínima de reboot necessário

### 21.1 Objetivo do recorte

Entregar **antes de qualquer outra coisa**, **sem tocar em backend nem
frontend Angular**, **sem alterar nenhum serviço de produção**, a menor
quantidade de código capaz de responder à única pergunta operacional crítica
hoje:

> Está na hora do operador na planta sair do posto e fazer **reboot físico do
> vk01** (ou vk02)?

Tudo o mais da Fase 0 (postmortem, MCE, sysctl, watchdog hardware, integração
backend/frontend, JARVIS) **fica para depois**. O MVP-α é puramente: heartbeat
→ classificação binária → tela visível na planta.

### 21.2 Princípios de footprint mínimo

| Princípio | Concretização |
|---|---|
| Zero rebuild de container existente | Nada de mudança em `services/backend/` ou `services/frontend/`; nada de novo Dockerfile |
| Zero restart de serviço VK em produção | Reusa `visionking-redis` já em execução (só lê/escreve em DB 15) sem reconfig que exija restart |
| Zero novas dependências de network ports expostas a internet | Tudo localhost ou LAN privada (mesmo segmento dos 3 nós) |
| Zero alteração em sysctl, rasdaemon, BIOS | Diferido para Fase 0 completa |
| Reversível em < 2 min | `systemctl disable --now` + `rm` em 3 arquivos por nó remove 100% da instalação |

### 21.3 Componentes do MVP-α

**Em vk01 e vk02 (worker)** — total: 2 arquivos cada nó:

```
/opt/vk-mvp/heartbeat.sh                    # ~25 linhas bash
/etc/systemd/system/vk-mvp-heartbeat.service
```

Loop a cada 5 s:
```bash
redis-cli -h "$HUB_HOST" -p 6379 -a "$REDIS_PASSWORD" -n 15 \
  SET "hub:$(hostname -s):heartbeat" "$(date +%s)" EX 30
```

Nada mais. Sem coleta de métricas extras, sem MCE, sem USB count — só
heartbeat puro. Adições virão na Fase 0 completa.

**Em vk03 (hub)** — total: 4 arquivos:

```
/opt/vk-mvp/watchdog.sh                     # ~40 linhas bash
/opt/vk-mvp/render-status.sh                # ~30 linhas bash
/opt/vk-mvp/web/status.html.tmpl            # ~50 linhas HTML estático
/etc/systemd/system/vk-mvp-watchdog.service
/etc/systemd/system/vk-mvp-statusweb.service
```

`watchdog.sh`: loop 5 s lendo `hub:vk01:heartbeat` e `hub:vk02:heartbeat`,
escreve **classificação binária** (`OK` ou `REBOOT_NECESSARIO`) em
`/var/lib/vk-mvp/status.json`. Sem matriz complexa, sem hysteresis sofisticada
— se heartbeat > 60 s ou ping falha 3× consecutivos, é `REBOOT_NECESSARIO`.

`render-status.sh`: lê `status.json`, substitui placeholders no template e
gera `/var/lib/vk-mvp/web/status.html`.

`vk-mvp-statusweb.service`: roda `python3 -m http.server 8200 --directory
/var/lib/vk-mvp/web` (uma linha). Operador acessa `http://localhost:8200/`
no vk03 em uma aba dedicada do browser (separada do `visionking-frontend`).

### 21.4 Aparência da página (rascunho ASCII)

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│         VK 03002 — Status dos Nós                   │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐                   │
│  │     vk01    │  │     vk02    │                   │
│  │     🟢 OK    │  │  🔴 OFFLINE │                   │
│  │             │  │ REBOOT      │                   │
│  │ último sinal│  │ NECESSÁRIO  │                   │
│  │ há 4 s      │  │ há 3 min    │                   │
│  └─────────────┘  └─────────────┘                   │
│                                                     │
│  Atualizado em 2026-06-22 18:42:17                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Fundo verde quando ambos OK. Fundo vermelho intenso quando algum em
  `REBOOT_NECESSARIO`.
- `<meta http-equiv="refresh" content="5">` no HTML — sem JavaScript.
- Sem som; sem ações além da indicação visual; sem login.
- Texto grande para visibilidade do posto operacional.

### 21.5 Schema Redis usado pelo MVP-α

Apenas **3 chaves** no DB 15:

| Chave | Tipo | TTL | Escrito por |
|---|---|---|---|
| `hub:vk01:heartbeat` | string (epoch) | 30 s | heartbeat.sh em vk01 |
| `hub:vk02:heartbeat` | string (epoch) | 30 s | heartbeat.sh em vk02 |
| `hub:vk03:heartbeat` | string (epoch) | 30 s | heartbeat.sh em vk03 (self) |

O watchdog em vk03 **não escreve no Redis** no MVP — só lê. Classificação fica
em `/var/lib/vk-mvp/status.json` (local). Isso evita qualquer dependência de
escrita no Redis que pudesse colidir com a aplicação se algo der errado.

### 21.6 Configuração do Redis para aceitar conexões da LAN

O `visionking-redis` (KeyDB) **já está rodando** em todos os nós, mas hoje só
é alcançável pela docker network local de cada nó. Para que vk01/vk02 escrevam
no vk03, precisamos:

1. Confirmar que `${REDIS_PORT}` (default 6379) é publicado no host vk03 —
   olhando `docker-compose.yml:60` isso já acontece via `"${REDIS_PORT}:6379"`.
2. Confirmar firewall do vk03 — abrir porta 6379 apenas para a sub-rede
   10.244.70.0/24 (regra UFW ou iptables).
3. Não é necessário `KEYDB-CLI CONFIG SET` runtime — o bind já existe.

**Se a porta não estiver acessível pela LAN no vk03 (a verificar in-situ)**,
o caminho de menor footprint passa a ser:
- Worker (vk01/02) escreve via `ssh vk03 'redis-cli ...'` usando key auth —
  contorna a necessidade de expor porta na LAN.
- Custo: cada heartbeat abre uma sessão SSH (mais pesado, mas ainda < 0.1% CPU
  a 5 s).

Decisão: **verificar primeiro a porta**; usar SSH como fallback apenas se
abrir 6379 na LAN for politicamente bloqueado pela infra da planta.

### 21.7 Instalação no MVP

Script único `install-mvp.sh` parametrizado:

```bash
./install-mvp.sh worker    # roda em vk01/vk02
./install-mvp.sh hub       # roda em vk03
./install-mvp.sh both      # roda em vk03 (que também é worker dele mesmo)
```

Faz:
1. Cria `/opt/vk-mvp/` e copia arquivos.
2. Cria `/etc/vk-mvp/config.env` com `HUB_HOST` e `REDIS_PASSWORD` (lê do
   `.env` do deployment existente).
3. Copia + enable + start dos systemd units conforme o perfil.
4. Imprime URL final (`http://localhost:8200/` no vk03).
5. Imprime comando de desinstalação reverso.

Tempo de instalação esperado: < 90 s por nó. Sem reboot, sem service restart.

### 21.8 Footprint medido

| Recurso | vk01/vk02 (worker) | vk03 (hub) |
|---|---|---|
| Arquivos novos | 2 | 5 |
| Linhas de código bash | ~25 | ~70 |
| Linhas de HTML | 0 | ~50 |
| Containers novos | 0 | 0 |
| Portas escutando novas | 0 | 1 (8200/tcp, só local) |
| RAM extra | < 5 MB | < 20 MB (python3 http.server + bash daemons) |
| CPU médio | < 0,1% | < 0,3% |
| Disco | < 50 KB | < 100 KB |
| Dependências instaladas | redis-cli (já presente) | python3 (já presente) + redis-cli |
| Reboot | Não | Não |
| Restart de serviço produtivo | Não | Não |

### 21.9 O que o MVP-α **não** entrega (e quando vem)

| Capacidade | Fase | Por quê foi excluída do MVP |
|---|---|---|
| Status detalhado (uptime, cameras, GPU, throughput) | Fase 0 completa | Frontend Angular precisa rota nova — toca backend |
| Postmortem de panic preservado | Fase 0 completa | Requer rasdaemon, pstore handling, rsync infra |
| Diferenciação WARN vs CRIT | Fase 0 completa | MVP usa binário OK/REBOOT — operador não precisa de mais |
| Hysteresis sofisticada e quorum | Fase 0 completa | Risco baixo: blip de rede a 5s causa falso positivo de 1min máx |
| Integração JARVIS (Telegram) | Fase 0 completa | JARVIS já tem vk-health → fallback existente cobre |
| Histórico / time-series de status | Fase 1+ | Não há requisito operacional imediato |
| Reboot remoto a partir do botão | Nunca neste escopo | Decisão consciente — humano confirma + executa |

### 21.10 Critério de pronto do MVP-α

- [ ] Operador na planta enxerga uma página no vk03 que mostra OK ou
  REBOOT_NECESSARIO para vk01 e vk02
- [ ] Falha real (host travado, network down) reflete na tela em < 60 s
- [ ] Recuperação após reboot reflete na tela em < 30 s
- [ ] Desinstalação completa em 1 comando deixa todos os 3 nós no estado
  exato pré-instalação
- [ ] Zero impacto observável em throughput de inspeção em soak de 1 h

### 21.11 Caminho de evolução para Fase 0 completa

O MVP-α é **compatível por desenho** com a Fase 0 completa — o schema Redis
`hub:<host>:heartbeat` é o mesmo. Ao migrar:

1. Heartbeat ganha campos extras (uptime, cameras, etc.) — mesmo daemon evolui
2. Watchdog ganha matriz de classificação (§9) — substitui o binário simples
3. Página HTML estática é deprecated quando rota Angular nova entra no ar
4. `install-mvp.sh` é absorvido pelo `install.sh` da Fase 0

Nenhuma decisão do MVP-α precisa ser revertida.

### 21.12 Onde o código vive

Mesmo lugar da Fase 0 completa, com subpath `mvp/`:

```
strokmatic/visionking
└── scripts/
    └── system-monitor/
        └── mvp/                              ⬅ NOVO — recorte MVP-α
            ├── heartbeat.sh
            ├── watchdog.sh
            ├── render-status.sh
            ├── install-mvp.sh
            ├── uninstall-mvp.sh
            ├── web/
            │   └── status.html.tmpl
            ├── systemd/
            │   ├── vk-mvp-heartbeat.service
            │   ├── vk-mvp-watchdog.service
            │   └── vk-mvp-statusweb.service
            └── README.md
```

Quando a Fase 0 completa for implementada, `scripts/system-monitor/` ganha
os arquivos da arquitetura principal e o subdir `mvp/` é apagado.
