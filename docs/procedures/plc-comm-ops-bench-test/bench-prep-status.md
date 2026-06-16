# Status de Preparação — Bancada PLC Comm Ops

**Data da preparação:** 2026-05-13
**Máquina:** este PC (IP planejado: `192.168.15.204` / iface `enp0s31f6`)
**PLC alvo:** CompactLogix `192.168.15.123`
**Workstation Studio 5000:** `192.168.15.254`
**Procedimento de teste:** [procedure.md](procedure.md)

---

## O que está pronto AGORA

### Imagens Docker (buildadas, na máquina)

| Imagem | Tag | Tamanho | Origem |
|---|---|---|---|
| `strokmatic-eip` | `bench` | 75.3 MB | `/home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip` master @ `911b38d` |
| `plc-result-v2` | `bench` | 254 MB | `/home/teruel/worktrees/plc-result-v2` `v2/sdk-based` @ `87e0498` |
| `plc-comm-ops` | `bench` | 283 MB | `/home/teruel/worktrees/plc-comm-ops-v1.1` `feat/v1.1` @ `0b94433` |

> Para rebuildar do zero, ver seção **Rebuild** abaixo.

### Containers rodando

| Container | Status | Porta | Propósito |
|---|---|---|---|
| `redis-bench` | up | `127.0.0.1:6380` → 6379 | Redis isolado para a bancada |

Detalhes do redis-bench:
- Imagem: `redis:7`
- Auth: **password obrigatória** (variável: `REDIS_BENCH_PASS="bench@@2026"`)
- Sem persistência (`--save "" --appendonly no`) — config volátil entre reboots, intencional.

### Fixes de código aplicados durante o prep

| Repo | Branch | Commit | Mudança |
|---|---|---|---|
| `plc-result-v2` | `v2/sdk-based` | `e2f11f8` | Dockerfile: `RUN --mount=type=ssh` para o build do SDK |
| `plc-result-v2` | `v2/sdk-based` | `87e0498` | `__main__.py`: lê `REDIS_PASSWORD`/`REDIS_APP_PASSWORD` |
| `plc-comm-ops` | `feat/v1.1` | `0b94433` | `settings.py` + `app.py`: campo opcional `redis_password` |

Todos commitados localmente, **não pushados**. Push pode ser feito depois da bancada (junto com os resultados de teste).

### Verificações de smoke executadas

| Smoke | Resultado |
|---|---|
| `redis-bench` ping com password | PONG |
| Banner do `strokmatic-eip:bench` na iface `lo` | Boot limpo, autentica no redis-bench, encerra com SIGTERM esperado |
| `plc-result-v2:bench` contra `redis-bench` (com password) | Heartbeat verde, schema publicado, tags publicadas |
| `plc-comm-ops:bench` em `:8200` contra `redis-bench` | Dashboard JSON retorna o plugin BENCH01 com `health=green` |

---

## O que falta SÓ NO DIA DA BANCADA

### Pré-bancada (5 min)

1. **Sair da VPN** (`tun0`) — durante o teste a rota para `192.168.15.0/24` precisa ir pelo cabo, não pelo túnel.
2. **Conectar o cabo Ethernet** no `enp0s31f6` (porta wired onboard) na bancada/switch.
3. **Subir a interface com IP estático:**

   ```bash
   sudo ip link set enp0s31f6 up
   sudo ip addr flush dev enp0s31f6
   sudo ip addr add 192.168.15.204/24 dev enp0s31f6
   # Não setar default gateway — não queremos que tráfego geral vá pra rede industrial.
   ip addr show enp0s31f6                            # confirma 192.168.15.204
   ping -c 3 192.168.15.123                          # PLC responde
   ping -c 3 192.168.15.254                          # workstation responde
   ```

   > Alternativa via NetworkManager (persiste reboots):
   > ```bash
   > sudo nmcli con add type ethernet ifname enp0s31f6 con-name bench-strokmatic-eip \
   >     ipv4.addresses 192.168.15.204/24 ipv4.method manual \
   >     ipv4.ignore-auto-dns yes ipv4.never-default yes
   > sudo nmcli con up bench-strokmatic-eip
   > ```

