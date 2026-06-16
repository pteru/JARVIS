---
title: "Procedimento de Teste de Bancada — Stack PLC Comm Ops"
subtitle: "Validação end-to-end com CompactLogix em rede compartilhada"
author: "Strokmatic Innovation Technology"
date: "Maio/2026"
pdf_options:
  margin: "18mm 20mm 22mm 20mm"
  format: "A4"
---

<style>
  .header-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1a3a5c;
    padding-bottom: 4px;
    margin-bottom: 20px;
  }
  .header-bar img { height: 72px; }
  .header-info {
    text-align: right;
    font-size: 8.5px;
    line-height: 1.5;
    color: #444;
  }
  .header-info strong { font-size: 9px; color: #1a3a5c; }
  body { font-size: 10.5px; line-height: 1.5; }
  h1 { font-size: 21px; color: #1a3a5c; margin-bottom: 4px; }
  h2 { font-size: 15px; color: #1a3a5c; margin-top: 26px; border-bottom: 1px solid #d0d6de; padding-bottom: 2px; }
  h3 { font-size: 12.5px; color: #1a3a5c; margin-top: 18px; }
  h4 { font-size: 11px; color: #1a3a5c; margin-top: 14px; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 9.5px; }
  pre { background: #f3f4f6; padding: 9px 12px; border-radius: 4px; font-size: 9px; line-height: 1.4; overflow-x: auto; }
  pre code { background: transparent; padding: 0; font-size: 9px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin: 8px 0 14px; }
  table th { background: #f0f3f7; padding: 6px 8px; text-align: left; border-bottom: 1px solid #d0d6de; color: #1a3a5c; }
  table td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .callout { background: #fff8e1; border-left: 4px solid #f0b400; padding: 8px 12px; margin: 10px 0; font-size: 9.5px; }
  .callout-danger { background: #fde7e7; border-left-color: #d33; }
  .callout-info { background: #e7f2fb; border-left-color: #1a73e8; }
  .checkbox { font-family: monospace; }
  .checkbox::before { content: "☐ "; font-weight: bold; }
</style>

<div class="header-bar">
  <img src="assets/logo-strokmatic.svg" alt="Strokmatic Innovation Technology">
  <div class="header-info">
    <strong>Strokmatic Automação Industrial Ltda</strong><br>
    CNPJ: 41.597.854/0001-84<br>
    (Matriz) Rua Arno Waldemar Döhler, 308<br>
    CEP: 89.218-153. Santo Antônio – Joinville (SC)<br>
    Fone: +55 (47) 3030-2280<br>
    E-mail: contato@strokmatic.com
  </div>
</div>

# Procedimento de Teste de Bancada — Stack PLC Comm Ops

**Documento:** PROC-PCO-BENCH-001<br>
**Versão alvo:** SDK v0.2.1 · plc-result-v2 v2 · plc-comm-ops v1.1 · strokmatic-eip master<br>
**Tipo:** Procedimento de teste end-to-end com PLC real<br>
**Responsável pela execução:** Engenheiro de teste / técnico de bancada<br>
**Tempo estimado:** 4–6 horas (setup completo + casos T1–T7)<br>
**Última atualização:** 13/05/2026

---

## 1. Objetivo

Validar a stack PLC Comm Ops em bancada conectada a um **PLC CompactLogix** real (Allen-Bradley / Rockwell Automation, série 1769 ou 5380) na mesma rede física do computador de teste. O procedimento exercita o caminho completo dos dados — do programa ladder no PLC até o dashboard `plc-comm-ops` — em sete casos de teste que cobrem conexão CIP, handshake funcional, recarga em tempo real, concorrência, resiliência, estabilidade temporal e latência.

## 2. Escopo

**Em escopo:**

- Conexão CIP Class 1 entre PLC CompactLogix e adaptador `strokmatic-eip` (OpENer-baseado).
- Handshake completo de resultado de inspeção via `plc-result-v2` (Track 1).
- Observação ao vivo via `plc-comm-ops` v1.1 (dashboard expansível + trendlines + injeção).
- Validação de auditoria em Redis Streams.
- Medição de latência ponto a ponto (PLC → adapter → plugin → adapter → PLC).

**Fora de escopo:**

- Conformance Test ODVA (requer ferramenta Windows-only, executado em separado).
- Validação do plugin `plc-monitor-camera-v2` (mesmo padrão, executar em ciclo posterior).
- Carga de produção com múltiplos PLCs simultâneos.
- Failover de Redis (sem cluster nesta bancada).

## 3. Pré-requisitos

### 3.1 Hardware

| Item | Especificação mínima | Observação |
|---|---|---|
| PLC CompactLogix | 1769-L1xER, L2xER, L3xER ou 5380 (L8x) | Firmware 28.x+; suporte a Generic Ethernet Module |
| Computador de teste (Linux) | x86_64, 8 GB RAM, 2 cores | Onde rodam adapter + plugins + plc-comm-ops + Redis |
| Switch | Gigabit gerenciável ou não | PLC e computador no mesmo VLAN/sub-rede |
| Cabos Ethernet | 2× Cat5e ou superior | Um para PLC, um para computador |
| Workstation Windows (opcional) | Studio 5000 v32+ instalado | Apenas para programar e baixar o programa no PLC |

### 3.2 Software no computador de teste (Linux)

```
$ uname -a            # Linux x86_64 Ubuntu 22.04+ ou Debian 12+
$ docker --version    # 24.0+
$ docker compose version
$ python3 --version   # 3.11+
$ git --version
```

Acesso SSH ao GitHub Strokmatic deve estar configurado (`ssh -T git@github.com`).

### 3.3 Software no PLC

- Studio 5000 Logix Designer (V32 ou superior recomendado).
- Programa de teste de handshake (estrutura no Apêndice B).
- Arquivo EDS `STROKMATIC-COMM-V1.eds` (de `strokmatic-eip/eds/`) registrado via EDS Hardware Installation Tool.

### 3.4 Acessos e credenciais

- Chave SSH com permissão de leitura nos repositórios privados Strokmatic.
- Senha do Redis de bancada (se diferente da default).
- Endereço IP fixo planejado para o computador de teste (será o "endereço do adaptador" do ponto de vista do PLC).

## 4. Topologia da bancada

```
                       192.168.15.0/24
                       
┌────────────────────┐                    ┌──────────────────────┐
│ Workstation Win10  │                    │ PLC CompactLogix     │
│  Studio 5000       │                    │  L33ER / L8x         │
│  192.168.15.50     │◀──────────────────▶│  192.168.15.123      │
└─────────┬──────────┘                    └──────────┬───────────┘
          │                                          │
          │                                          │
          ▼                                          ▼
       ┌────────────────────────────────────────────────┐
       │       Switch Gigabit                            │
       └────────────────────────────────────────────────┘
                                ▲
                                │
                                ▼
                ┌──────────────────────────────────────┐
                │ Computador de teste (Linux)          │
                │ 192.168.15.100  (eth0 / enp4s0)      │
                │                                       │
                │  ┌──────────────────────────────┐    │
                │  │ strokmatic-eip (host net)    │    │
                │  │  - bind iface: enp4s0         │    │
                │  │  - Vendor 9876, Prod 1, v1.0  │    │
                │  │  - Asm 100 (T→O) 128 bytes    │    │
                │  │  - Asm 150 (O→T) 128 bytes    │    │
                │  └────────────┬──────────────────┘    │
                │               │ Redis IPC              │
                │               ▼                        │
                │  ┌──────────────────────────────┐    │
                │  │ Redis 7  :6379               │    │
                │  └────────────┬──────────────────┘    │
                │               │                        │
                │     ┌─────────┴─────────┐              │
                │     ▼                   ▼              │
                │ plc-result-v2       plc-comm-ops      │
                │ (cell BSL01)         :8000             │
                │                      browser do op.    │
                └──────────────────────────────────────┘
```

**Endereços de exemplo** (substitua pelos reais da sua bancada):

| Elemento | IP | Porta(s) |
|---|---|---|
| PLC CompactLogix | `192.168.15.123` | 44818 (CIP TCP), 2222 (CIP UDP) |
| Computador de teste (adaptador) | `192.168.15.100` | 44818, 2222 |
| Workstation Windows (Studio 5000) | `192.168.15.50` | — |
| Redis (no computador de teste) | `127.0.0.1` | 6379 |
| plc-comm-ops UI | `192.168.15.100` | 8000 |

## 5. Variáveis do teste

Preencha esta tabela **antes** de iniciar e use os valores nas etapas seguintes:

| Variável | Valor | Onde usar |
|---|---|---|
| `PLC_IP` | `__________` | Studio 5000 → propriedades do controller |
| `ADAPTER_IP` | `__________` | Generic Ethernet Module → IP Address |
| `NET_IFACE` | `__________` | `enp4s0`, `eth0`, … (no Linux) |
| `PLC_KEY` | usar `ADAPTER_IP` | env do adapter + cfg dos plugins |
| `REDIS_PASSWORD` | `__________` | env `REDIS_PASSWORD` do adapter |
| `CELL` | ex. `BENCH01` | cfg do plc-result-v2 |

## 6. Setup do ambiente

### 6.1 Verificações de rede

```bash
# A partir do computador de teste
ping -c 3 ${PLC_IP}                                   # responde?
nmap -p 44818,2222 ${PLC_IP}                          # PLC abre as portas?
ip addr show ${NET_IFACE}                             # interface UP, IP correto?
```

<span class="checkbox">PLC responde ping em <code>${PLC_IP}</code></span><br>
<span class="checkbox">Portas 44818/tcp e 2222/udp abertas no PLC</span><br>
<span class="checkbox">Interface <code>${NET_IFACE}</code> com IP <code>${ADAPTER_IP}</code></span>

### 6.2 Subir Redis

```bash
docker run -d --name redis-bench \
  --restart unless-stopped \
  --network host \
  redis:7 redis-server \
    --requirepass "${REDIS_PASSWORD}" \
    --save "" --appendonly no
```

Validar:
```bash
redis-cli -a "${REDIS_PASSWORD}" ping        # → PONG
```

### 6.3 Build do adaptador strokmatic-eip

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
DOCKER_BUILDKIT=1 docker build --ssh default -t strokmatic-eip:bench .
```

Subir o adapter:
```bash
docker run -d --name strokmatic-eip \
  --network host --privileged \
  -e REDIS_HOST=127.0.0.1 \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
  -e PLC_KEY="${ADAPTER_IP}" \
  strokmatic-eip:bench \
  "${NET_IFACE}"
```

Validar no log:
```bash
docker logs strokmatic-eip 2>&1 | tail -20
# Esperado:
#  - "Strokmatic EIP starting" com Vendor=9876 ProductCode=1
#  - "Binding to interface ${NET_IFACE}"
#  - "EDS revision: ..."
#  - "Listening on 44818/tcp and 2222/udp"
```

<span class="checkbox">Container <code>strokmatic-eip</code> rodando, sem erros no log</span>

### 6.4 Build dos plugins

Plugin `plc-result-v2` (a partir do worktree do branch `v2/sdk-based`):

```bash
cd /home/teruel/worktrees/plc-result-v2
DOCKER_BUILDKIT=1 docker build --ssh default \
  -f plc-result-v2.Dockerfile -t plc-result-v2:bench .
```

Subir com configuração de bancada (será sobrescrita posteriormente pela UI; aqui só semeia):

```bash
docker run -d --name plc-result-v2 \
  --network host \
  -e REDIS_HOST=127.0.0.1 \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
  -e PLC_KEY="${ADAPTER_IP}" \
  -e CELL="${CELL}" \
  plc-result-v2:bench
```

Validar:
```bash
docker logs plc-result-v2 2>&1 | tail -10
redis-cli -a "${REDIS_PASSWORD}" hgetall status:plc-result-v2:${CELL}
# Esperado: last_beat_ms recente, state=IDLE
```

<span class="checkbox">plugin emitindo heartbeat (status hash atualizado)</span>

### 6.5 Subir plc-comm-ops

```bash
cd /home/teruel/worktrees/plc-comm-ops-v1.1
DOCKER_BUILDKIT=1 docker build --ssh default -f plc-comm-ops.Dockerfile -t plc-comm-ops:bench .

docker run -d --name plc-comm-ops \
  --network host \
  -e REDIS_HOST=127.0.0.1 \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
  -e PORT=8000 \
  plc-comm-ops:bench
```

Validar:
```bash
curl http://127.0.0.1:8000/healthz                    # → ok
curl http://127.0.0.1:8000/api/dashboard.json | jq    # plc-result-v2:${CELL} presente
```

Abrir no navegador: `http://${ADAPTER_IP}:8000/`. A linha do plugin aparece **verde** (heartbeat fresco).

<span class="checkbox">plc-comm-ops UI acessível, plugin visível como verde</span>

### 6.6 Programar o PLC

**6.6.1 Registrar o EDS no Studio 5000:**

- Copie `strokmatic-eip/eds/STROKMATIC-COMM-V1.eds` para a workstation Windows.
- Abra **Tools → EDS Hardware Installation Tool → Register an EDS file**.
- Aponte para o `.eds`. Aceite o ícone padrão (não temos `.ico` próprio nesta versão).

**6.6.2 Criar o projeto:**

- File → New → CompactLogix (mesmo modelo do hardware).
- Defina o IP do controller para `${PLC_IP}` em **Controller Properties → Internet Protocol**.

**6.6.3 Adicionar o módulo de comunicação:**

- I/O Configuration → Ethernet → Add Module → **Generic Ethernet Module**.
- Parâmetros:

| Campo | Valor |
|---|---|
| Name | `STROKMATIC_COMM` |
| Description | `Strokmatic comm adapter — bench` |
| Comm Format | **Data – SINT** |
| IP Address | `${ADAPTER_IP}` |
| **Input** Assembly Instance | **100**, Size **128** (SINT) |
| **Output** Assembly Instance | **150**, Size **128** (SINT) |
| **Configuration** Assembly Instance | **151**, Size **0** (SINT) |
| Requested Packet Interval (RPI) | **50 ms** (mín. 20 ms; usaremos 50 para testes iniciais) |
| Connection over EtherNet/IP | EtherNet/IP |
| Use Unicast Connection over EtherNet/IP | (deixe marcado se disponível) |

<span class="checkbox">EDS registrado e Generic Ethernet Module configurado</span>

> **Aviso:** O ProductCode no EDS está como **1 (placeholder)**. Se o Studio 5000 reclamar de incompatibilidade na conexão, é provável que o firmware do PLC esteja validando contra o EDS — verifique no perfil do módulo se está usando *Compatible Match* ou *Exact Match*. Para a bancada, use *Compatible Match*.

**6.6.4 Ladder de teste mínimo:**

Crie um programa `MainProgram` com a rotina `Handshake_Test` (estrutura completa no Apêndice B). O esqueleto:

```
─── XIO Test_Disable ─────[ MOV 1 STROKMATIC_COMM:O.Data[32] ]── (request_result)
─── XIO Test_Disable ─── XIC ResultAckPending ─────────────────  
                                       └────[ MOV 1 STROKMATIC_COMM:O.Data[33] ]── (result_write_comp_plc)
─── XIC STROKMATIC_COMM:I.Data[36] ────────────────────────────  
                  (result_write_comp_dev do plugin)              [ TON ResultAckDelay ]
─── XIC ResultAckDelay.DN ─────[ MOV 0 STROKMATIC_COMM:O.Data[32] ]── (libera request)
                              └[ MOV 0 STROKMATIC_COMM:O.Data[33] ]── (libera ack)
```

Tags adicionais para o teste:

| Nome | Tipo | Default |
|---|---|---|
| `Test_Disable` | BOOL | 0 |
| `ResultAckPending` | BOOL | 0 |
| `ResultAckDelay` | TIMER | preset 500 ms |
| `HandshakeCount` | DINT | 0 — incrementa a cada ciclo completo |
| `LastReturnedResult` | DINT | 0 — copiado de `STROKMATIC_COMM:I.Data[32..35]` no fim de cada ciclo |

> **Convenção de offsets** (alinha com `io_map` default do plc-result-v2):
>
> - Input do PLC (`I.Data`) ← vem do adapter ← plugin escreve em `io:out:<PLC_KEY>`:
>   - `[32..35]` = `result` (u32 little-endian)
>   - `[36]` = `result_write_comp_dev`
>   - `[37]` = `in_cycle`
>   - `[38]` = `fault_reset`
> - Output do PLC (`O.Data`) → vai para o adapter → plugin lê de `io:in:<PLC_KEY>`:
>   - `[32]` = `request_result`
>   - `[33]` = `result_write_comp_plc`
>   - `[34]` = `fault_reset_extend`

**6.6.5 Download e go online:**

- Communications → Who Active → selecione o controller → Download.
- Coloque o PLC em modo **Run**.
- Vá Online; confirme que o módulo `STROKMATIC_COMM` mostra **I/O OK** (ícone verde).

<span class="checkbox">PLC em Run, módulo STROKMATIC_COMM com I/O OK</span>

## 7. Casos de teste

### T1 — Estabelecimento de conexão CIP Class 1

**Objetivo:** confirmar que adapter e PLC estabelecem conexão I/O cíclica.

**Procedimento:**

1. Com tudo rodando da seção 6, verifique no log do adapter:
   ```bash
   docker logs -f strokmatic-eip 2>&1 | grep -i "forward_open\|class.*1\|connection"
   ```
   Esperado: log de `Forward_Open accepted` com Connection ID e RPI igual ao configurado (50 ms).

2. No Studio 5000, painel **Controller Tags → STROKMATIC_COMM:I.Data**: valores estáveis (mesmo que zerados — significa que o PLC está recebendo dados do adapter).

3. No `redis-cli`:
   ```bash
   redis-cli -a "${REDIS_PASSWORD}" strlen io:in:${ADAPTER_IP}
   redis-cli -a "${REDIS_PASSWORD}" strlen io:out:${ADAPTER_IP}
   ```
   Esperado: ambos retornam **128**.

4. No dashboard plc-comm-ops, expanda a linha do `plc-result-v2:${CELL}` e observe o gráfico **cycle µs**: pontos sendo plotados a 1 Hz.

**Critério de aceitação:**

<span class="checkbox">Log do adapter mostra Forward_Open aceito</span><br>
<span class="checkbox">Studio 5000 mostra I/O OK no módulo</span><br>
<span class="checkbox">`io:in:${ADAPTER_IP}` e `io:out:${ADAPTER_IP}` existem e têm 128 bytes</span><br>
<span class="checkbox">Dashboard plc-comm-ops mostra plugin verde, cycle µs ativo</span>

**Falha — diagnóstico:**

- Sem Forward_Open: verifique firewall do Linux (`sudo ufw status`), MAC reachability (`arp -n ${PLC_IP}`).
- I/O Faulted no Studio 5000: provável incompatibilidade do EDS — re-registre EDS, marque "Use Compatible Match".

---

### T2 — Happy path do handshake de resultado

**Objetivo:** validar o ciclo completo PLC → plugin → PLC do handshake de resultado.

**Procedimento:**

1. No Studio 5000, confirme `Test_Disable = 0`.

2. Force `STROKMATIC_COMM:O.Data[32] = 1` (request_result) e meça o tempo até `STROKMATIC_COMM:I.Data[36]` (result_write_comp_dev) ir para 1.
   - No painel Watch, adicione: `STROKMATIC_COMM:O.Data[32]`, `STROKMATIC_COMM:I.Data[32..35]` (result u32), `STROKMATIC_COMM:I.Data[36]`.
   - Tempo esperado: < 200 ms (4 ciclos do plugin a 50 ms).

3. Verifique que `STROKMATIC_COMM:I.Data[32..35]` contém o valor de `result` esperado (depende de como o plugin foi configurado para responder; default v2 deve usar o valor de `RETURNED_RESULT` em Redis).

4. Force `STROKMATIC_COMM:O.Data[33] = 1` (result_write_comp_plc) — o plugin deve ver e fechar o ciclo.

5. Force `STROKMATIC_COMM:O.Data[32] = 0` e `O.Data[33] = 0`. Aguarde 200 ms: o plugin deve retornar todos os outputs (`I.Data[32..38]`) para 0.

6. No dashboard plc-comm-ops, na seção **Live tags** da linha expandida, observe:
   - `state` percorrer **IDLE → REQUESTING → WAITING_RESULT → WROTE_RESULT → IDLE**.
   - `request_result` e `result_write_comp_plc` refletirem os forces do PLC.
   - `result_count` na coluna **Result** incrementar em **+1**.

**Critério de aceitação:**

<span class="checkbox">Ciclo completo: 0 → request → resultado escrito → ack → 0 (sem travar em nenhum estado)</span><br>
<span class="checkbox">Latência total medida ≤ 5 × `cycle_period_ms` (= 250 ms para período 50 ms)</span><br>
<span class="checkbox">`result_count` incrementou exatamente +1</span><br>
<span class="checkbox">`error_count` permaneceu em 0</span>

**Repetir N=10 vezes** (com `HandshakeCount` no ladder fazendo loop automático) e confirmar `result_count` final = +10 sem nenhum erro.

---

### T3 — Hot reload da configuração via dashboard

**Objetivo:** validar que alterações em `cycle_period_ms` via plc-comm-ops surtem efeito **dentro de um ciclo**, sem reiniciar o plugin.

**Procedimento:**

1. No dashboard, na linha do `plc-result-v2:${CELL}` expandida, observe `Period` = 50.

2. Na seção **Config (edit)**, altere `cycle_period_ms` de **50** para **100**. Clique **Save**.

3. Observe (sem recarregar):
   - Feedback "Saved" verde.
   - Coluna **Period** muda para 100 dentro de 1–2 segundos.
   - Gráfico **cycle µs** continua plotando sem gap.
   - **state** continua percorrendo o ciclo (se o PLC estiver no loop T2).

4. Em paralelo, monitore Redis:
   ```bash
   redis-cli -a "${REDIS_PASSWORD}" xrange audit:plc-result-v2:${CELL} - + COUNT 5
   ```
   Esperado: entrada nova com `field_path=cycle_period_ms`, `old=50`, `new=100`, `actor=<seu_IP>`.

5. Reverta para 50 e repita o ciclo.

**Critério de aceitação:**

<span class="checkbox">Save retorna sucesso (303) e UI atualiza sem reload manual</span><br>
<span class="checkbox">Plugin adota o novo período dentro de 2 s</span><br>
<span class="checkbox">Stream de auditoria contém a entrada da mudança</span><br>
<span class="checkbox">Nenhum erro no `error_count` durante a transição</span>

---

### T4 — Concorrência otimista (conflict 409)

**Objetivo:** validar o caminho de conflito do `WATCH/MULTI/EXEC` no save.

**Procedimento:**

1. Abra **duas abas** do navegador apontando para o dashboard.
2. Em ambas, expanda a linha `plc-result-v2:${CELL}`.
3. Na **aba 1**, altere `cycle_period_ms` para 75, clique Save. Confirmação verde.
4. Na **aba 2** (que ainda mostra o valor antigo no campo), altere para 80 e clique Save **sem recarregar a aba**.
5. Esperado na aba 2: mensagem vermelha **"Conflict — reloading"**; o formulário recarrega com o valor 75.
6. Re-aplique 80 na aba 2 e salve. Sucesso.

**Critério de aceitação:**

<span class="checkbox">Aba 1 salvou sem problema</span><br>
<span class="checkbox">Aba 2 recebeu 409 e mensagem clara para o operador</span><br>
<span class="checkbox">Reaplicar valor após reload do formulário funcionou</span>

---

### T5 — Injeção manual (modo bancada sem efeito no PLC real)

**Objetivo:** demonstrar o painel de injeção em uso de depuração.

> **Importante:** Em bancada com PLC conectado, escritas em `io:in:<plc_key>` são **sobrescritas pelo adapter no próximo ciclo CIP** (~50 ms). Esse teste valida o caminho da UI, não a lógica do plugin (que é exercitada pelo PLC real em T2).

**Procedimento:**

1. No painel **Inject** da linha expandida, selecione `cfg · cycle_period_ms`, digite `120`, clique Inject, confirme.
2. Esperado: feedback verde "OK", coluna Period muda para 120 dentro de 2 s, audit emite entrada.
3. Selecione `get_result · ${ADAPTER_IP}_GET_RESULT_CONFIRM`, digite `1`, Inject, confirme.
4. Esperado: `redis-cli -a "${REDIS_PASSWORD}" get ${ADAPTER_IP}_GET_RESULT_CONFIRM` retorna `"1"`.
5. Selecione `io:in · request_result`, digite `1`, Inject, confirme.
6. Esperado: a injeção retorna OK; **na sequência o PLC sobrescreve o byte** (verificável via `redis-cli getrange io:in:${ADAPTER_IP} 32 32` que volta a `\x00` em < 100 ms). Esse é o comportamento correto — não é uma falha do inject.

**Critério de aceitação:**

<span class="checkbox">Injeção em `cfg` propaga e aparece na auditoria</span><br>
<span class="checkbox">Injeção em `get_result_*` é persistente (não é sobrescrita por ninguém)</span><br>
<span class="checkbox">Injeção em `io:in:*` é aceita pelo backend e em seguida sobrescrita pelo adapter (esperado)</span><br>
<span class="checkbox">Toda injeção gerou entrada no `audit:` stream com `field_path=inject:*`</span>

---

### T6 — Resiliência: queda e reconexão

**Objetivo:** validar comportamento de cada componente sob falhas.

#### T6.1 — Restart do plugin

```bash
docker restart plc-result-v2
```

- Dashboard mostra a linha do plugin **vermelha** dentro de 60 s (heartbeat antigo).
- Quando o plugin volta (~5 s), ela volta a **verde**. O `result_count` continua de onde parou (Redis preserva `status:*`).
- Trendline tem um **gap** (samples não acumularam enquanto o plugin estava offline).
- Verifique no Studio 5000: o módulo continua com I/O OK (o adapter permanece em conexão CIP com o PLC; ele só não tem aplicação que processa o lane do plc-result enquanto o plugin está caído).

<span class="checkbox">Recuperação automática do plugin sem intervenção do operador</span>

#### T6.2 — Restart do adapter

```bash
docker restart strokmatic-eip
```

- Studio 5000: módulo entra em **I/O Faulted** por alguns segundos, depois retorna a OK quando a conexão CIP re-estabelece.
- `cycle µs` no dashboard tem um gap de ~5–10 s.
- Tudo recupera sem que nenhum cfg ou status seja perdido.

<span class="checkbox">PLC re-conecta sozinho após restart do adapter</span>

#### T6.3 — Desconectar cabo do PLC

- Remova o cabo Ethernet do PLC por 10 s.
- Studio 5000: I/O Faulted.
- Dashboard: o plugin continua emitindo heartbeats (ele lê `io:in:*` mas o conteúdo fica congelado em `\x00` após o timeout do adapter); `state` deve ir para IDLE.
- Reconecte: tudo volta dentro de ~5 s.

<span class="checkbox">Reconexão limpa, sem ações manuais</span>

---

### T7 — Estabilidade temporal (24 horas)

**Objetivo:** validar drift, vazamento de memória, crescimento patológico de Redis.

**Procedimento:**

1. Configure o ladder do PLC para **loop contínuo** do ciclo T2, com `ResultAckDelay` preset = 100 ms (≈ 1 handshake por 0.5 s; ≈ 172 800 handshakes em 24 h).

2. Inicie o cronograma:
   ```bash
   date > /tmp/bench-t7-start.txt
   docker stats strokmatic-eip plc-result-v2 plc-comm-ops redis-bench > /tmp/bench-t7-stats.log &
   ```

3. Após 24 horas:
   ```bash
   date > /tmp/bench-t7-end.txt
   redis-cli -a "${REDIS_PASSWORD}" hget status:plc-result-v2:${CELL} result_count
   redis-cli -a "${REDIS_PASSWORD}" hget status:plc-result-v2:${CELL} error_count
   redis-cli -a "${REDIS_PASSWORD}" memory usage io:in:${ADAPTER_IP}
   redis-cli -a "${REDIS_PASSWORD}" xlen audit:plc-result-v2:${CELL}
   ```

**Critério de aceitação:**

<span class="checkbox">`result_count` ≥ 150 000 (margem para variação no ladder)</span><br>
<span class="checkbox">`error_count` ≤ 5 (qualquer erro deve ter explicação no log; idealmente 0)</span><br>
<span class="checkbox">Memória do `strokmatic-eip` cresceu ≤ 20 % vs. baseline</span><br>
<span class="checkbox">Memória do `plc-result-v2` cresceu ≤ 20 %</span><br>
<span class="checkbox">`xlen audit:*` ≤ 10 000 (capado corretamente)</span>

---

### T8 — Medição de latência ponto a ponto

**Objetivo:** quantificar a latência adicionada pela stack vs. o RPI mínimo.

**Procedimento:**

1. Ative o `ResultAckDelay.PRE = 0` (sem atraso intencional no ladder).
2. No Studio 5000, abra **Trends → New Trend**:
   - Tag 1: `STROKMATIC_COMM:O.Data[32]` (request)
   - Tag 2: `STROKMATIC_COMM:I.Data[36]` (result_write_comp_dev)
   - Sample period: 10 ms
   - Duration: 60 s
3. Force pulsos manualmente em `O.Data[32]` (ou use uma rotina pulsante a 1 Hz).
4. Exporte o trend para CSV e calcule:
   - Latência média = média(`time(I.Data[36]==1)` − `time(O.Data[32]==1)`).
   - p95 e p99.
   - Repetir com `cycle_period_ms` em 10, 25, 50, 100, 250 ms (alterar via plc-comm-ops).

**Critério de aceitação:**

<span class="checkbox">Latência média ≤ 4 × `cycle_period_ms`</span><br>
<span class="checkbox">p99 ≤ 6 × `cycle_period_ms`</span><br>
<span class="checkbox">Sem outliers > 10 × `cycle_period_ms` (indicariam contenção em Redis ou GC do Python)</span>

Registre os resultados em uma tabela:

| `cycle_period_ms` | Latência média (ms) | p95 | p99 | Max |
|---|---|---|---|---|
| 10 | | | | |
| 25 | | | | |
| 50 | | | | |
| 100 | | | | |
| 250 | | | | |

## 8. Critérios de aceitação consolidados

Para que a bancada seja considerada **aprovada para próxima fase** (piloto em planta), todos os checkboxes de T1–T8 devem estar verdes. Casos de teste opcionais (T6.3 desconexão de cabo, T7 24 h) podem ser executados em ciclos posteriores se o cronograma apertar — mas T1, T2, T3, T8 são bloqueantes.

## 9. Coleta de evidências

Para cada caso de teste, salvar em uma pasta `/tmp/bench-<DATA>/`:

- **Screenshot** do dashboard plc-comm-ops mostrando o estado relevante.
- **Export do Studio 5000** (CSV de trends, screenshot do Watch panel).
- **Dump do Redis**: `redis-cli ... -a "${REDIS_PASSWORD}" --rdb /tmp/bench-<data>/dump.rdb` no início e no fim.
- **Logs**: `docker logs strokmatic-eip plc-result-v2 plc-comm-ops > /tmp/bench-<data>/<container>.log`.
- **Stream de auditoria**: `redis-cli -a "${REDIS_PASSWORD}" xrange audit:plc-result-v2:${CELL} - + > audit.txt`.

Arquive em `evidences/bench-<DATA>/` no repositório `strokmatic/eip-bench-evidence` (criar privado se ainda não existir).

## 10. Teardown e cleanup

Após concluir, opcionalmente preserve o ambiente para próximos ciclos. Para limpar tudo:

```bash
docker stop plc-result-v2 plc-comm-ops strokmatic-eip redis-bench
docker rm plc-result-v2 plc-comm-ops strokmatic-eip redis-bench

# Limpar imagens de bancada (NÃO mexa em imagens de produção)
docker rmi plc-result-v2:bench plc-comm-ops:bench strokmatic-eip:bench
```

No PLC: coloque o controller em **Program** mode; desabilite o módulo `STROKMATIC_COMM` (botão direito → Inhibit) se quiser preservar o projeto sem manter a conexão tentando.

---

## Apêndice A — Referência rápida da identidade EDS

| Campo | Valor |
|---|---|
| Vendor Code | **9876** (Strokmatic) |
| Product Type | **0x002B** (Generic Device) |
| Product Code | **1** (placeholder até ODVA atribuir definitivo) |
| Major.Minor revision | **1.0** |
| Product Name | `STROKMATIC-COMM-V1` |
| Input Assembly (T→O) | instância **100**, **128 bytes** (SINT[128]) |
| Output Assembly (O→T) | instância **150**, **128 bytes** (SINT[128]) |
| Config Assembly | instância **151**, **10 bytes** (típico vazio) |
| RPI default | **30 ms** (faixa 20–30 ms no EDS; CompactLogix aceita 50 ms confortavelmente) |

> Notas:
>
> - O Vendor Code 9876 está em **status de Reserve** na ODVA desde 2025-10-06. Para certificação formal de produção precisaremos reativar a associação (custo + reaplicação). Para a bancada não importa — o PLC não valida Vendor Code contra registro ODVA durante I/O.
> - O ProductCode 1 é placeholder. Quando ODVA atribuir o definitivo, o EDS precisa ser re-emitido (mudança em `cert/EDS_REVISION` + rebuild).

## Apêndice B — Estrutura completa do programa Studio 5000

Arquivo a importar: `bench/handshake-test.L5X` (a ser entregue junto deste procedimento; estrutura abaixo é a especificação).

**Tags do controller:**

```
STROKMATIC_COMM           Module      (auto-gerado pelo Generic Ethernet Module)
Test_Disable              BOOL        := 0   ;; habilita/desabilita o loop de teste
HandshakeCount            DINT        := 0   ;; contador de handshakes completos
LastReturnedResult        DINT        := 0   ;; espelho de I.Data[32..35] após cada ciclo
ResultAckPending          BOOL        := 0
ResultAckDelay            TIMER       := { .PRE := 500 }
RequestTimer              TIMER       := { .PRE := 1000 }   ;; spacing entre requests
```

**Rotina `MainRoutine` (JSR para Handshake_Test):**

```
[ JSR  Handshake_Test ]
```

**Rotina `Handshake_Test` (ladder):**

```
Rung 0:   Generate request pulse every 1 s when not disabled
─── XIO Test_Disable ──── TON RequestTimer  PRE=1000  ───── (DN ResetThis) ─

Rung 1:   On RequestTimer.DN, set request_result
─── XIC RequestTimer.DN ─── MOV 1 STROKMATIC_COMM:O.Data[32] ───

Rung 2:   When plugin acks (result_write_comp_dev),
          capture result and prepare to ack
─── XIC STROKMATIC_COMM:I.Data[36] ── XIO ResultAckPending ──┐
                                                              │
       ┌──── OTL ResultAckPending ────────────────────────────┘
       ├──── COP STROKMATIC_COMM:I.Data[32]  LastReturnedResult  1
       └──── ADD HandshakeCount  1  HandshakeCount

Rung 3:   Hold the ack for ResultAckDelay then release everything
─── XIC ResultAckPending ─── TON ResultAckDelay  PRE=200 ──┐
                                                            │
─── XIC ResultAckDelay.DN ─┐                                │
                            ├── MOV 0 STROKMATIC_COMM:O.Data[32]
                            ├── MOV 0 STROKMATIC_COMM:O.Data[33]
                            ├── OTU ResultAckPending
                            └── RES RequestTimer
```

Rotina rápida em texto estruturado para T7 (loop contínuo), opcional.

## Apêndice C — Comandos úteis durante o teste

```bash
# Observar todo o tráfego entre plugins via Redis
redis-cli -a "${REDIS_PASSWORD}" monitor | grep -E "(io:|cfg:|status:|tags:|audit:)" | head -100

# Snapshot completo do estado
redis-cli -a "${REDIS_PASSWORD}" keys 'plc-*' 'io:*' 'cfg:plc-*' | while read k; do
  echo "=== $k ==="
  redis-cli -a "${REDIS_PASSWORD}" type "$k"
done

# Dump dos bytes do lane (em hex)
redis-cli -a "${REDIS_PASSWORD}" get io:in:${ADAPTER_IP}  | xxd | head -5
redis-cli -a "${REDIS_PASSWORD}" get io:out:${ADAPTER_IP} | xxd | head -5

# Forçar um snapshot do status para o relatório
redis-cli -a "${REDIS_PASSWORD}" hgetall status:plc-result-v2:${CELL}

# Capturar pacotes CIP para análise pós-mortem (Wireshark)
sudo tcpdump -i ${NET_IFACE} -w /tmp/bench-cip.pcap \
  'host ${PLC_IP} and (tcp port 44818 or udp port 2222)'
```

## Apêndice D — Histórico de execução

Preencha após cada rodada:

| Data | Executor | Versões testadas | Resultado | Notas |
|---|---|---|---|---|
| | | | | |
| | | | | |

---

<div class="callout callout-info">
<strong>Em caso de falha bloqueante</strong><br>
Capture: <code>docker logs strokmatic-eip</code> completo + tcpdump CIP de pelo menos 30 s + dump RDB do Redis. Abra issue em <code>strokmatic/strokmatic-eip</code> referenciando este procedimento e a tabela do Apêndice D.
</div>
