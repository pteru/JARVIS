---
type: Design Spec
title: VisionKing image-saver — Throughput 300 fps (conexão AMQP persistente + conserto do runner async)
description: Elevar o teto de throughput do image-saver de ~150 fps para ≥300 fps sustentados (75 fps × 4 câmeras no pico real da linha 03002), eliminando a conexão AMQP por mensagem do publisher sync e consertando o runner async que hoje é um no-op por bug de decorator.
tags: [visionking, image-saver, throughput, rabbitmq, aio-pika, burnin, "03002"]
timestamp: 2026-07-12
project: "03002"
product: VisionKing
language: pt-BR
status: draft
---

# VisionKing image-saver — Throughput 300 fps (Design)

**Projeto:** 03002 — VisionKing ArcelorMittal<br>
**Data:** 2026-07-12<br>
**Autor:** Pedro Teruel (teruel@strokmatic.com)<br>
**Status:** Draft — aguardando revisão do Pedro (não commitado)

---

## 1. Motivação e evidência (burnin bancada 2026-07-12)

As câmeras reais do 03002 entregam **75 fps por câmera** (300 fps agregados por
ponto) durante a passagem da barra. O histórico de produção mostra ~136 fps
**médios** (490k frames/h) — a diferença é o duty cycle (~45%): o Redis absorve
o burst e drena nos gaps entre barras. O burnin de bancada quantificou pela
primeira vez o teto real do image-saver:

| Condição | Throughput medido |
|---|---|
| CPU limitada a 0.9 core (yml herdado do c007) | ~90-100 fps |
| Sem limite de CPU, db0 limpo (vk01/vk02) | **163/165 e 144/146 fps** |
| Com backlog de ~200k keys no db0 (SCAN degradado) | ~90-100 fps |
| Oferta de 300 fps | ~150/s **expiram por TTL sem processar** |

Conclusões:
1. O teto (~150-165 fps) é **latency-bound, não CPU-bound** (IS usa ~1,2 core
   de 32; ~120 ms de parede por hash nas 20 threads).
2. A produção atual **sempre operou colada no teto** (média 136 vs teto ~165,
   margem <20%). Qualquer aumento de duty cycle ou de resolução derruba a margem.
3. Backlog no Redis **realimenta a degradação**: quanto mais atraso, mais lento
   o `read_all_hashes` (SCAN sobre keyspace grande).

## 2. Causas raiz (análise de código)

### 2.1 Publisher sync: 1 conexão AMQP por mensagem

`src/communication_clients/rabbit_client.py` — `send_message()` chama
`declare_rabbit_connection()` a **cada mensagem**: `pika.BlockingConnection`
nova (handshake TCP+AMQP), channel novo, `queue_declare` por fila, publish,
close. Custo fixo de ~10-15 ms/mensagem, serializado pelo GIL entre as 20
threads. **Idêntico byte a byte ao `is-sis-surface:c007`** — dívida herdada,
não regressão da 2026.07.

Custos por hash (~120 ms de parede): HMGET do payload com imagem (~0,5 MB),
gravação do `.bin` em disco, handshake AMQP ×1 (2 publishes na mesma conexão:
`inference-queue` + `frame-queue`), contenção de GIL.

### 2.2 Runner async: no-op por decorator síncrono

A solução async já existe na imagem (`visionking-image-saver-async.py`,
`hash_processor_async.py`, `rabbit_client_async/` com `aio_pika.connect_robust`
e channel persistente), mas **nunca funcionou**: canary em 2026-07-12 processou
**0 hashes** (db0 crescendo à taxa plena de injeção, loop girando em 20 µs).

Causa raiz — `src/utils/loop_timer.py:14`:

```python
def wrapper(*args, **kwargs):
    while True:
        start_time = time.time()
        func(*args, **kwargs)          # <- p/ função async: cria a coroutine
                                       #    e DESCARTA sem await. Corpo nunca roda.
```

`@enforce_time_limit` é o driver do loop principal (correto no sync). Aplicado
ao `main_async`, cria coroutines órfãs para sempre. O `asyncio.run()` do wrapper
sync em `hash_processor_async.main()` nunca chega a rodar o event loop de verdade.

### 2.3 Agravantes secundários

- **Limite de CPU 0.9** nos ymls (herança do template c007) — já removido na
  bancada; propagar para topologies/deploys.