4. **Verificar portas livres no host** (44818/tcp, 2222/udp):

   ```bash
   sudo ss -tlnp | grep -E ':(44818)'                # vazio
   sudo ss -ulnp | grep -E ':(2222)'                 # vazio
   ```

### Subir a stack (3 min)

```bash
export REDIS_BENCH_PASS="bench@@2026"
export ADAPTER_IP="192.168.15.204"
export CELL="BENCH01"
export NET_IFACE="enp0s31f6"

# (1) redis-bench já está up — confirmar
docker exec redis-bench redis-cli -a "$REDIS_BENCH_PASS" --no-auth-warning ping
# → PONG

# (2) Adaptador strokmatic-eip
docker run -d --name strokmatic-eip \
  --network host --privileged \
  -e REDIS_HOST=127.0.0.1 -e REDIS_PORT=6380 -e REDIS_PASSWORD="$REDIS_BENCH_PASS" \
  -e PLC_KEY="$ADAPTER_IP" \
  --restart unless-stopped \
  strokmatic-eip:bench "$NET_IFACE"

docker logs strokmatic-eip 2>&1 | tail -20            # buscar "Forward_Open" quando o PLC conectar

# (3) plc-result-v2 — primeiro, seedar cfg
docker exec redis-bench redis-cli -a "$REDIS_BENCH_PASS" --no-auth-warning SET "cfg:plc-result-v2:$CELL" "$(cat <<EOF
{"plc_key": "$ADAPTER_IP", "cell": "$CELL", "tryout": false, "cycle_period_ms": 50,
 "redis_app_host": "localhost", "redis_app_port": 6379,
 "get_result_key": "${ADAPTER_IP}_GET_RESULT",
 "get_result_confirm_key": "${ADAPTER_IP}_GET_RESULT_CONFIRM",
 "returned_result_key": "${ADAPTER_IP}_RETURNED_RESULT",
 "io_map": {"request_result_off": 32, "result_write_comp_plc_off": 33, "fault_reset_extend_off": 34,
            "result_off": 32, "result_write_comp_dev_off": 36, "in_cycle_off": 37, "fault_reset_off": 38}}
EOF
)"

docker run -d --name plc-result-v2 \
  --network host \
  -e REDIS_HOST=127.0.0.1 -e REDIS_PORT=6380 -e REDIS_PASSWORD="$REDIS_BENCH_PASS" \
  -e PLC_KEY="$ADAPTER_IP" -e CELL="$CELL" \
  --restart unless-stopped \
  plc-result-v2:bench

# (4) plc-comm-ops (UI)
docker run -d --name plc-comm-ops \
  --network host \
  -e REDIS_HOST=127.0.0.1 -e REDIS_PORT=6380 -e REDIS_PASSWORD="$REDIS_BENCH_PASS" \
  -e PORT=8200 \
  --restart unless-stopped \
  plc-comm-ops:bench
```

Validar antes de tocar no PLC:

```bash
curl -sS http://127.0.0.1:8200/healthz                                            # ok
curl -sS http://127.0.0.1:8200/api/dashboard.json | python3 -m json.tool          # plc-result-v2:BENCH01 verde
docker logs strokmatic-eip 2>&1 | tail
docker logs plc-result-v2 2>&1 | tail
docker logs plc-comm-ops 2>&1 | tail
```

Abrir no navegador: `http://127.0.0.1:8200/` ou `http://192.168.15.204:8200/`.

### Programar o PLC (15-20 min se for primeira vez)

Seguir [procedure.md](procedure.md) seção 6.6:

1. Copiar `eds/STROKMATIC-COMM-V1.eds` para a workstation Windows 192.168.15.254.
2. EDS Hardware Installation Tool → Register an EDS file → confirma.
3. Studio 5000 → New project → CompactLogix do modelo certo → IP 192.168.15.123.
4. I/O Configuration → Ethernet → Add Module → Generic Ethernet Module:
   - Name: `STROKMATIC_COMM`
   - Comm Format: **Data – SINT**
   - IP: **192.168.15.204**
   - Input: instance **100**, **128 SINT**
   - Output: instance **150**, **128 SINT**
   - Config: instance **151**, **0 SINT**
   - RPI: **50 ms**
   - Use *Compatible Match* (ProductCode 1 ainda é placeholder)
5. Ladder do Apêndice B do procedure.md.
6. Download → modo Run.

### Casos de teste

T1–T8 documentados em [procedure.md](procedure.md) seção 7. Caderno de notas: usar a tabela do Apêndice D pra anotar resultado de cada caso.

---

## Diferenças vs. o procedure.md original

Itens que foram **ajustados durante o prep** e estão refletidos acima:

| Item | procedure.md diz | Realidade pós-prep |
|---|---|---|
| Porta da UI | `8000` | `8200` (8000 ocupado pelo Portainer) |
| Porta do Redis | `6379` | **6380** (host port; isolado do `sdk-test-redis` em 6379) |
| `REDIS_PASSWORD` no plc-comm-ops | mencionado | **agora funciona** — fix em `0b94433` |
| Build do plc-result-v2 | implícito | precisa de `--ssh default` — fix em `e2f11f8` |
| Iface do adapter | `enp4s0` (exemplo do docker-compose) | **enp0s31f6** (wired desta máquina) |

---

## Rebuild (se algum repo mudar antes da bancada)

```bash
# strokmatic-eip
cd /home/teruel/JARVIS/workspaces/strokmatic/sdk/strokmatic-eip
git pull --ff-only origin master   # se houver novidade
DOCKER_BUILDKIT=1 docker build --ssh default -t strokmatic-eip:bench .

# plc-result-v2
cd /home/teruel/worktrees/plc-result-v2
DOCKER_BUILDKIT=1 docker build --ssh default -f plc-result-v2.Dockerfile -t plc-result-v2:bench .

# plc-comm-ops
cd /home/teruel/worktrees/plc-comm-ops-v1.1
DOCKER_BUILDKIT=1 docker build --ssh default -f plc-comm-ops.Dockerfile -t plc-comm-ops:bench .
```

---

## Limpeza após a bancada

```bash
docker stop plc-comm-ops plc-result-v2 strokmatic-eip
docker rm   plc-comm-ops plc-result-v2 strokmatic-eip
# Deixe redis-bench rodando se quiser preservar o estado pra análise pós-mortem.
# Para limpar tudo, inclusive Redis:
docker stop redis-bench && docker rm redis-bench

# Remover IP estático e voltar pra DHCP / VPN
sudo nmcli con down bench-strokmatic-eip
sudo nmcli con delete bench-strokmatic-eip
```

---

## Notas e gotchas

- **VPN ativa derruba o teste:** `tun0` faz com que rotas para `192.168.15.0/24` vão pela VPN; **desconectar VPN antes** de subir o adapter.
- **`--network host` é obrigatório** para o strokmatic-eip (CIP precisa de raw sockets/multicast L2).
- **`--privileged`** necessário no adapter — alternativa: `--cap-add NET_RAW --cap-add NET_ADMIN` (não testado nesta versão).
- **ProductCode 1 no EDS é placeholder** — usar *Compatible Match* no Generic Ethernet Module pra evitar erro de matching.
- **`fault_extend_enabled` NÃO existe no schema** do plc-result-v2 — corrigir o seed do procedure.md se for usar como referência (ou pular esse campo).
- **`io_map.result_off = 32`** está correto mesmo "colidindo" com `request_result_off`: result está em `io:out:*` e request_result em `io:in:*` — keyspaces diferentes.