- **Log INFO por conexão** ("Attempting/Successfully connected") — a 150 fps
  são ~9k linhas/min, mascarando erros reais.
- `RedisClient.read_fields_from_hash` (linha 95): `value if value else None`
  converte valores falsy em `None` (coberto pelo drop-None do PR
  visionking-image-saver#75, mas a semântica da camada merece revisão).

## 3. Objetivo

**≥300 fps sustentados por ponto** (com margem ≥30% acima do pico real), sem
perda nem acúmulo no Redis, mantendo o wire format atual (dict-repr) para não
quebrar consumidores (frame-writer, inference).

## 4. Proposta

### Fase 1 — Quick win no sync (baixo risco, 1 dia)

Conexão persistente por thread no `RabbitClient`:

- `threading.local()` com conexão + channel abertos sob demanda e reusados;
  `queue_declare` uma única vez por (thread, fila), cacheado em set.
- Reconexão on-error: capturar `AMQPConnectionError/StreamLostError`, invalidar
  a conexão da thread e refazer no próximo send (mesma semântica de retry atual).
- Rebaixar logs de conexão para DEBUG; INFO só em reconexão pós-falha.

Estimativa de ganho: elimina ~30-40% do custo por mensagem → teto projetado
~230-280 fps. Pode não bastar sozinho para 300 — por isso Fase 2.

### Fase 2 — Consertar o runner async (alvo definitivo)

1. `enforce_time_limit` async-aware:

```python
def enforce_time_limit(time_limit):
    def decorator(func):
        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def awrapper(*args, **kwargs):
                while True:
                    start = time.monotonic()
                    await func(*args, **kwargs)
                    elapsed = time.monotonic() - start
                    if elapsed < time_limit:
                        await asyncio.sleep(time_limit - elapsed)
            return awrapper
        # ... wrapper sync existente
```

2. `hash_processor_async.main()`: `asyncio.run(main_async(...))` passa a rodar
   o loop de verdade; conexão aio-pika aberta **uma vez fora do loop** (hoje o
   `main_async` conecta/fecha por iteração — mover connect/close para o driver).
3. HMGET e gravação de disco dentro de `asyncio.to_thread` (ou executor) para
   não bloquear o event loop (payload ~0,5 MB por frame).
4. Teto projetado: >500 fps (publisher deixa de ser gargalo; novo limitante
   passa a ser disco/Redis).

### Fase 3 — Validação em bancada (burnin)

Critérios de aceite, com o harness fixed-mode existente (`/opt/burnin`):

1. `--mode fixed --fps 300`, 4 câmeras, 2 h: db0 estável (<5k keys), 0 perdas
   por TTL, frames/s = 300 no Postgres dos dois hosts.
2. `--mode saturation` 1 h: teto medido ≥400 fps.
3. Kill-test do RabbitMQ (restart do broker) durante o fixed: reconexão
   automática sem mensagens perdidas nem crash.
4. Regressão funcional: payload byte-idêntico ao atual (dict-repr, bytes)
   validado por consumer de teste; suíte pytest existente verde.

## 5. Rollout

1. PR no `visionking-image-saver` (base develop; repo fora do dev-bot) — Fase 1
   e Fase 2 podem ser PRs separados.
2. Build `visionking-image-saver:2026.08` (ou `2026.07.1`) via pipeline atual.
3. Canary vk02 → vk01 com o padrão preupgrade/rollback já estabelecido.
4. Atualizar topologies/deploys: remover `cpus: "0.9"` (como feito na bancada)
   e, quando a Fase 2 estabilizar, trocar o `command` default para o runner async.

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Conexão persistente mascarar half-open TCP (VPN/planta) | heartbeat=30 já configurado; kill-test da Fase 3 |
| Async mudar ordem/timing das mensagens | wire format e filas inalterados; consumers já toleram concorrência (20 threads hoje) |
| `to_thread` esconder erros de disco | manter `data_process_checker` (só deleta hash com image+data OK) |
| Regressão no caminho PLY (3D) | caso de teste com `has_ply` no pytest |

## 7. Fora de escopo

- Migração do wire format dict-repr → JSON (bloqueada até coordenar com
  frame-writer; rastreada à parte).
- Sharding/replicação do image-saver (N instâncias) — desnecessário se Fase 2
  atingir o alvo.
- TTL/gate do injector de burnin (ferramenta de teste, não produto).
