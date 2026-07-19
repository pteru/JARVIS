---
type: Session Log
title: "IRIS 03007 — Snapshot 3, R033 teste cíclico, RestPos=5, pacote 5 + bench-panel + sdk-plc-toolkit"
description: "Revisão do snapshot 3 (AOI viva = 1.5b rotulada 1.6!), mistério do jog simultâneo resolvido, R033 aprovado como teste cíclico configurável, RestPos_mm=5.0 decidido, pacote 5 e bench-panel despachados, novo repo sdk-plc-toolkit (plctk tag logger)."
session: 2026-07-16
tags: [iris-plc-rewire, iris-scds, "03007", automacao, plc, cia402, bench-panel]
timestamp: 2026-07-16
product: IRIS
language: pt-BR
---

# IRIS 03007 — Snapshot 3 + R033 + pacote 5 + ferramentas (madrugada pós-bench)

## Feito
- **Revisão do snapshot `(3).L5X`** (`plc/2026.07.15_revisao-snapshot3/REVISAO-snapshot3.md`):
  delta mínimo (só R005 e R040); errata 2 aplicada ✓ (`CarPresent=0`); JSR do R007 ok, sem AFI;
  **soft-limits dos 4 eixos corrigidos** `[0,+1245]` ✓; nenhuma edição online em R010/R020/R030
  → **todos os pacotes pendentes importam sem perder nada**. ⚠ **AOI viva = Rev 1.5b DESCARTADA
  rotulada "1.6"** — verificação pós-import da 1.6 real é POR MARCADOR (`JogUnhomedSpan_mm`
  presente, `16#021F` ausente). Bypasses ativos: deadman=1e8, `JogOpenDir=0`, `SafeSoftLim*`=0,
  órfãs não apagadas, `Servo3/4.JogVel=1000`.
- **Mistério do jog simultâneo 3+4 resolvido**: o hack do Thiago (3 rungs no R040 injetando
  botões dos 2 eixos) é **INERTE** — a exclusividade do R030 bloqueia 2 JogReq simultâneos, e o
  R030 é clear-then-set (zera os inputs da AOI todo scan). O movimento simultâneo visto em campo
  só pode ter ocorrido com **R030 em AFI ou forces** — a AOI é per-axis, sem exclusividade.
  Resíduo do hack quebra o jog individual dos eixos 3/4 → remover (pacote 5).
- **R033_TestMotion especificado pelo Pedro e APROVADO** (rascunho em revisao-snapshot3/):
  teste cíclico configurável — eixos por checkbox (qualquer combinação), perfil vel/acc/dec com
  captura/restauração dos Rcp*, **Centro=500/Intervalo=600 configuráveis** (A/B derivados e
  congelados no Start), dwell, timeout por perna, contador de ciclos; Start recusado com
  `TestSt_RejectCode` (não homado/modo/interlock/config fora da janela/sem eixo); anticolisão
  ABORTA sempre; parada = padrão Rev 1.6 (Halt até standstill); **arbitragem última-escritora**
  (JSR entre R030 e R040, zero mudança no R030). §5 = espec da aba do bench-panel (tag↔controle).
- **`RestPos_mm` explicado e decidido: 5.0 mm** (⚠ exatamente a borda `SoftLimitNeg+SoftMargin`
  — clamp estrito não desloca; anotado no MANIFEST). Mata o deadlock E2 do init.
- **3 subagents despachados em paralelo**:
  1. **Pacote 5** (`2026.07.16_pacote5-homing-test/`): RestPos em R011/R020; costura
     `InitHeartbeat` nos 4 _Adp (C1); R031 endurecido (timeout por passo, anti retry-storm,
     aborto via Halt/89); `WSCmd_ReHome1..4`; `HomeAll` delega ao R031 (G4); R033 v1 incluso;
     limpeza do hack do R040 + lembretes de bypasses/órfãs.
  2. **Bench-panel** (tasks #10-12 + aba R033): wiring de comandos por TAG BRUTA pylogix
     (⚠ correção do Pedro: o painel NÃO usa o decoder do Arthur — adendo é só semântica);
     tela de operação por eixo (Enable/Reset, State decodificado + diagnósticos 1.6, campo
     posição + ir-para); auditoria portas físicas × PLC; aba do teste cíclico.
  3. **`sdk-plc-toolkit` (repo NOVO, irmão do sdk-servo-toolkit)**: ferramenta `plctk` —
     monitor de 100% das tags via Class 3/pylogix; **leafmap offline do L5X** (expande UDTs em
     folhas, o que o GetTagList não faz); logs snapshot+deltas JSONL; start/stop por PID file +
     heartbeat (gotcha do sandbox); `analyze` p/ eu debugar da sessão. Git local, SEM push
     (publicação no GitHub depois — lembrar gotcha feat/v1+rename).

## Decisões
- `RestPos_mm = 5.0` (Pedro); R033 aprovado; painel consome tag bruta (sem decoder Arthur);
  ferramentas PLC vivem no novo `sdk-plc-toolkit`.
- (Ontem, reafirmadas): `ManualOK` mantém `AxisOK` (R003 conserta depois); receitas residentes
  `UDT_RcpAuto[16]`; jog definitivo = alvo único (Rev 1.6).

## Pendências
- Enviar ao Thiago: **AOI Rev 1.6** (verificar por marcador!) + **pacote 4** + pacote 5 (quando sair).
- Thiago: desfazer bypasses (deadman, JogOpenDir, SafeSoftLim*, JogVel 3/4=1000), apagar órfãs,
  remover hack do R040, comissionar rampa quick stop (0x6085=ilimitada).
- Confirmar com Thiago: o teste simultâneo foi com R030 em AFI ou forces?
- Pedro: review da espec de sim (UDTs prontos); William: timing do corpo virtual (hoje).
- Fase 6/sync: tolerância de tracking da óptica decide baseline (set-point casado) × remap 0x60FF.
- Bench-panel/plc-toolkit: revisar entregas dos agentes; decidir publicação do repo novo.

## Adendo 1 — entregas dos 3 agentes + StopAll + plano sync/ecat

### Feito
- **`sdk-plc-toolkit` entregue**: repo local (2 commits, sem push), `plctk` com leafmap do L5X
  validado contra o snapshot 3 real (514 tags de topo → **2.148 folhas legíveis**; 269 ilegíveis
  em quarentena permanente); monitor com PID file+heartbeat, quarentena de tag ruim, deadband;
  37 testes ✓. Gotcha achado: `fnmatch` trata `[2]` como classe → glob próprio nos filtros.
- **Pacote 5 entregue e validado** (13 arquivos + zip; 60 tags): RestPos 5.0 com janela em tags
  (`RestPosLo/Hi_mm` calculadas no topo do R011); costura InitHeartbeat **gateada por `CommOK`**
  (sem o gate o deadman morreria); R031 com timeout de *aceitação* (10 s < hmTimer 60 s) + latch
  anti retry-storm + passo 9 de aborto real; `ReHomePend{N}` vence a corrida do auto-clear;
  `HomeAll`→R031 com guard movido pros pulsos; R033 byte-idêntico ao aprovado. Confirmado:
  snapshot vivo ainda sem a 1.6 real (0 marcadores).
- **Bench-panel entregue** (~1.100 linhas, sem commit): pivô para pylogix bruto (stack Redis
  removida); **bug crítico corrigido — painel usava MANUAL=3, mapa real do R010 é 0=MANUAL**;
  deadman de jog em 3 camadas (UI 150 ms → JogRefresh 100 ms → PLC); mailbox modo/GoAbs; tela
  por eixo com diagnósticos 1.6; aba R033 com banner "requer pacote 5"; mock E2E ✓
  (`app.py --mock` → :8300). `SPEC-telas.md` §D = decisões do Pedro.
- **HTML Rev 10** publicado (linhas "em geração" fechadas + rev history).

### Decisões
- **`WSCmd_StopAll` aprovado → incremento do pacote 5** (agente retomado): cancela pendentes
  (jog/GoAbs/ReHome/HomeAll/TestCmd), Halt mantido até standstill (padrão Rev 1.6), aborto de
  homing via passo 9 do R031, `St_StopAllActive` p/ painel; não desabilita eixos nem muda modo.
- **Plano de testes sync via EtherCAT DIRETO disparado** (sdk-servo-toolkit, bancada amanhã):
  reconfirmar bit5/bit9/0x6081-on-the-fly SEM o gateway (isolar drive × ABC3107), depois
  alternativas free-form — PV (0x60FF), CSV+DC, CSP+DC (teto do drive); benchmark comum =
  trajetória senoidal (a PP nunca rodada vira T1); métricas RMS/suavidade/continuidade.

### Pendências (novas)
- ⚠ **DOs de câmera possivelmente trocados** (elétrico Pt02/03=N15 × PLC Pt02/03=N6_L/R) —
  conferir fisicamente na bancada antes de confiar nos disparos.
- Barreiras Pt00/01 × rótulos LB1/LB4 — confirmar entrada/saída.
- Painel: validação do Pedro nas telas (SPEC-telas.md); JogVel=1000 nos E4R/E4L segue na lista
  de limpeza do Thiago.
- Publicação GitHub do sdk-plc-toolkit (gotcha feat/v1+rename).

## Adendo 2 — deploy do painel na WS, auditoria de tags, HTML Rev 11 (plano do dia + roadmap MVP)

### Feito
- **Painel deployado na WS PRV10IRIS5** (container `iris-bench-panel`, bind-mount → deploy = rsync
  + restart; `http://192.168.0.189:8300` / ZeroTier `10.179.112.189:8300`); PLC bancada
  `192.168.0.20`. ⚠ gotcha: rsync sobrescreveu `config.yaml` (IP da célula GM) — agora excluído.
- **Tela I/O rediagramada** (espec do Pedro): 3 colunas fixas DI16 | AI4+AI4 | DO16, porta por
  linha; "Por função" com subgrupos + masonry balanceado. Validada ao vivo (screenshots).
- **Auditoria 100% das tags do painel** (`AUDITORIA-tags.md`): stale corrigidas
  (`Barrier_*`→`DI_*Portico`, `GM_Heartbeat/LongSpeed`→`GM_In.*`, `Comm_*`→fontes vivas),
  ~25 órfãs removidas, futuras zero-typo (STOP do header → `WSCmd_StopAll`; HOME → RE-HOME).
  **Achados p/ automação**: anticolisão NÃO para nada (S_AntiColOK forçado em 1 no R007 +
  AxisOK sempre 1 no R003 — dois bypasses empilhados); `S_PowerOK_1..4` e `st_ZonasAquecidas`
  sem produtor; adapters leem `GM_LongSpeed` congelada.
- **Rodapé da Operação → régua de aptidão**: LEDs das 4 causas do interlock (anticolisão pelos
  DIs crus, por eixo), HOMED E1/E2/E4R/E4L, Init/Zonas; bloco PROCESSO separado.
- **HTML Rev 11** (reforma completa, subagent): §A Plano do dia 2026-07-17 (A1 imports, A2 ecat,
  A3 painel, A4 conexões P/C GM↔IRIS prod+sim, A5 decisões), **Roadmap MVP D1/D2 + D3 refino**
  (horizonte corrigido pelo Pedro: 2 dias p/ sistema completo com sync + 1 de refino; caixa
  "fora do escopo do MVP"), §B status, corpo intacto, histórico movido pro final. PDF 1.6 MB.

### Decisões
- Horizonte do projeto: **MVP demonstrável em D2** (corpo entra → receita → sync → câmeras →
  sai) + D3 refino; aquecimento/segurança física/SAT ficam pós-demo.
- Conserto da anticolisão ELEVADO para o D1 (limpeza do Thiago) — MVP não demonstra com ela morta.
- Conexões P/C GM↔IRIS (prod + sim) entram no plano do dia.

### Pendências
- [DECISÃO PEDRO] §7 da auditoria: eco WS_PVI/WS_Style, WS_TagsValid pelo painel,
  IRIS_Ready/InCycle pelo R020 novo.
- Redeploy do painel após imports (missing_tags deve zerar).

## Adendo 3 — pacote de conexões GM↔IRIS + entrega consolidada p/ Thiago

### Feito
- **Pacote de conexões GM↔IRIS** (`plc/2026.07.16_pacote-conexoes-gm/`): verificado por diff
  estrutural que os 3 UDTs do contrato (`UDT_GM_Com_In/Out`, `UDT_StationJob`) já são IDÊNTICOS
  nos dois PLCs → **zero UDT novo** (os de sim são os de ontem, só referenciados). Conteúdo:
  **R006_MapGM reemitido** com a costura que o próprio R006 já reservava ("FASE B") — chave
  `UseGMLink` + `CPS(cGMToIRIS, GM_In, 1)` (CPS = cópia atômica, não rasga o UDT no update da
  conexão); R090 vira fallback com edição manual de 1 linha (`AND NOT UseGMLink`); MANIFEST com
  procedimento OFFLINE+DOWNLOAD (módulo `GM_PLC` no I/O tree, `cGMToIRIS` Consumed RPI 100 ms,
  `GM_Out` Base→Produced) + **seção para o William** (`cIRISToGM` Consumed; o L5X dele só tem o
  Produced, falta o retorno). ⚠ Achado colateral: o snapshot vivo tem o watchdog do heartbeat GM
  **bypassado** (`StTimeoutCommGM := 0 AND ...`) — o R006 reemitido restaura o timeout real.
- **Entrega consolidada montada** (`plc/2026.07.17_entrega-thiago/IRIS-03007-entrega-2026.07.17.zip`,
  1,2 MB / 41 entradas): `00-LEIA-PRIMEIRO.md` (ordem: janela OFFLINE primeiro → AOI 1.6 por
  marcador → pacote 4 → pacote 5 → limpeza com anticolisão em prioridade elevada; critérios:
  `missing_tags` zera + heartbeats das duas pontas; pergunta AFI×forces) + 01-aoi-rev16 +
  02-pacote4 + 03-pacote5 + 04-conexoes-gm + 05-sim-udts + **HTML Rev 11 + PDF do plano**.

### Decisões
- Conexão de produção: padrão `cGMToIRIS` Consumed + costura chaveada (nunca converter `GM_In`,
  que é escrita pelo R090); `GM_Out` convertida para Produced (escrita local permitida).
- Fail-safe da conexão fica no watchdog do heartbeat (2 s), não em GSV do módulo (frágil
  pré-bancada); endurecimento G5/G6 documentado como opcional futuro.

### Pendências
- [CONFIRMAR na bancada]: IP do PLC GM, catálogo/slot do módulo, nome `GM_PLC`.
- William: criar `cIRISToGM` + IRIS no I/O tree dele; timing do corpo virtual.
- Enviar o zip da entrega ao Thiago (Pedro).

## Adendo 4 — ecat direto validado no Servo3 + análise line-twin×bench-panel + plano viewer 3D

### Feito
- **EtherCAT direto OPERACIONAL no Servo3** (NIC `enp0s31f6`, pysoem): T0 rodado no drive real.
  Achados: **DC SYNC0 SUPORTADO** (0x1C32:4=0x0005 → CSV/CSP viáveis; a falta de DC era só do
  ABC3107); 0x60F2 **ausente do OD** (abort 0x06020000 — fecha a dúvida do Modbus); 0x1003
  (log de erros) também ausente; mapa PDO default = mesmíssimo 22B/21B do gateway.
- **Fault 0x821B** (família comm — consequência de trocar o master a quente) **limpo via
  Fault Reset por SDO** (bit7): SW 0x0438→0x0470, Switch On Disabled, err=0. Cross-check
  Modbus×EtherCAT do statusword validou a tabela de espelhos 0xB2xx. USB agora em `ttyACM0`.
- **Bug do T0 corrigido** (agente): `layout["pdos"][i]["entries"]` (não `layout["entries"]`);
  JSON sempre gravado (try/finally); 0x603F + decode de alarme integrados; 40 testes.
- **Análise line-twin × bench-panel** (`specs/ANALISE-line-twin-x-bench-panel.md`):
  line-twin é ~80% motor de simulação L5X (interpretador + 496 testes; 8 bugs reais achados);
  3D é cena PARAMÉTRICA leve (geometria do CAD v9 via binding.json), não mesh pesado.
  **Recomendação aceita: NÃO fundir** — B-1 vendorizar a cena 3D pós-MVP, B-2 lib iris-codes,
  B-3 golden rig como aceite de pacotes.
- **Plano do viewer 3D** (`specs/PLANO-viewer3d-bench-panel.md`, aguarda review): layout do
  Pedro (cena central + barra inferior mini-Operação + sidebar I/O por função enxuta);
  mount imperativo Three.js + code-split da aba; F0..F4 = 5-6,5 dias; cena 100% read-only.

### Decisões
- Golden rig NÃO porta para o sdk-plc-toolkit: motor fica no line-twin; `plctk validate`
  vira wrapper fino importando de lá (dependência unidirecional toolkit→twin).
- Viewer 3D: implementação pós-MVP, após review do plano pelo Pedro.

### Pendências
- Amanhã no T1: drive já sem fault; conferir 0x821B no manual EL8-EC (rigor); quick-stop
  0x6085 ilimitado → reduzir via SDO para paradas suaves nas amplitudes maiores.

## Adendo 5 — mapa completo da Fase 6 (6 estratégias caracterizadas no Servo3 via EtherCAT direto)

### Feito (bancada ao vivo, EtherCAT direto no Servo3, A=300mm/T=15s salvo nota)
Todos os testes T1-T7 rodados no drive real, instrumentados (CSV 2ms) e plotados
(`ecat-sync-lab/logs/plots/`). Baseline homing perdido a cada power-cycle (encoder zera) →
re-home método 17 + jog absoluto ao centro entre runs.

| Estratégia | RMS err | Stalls | Fecha pos | Via ABC3107 hoje |
|---|---|---|---|---|
| **T7 CSP+DC** | **1,08 mm** | 0 | sim | NÃO (sem DC) |
| T6 CSV+DC | 1,85 mm | 0 | deriva ~30mm/30s | NÃO (sem DC + remap PDO) |
| T5 PV (0x60FF SDO) | 3,5 mm | 1 | deriva | NÃO (0x60FF fora do PDO) |
| T4b bit5 velocidade | 12,8 mm | 5 | sim | SIM se bit5 destravar |
| T2b bit5 posição | 16,7 mm | 1 | sim | SIM se bit5 destravar |
| T1 PP clássico | 219,7 mm | 29 | sim | SIM (modo atual = "pulsado") |

Achados decisivos:
- **bit5 (change-set-immediately) FUNCIONA por via direta** (T2 PASS em escala real, redirect a
  126 mm/s sem completar set-point) — o "pulsado" é culpa do **gateway/mapeamento, não do drive**.
- **bit9 inconclusivo→não-suportado** (T3 abortou no ack); **0x6081 NÃO pega em voo** (T4 FAIL —
  amostrado só na aceitação; reconfirma teste A do PLC sem gateway). **DC SYNC0 suportado** (T0).
- **Semântica real do ack fechada**: bit12 fica ALTO durante toda a execução do set-point, limpa
  só no Target Reached (não na queda do bit4). Com bit5, limpa na queda do bit4. Isso valida o
  desenho do estado 69 da AOI Rev 1.6 (parada por posição, não por ack-clear).
- Drive capaz de **sub-milimétrico** (CSP) — mecânica/servo não são gargalo. Todo modo de alta
  fidelidade exige DC ou 0x60FF no PDO, que o ABC3107 não tem.

### Decisão
- **Estratégia de sync escolhida = PP+bit5 (T2b)** para integração no PLC (RMS ~13 mm, compensável
  com feedforward; único caminho viável pela arquitetura atual com gateway). Integrar em R033
  (modo senoide) + R020. A AOI Rev 1.6 já tem os estados 90-92 (SyncEngage) que re-emitem
  set-point com CW 0x003F (bit5) — o emissor pronto.
- **Item decisivo de amanhã**: por que o ABC3107 engole o bit5 (config do módulo? ordem
  CW/target no assembly?). Se sanável → produção herda PP+bit5. Se não → master EtherCAT dedicado
  rodando CSP (sub-milimétrico na mesa).

### Escala de velocidade do bit5 (T2b, A=300mm, instrumentado+plot)
126mm/s→RMS 16,7 · 188→10,5 · 300→11,4 · **500mm/s (5 períodos)→RMS 43,4 / track regime 17,9 / 2 stalls**.
O erro cresce com a velocidade (atraso do loop, compensável por feedforward); 500mm/s já é muito
acima da linha real. bit5 robusto no envelope inteiro. Gotcha resolvido: T6 deixou PDO remapeado
em RAM → **restaurado o mapa PP default via SDO** (sem power-cycle, referência de homing preservada;
drive fica gateway-ready). CSP/CSV/PP alternam o RxPDO 0x1600 — sempre restaurar antes de trocar de modo.

### Pacote 6 — senoide bit5 no R033 (gerado, pronto p/ Thiago)
`plc/2026.07.16_pacote6-senoide/`: R033 v2 (Mode 0 vaivém byte-idêntico + Mode 1 senoide via
`SIN()`, gerador `TestSinTmr` desacoplado, emissão por **SyncEngage** da AOI 1.6 = re-emite CW
0x003F/bit5; MoveAbs fallback documentado); 10 tags novas (CSV `;`); **R020 NÃO muda** (ortogonal;
o que viabiliza a execução é o `JSR(R033)` ausente no MainRoutine — patch incluso). Sai pulsado via
gateway, vira suave sozinho quando o bit5 destravar. Pré-reqs no MANIFEST: JSR, hack R040, RestPos=5.0,
tags duplicadas, TestCfg_* zerados. xmllint OK, zero mnemônico legado (EQ/NE/LT).

### Ferramentas entregues (agente ecat)
- Política **Halt em tudo** (nunca quick stop / nunca disable em movimento); teardown ordenado
  (evita fault 0x821B latchado); fix do handshake do ack (bit12); `T2b_pp_bit5_stream`,
  `T4b_pp_vel_sine` (probe auto onfly/retarget) instrumentados. Suites 49+161 verdes.
- ⚠ Gotcha operacional: T6 remapeia PDO em RAM → **power-cycle obrigatório antes de devolver ao
  gateway**. Power-cycle zera o encoder → re-home antes de qualquer teste absoluto.

### Snapshot 4 + planos (agentes paralelos)
- `REVISAO-snapshot4.md`: entrega entrou quase inteira (12 rotinas verbatim, AOI 1.6b confirmada
  por marcador, 86 tags via CSV `;`, EQ/NE/LT zero-legado, cGMToIRIS já Consumed real via módulo
  PLCGMSIM). **Faltou**: `JSR(R033)` no MainRoutine (R033 inerte!), remover hack R040, setar
  valores (RestPos_mm=5.0 vivo como 0.0 → deadlock E2), RcpAuto slot0 zerado, 5 tags duplicadas.
- `PLANO-senoide-r033.md`: o que "viabiliza a execução" NÃO é o R020 — é o `JSR(R033)` ausente;
  R020/R010/R030 ortogonais (AUTO vs MANUAL+TestMode). Gerador↔emissor desacoplado; senoide sai
  pulsada até bit5 destravar; SIN() existe em ST Logix.
- Memória: regras L5X atualizadas (EQ/NE/LT obrigatório, RevisionNote <500 chars, CSV `;`).

## Adendo 6 — encoder absoluto + ideias AOI 1.8 (guardadas p/ depois)

### Feito
- **Encoder absoluto multi-turn comissionado no Servo3** (Pr0.15=1 via Motion Studio + Save
  EEPROM + ciclo + home): posição sobrevive a power-cycle, validado. Procedimento no LEIA do
  update (seção 4) p/ os outros 3 drives. Lição: save EEPROM via Modbus NÃO funciona neste
  firmware (3 tentativas, incl. potência plena) — só Motion Studio; README do toolkit atualizado.
  Gotcha: Pr0.15=9 ZERA o multi-turn (salto de posição sem movimento — assustou na bancada);
  usar 5 p/ limpar alarme mantendo posição.
- Bug de campo diagnosticado: eixos "acordam homados" (Homed retentivo no PLC + .ACD com upload
  de valores) com referência falsa; HOME ALL não age (guard NOT Homed). Workaround: RE-HOME
  por eixo (WSCmd_ReHome, sem guard). Raiz morta pelo encoder absoluto.

### IDEIAS GUARDADAS — AOI Rev 1.8 (fazer outra hora, decisão do Pedro)
1. **Plausibilidade no power-up**: `LastKnownPos` retentiva gravada a cada scan; na retomada,
   |CurPos − LastKnownPos| > tolerância → RefLost + Homed:=0. Pega bateria morta, Pr0.15
   revertido e overflow — sem depender de alarme.
2. **Alarme de encoder = referência inválida**: mapear códigos de encoder/bateria do EL8-EC
   (AlarmTable_En.json) → LastErrorCode nesses códigos derruba Homed (Reset não "engole" mais).
3. **RE-HOME ALL no painel** (dispara os 4 WSCmd_ReHome).
4. Regra operacional no LEIA: re-home após manutenção de motor/encoder/acoplamento/bateria.
5. (Roadmap pós-MVP) **Sensor de datum físico** no curso — valida posição contra a mecânica a
   cada passagem; única defesa contra escorregamento em pleno curso.

## Adendo 7 — tarde de bancada: snapshot 5, pacote 7, bring-up do R033 (pré-compact)

### Feito
- **Pacote 7 entregue** (`plc/2026.07.16_pacote7-homing-adj/`): R020 c/ `ADD(rcp,
  AxisDatumOffset_mm_N, alvo)` (receitas em coordenada de DATUM, convenção c/ exemplo +
  [CONFIRMAR sinal]; janelas de câmera/jog/teste SEM offset); R031 c/ HOME ALL **simultâneo**
  (4 pulsos de uma vez, guard NOT Homed preservado) + `St_HomingErr` limpando na borda do
  `Reset_Cmd`; 5 tags. Base verificada = snapshot 4 (EQ/NE/LT preservados).
- **Snapshot 5 revisado** (`plc/2026.07.16_revisao-snapshot5/`): pacote 6 INTEIRO verbatim
  (R033 v2 + JSR rung 21 + 10 tags) → teste cíclico NO SCAN; hack R040 removido; RestPos=5.0
  e GMHb_TimeoutScans=200 **no .ACD**; soft-limits medidos e gravados NOS 4 EIXOS (Pos
  1213/1192/1057/1057, margem 3); JogVel 3/4→200. Não tinha: AOI 1.7 e pacote 7. **Depois,
  na janela offline seguinte, a AOI 1.7 ENTROU** (confirmada viva: `Servo*.RefLost` respondem,
  missing_tags=0).
- **Update zip consolidado** (`2026.07.16_entrega-thiago-update/`): LEIA reescrito com base no
  snapshot 5 (feitos marcados; ordem: AOI 1.7 → pacote 7 → TestCfg → higiene c/ JogDeadman
  1e8→50); seção nova de **comissionamento do encoder absoluto** (Motion Studio, por drive);
  TestCfg defaults combinados (todos eixos, vel 200 cap 300, 500/600, dwell 1000, timeout 30s,
  período 15, update 150 — defaults apenas, tela é a fonte).
- **Painel (várias iterações deployadas)**: UI da senoide (toggle modo, período/re-alvo, cap
  300, aviso preventivo do code 8, banner do pulsado, `TestSinTgt_mm` + mini-gráfico SVG 60s);
  badge REF PERDIDA (RefLost) + RE-HOME destacado; chip watchdog GM c/ alarme "LIMIAR=0";
  writer pylogix resiliente a download (reconexão+retry nas 3 conexões); toasts de erro;
  Reset_Cmd em PULSO 300ms (PLC não consome — ninguém escreve nela); kiosk a 90% de zoom
  (`--force-device-scale-factor` no kiosk.sh, watchdog relança) + refresh via xdotool.
- **Bugs de campo da tarde**: (a) interlock caiu de novo pós-download → GMHb=0 (2º strike;
  agora no .ACD); (b) writer do painel morre em download do PLC → fix resiliente; (c) step
  "não linkado" era o writer morto (WSCfg_JogStepSize ok; ficou 5.0 do meu teste, depois 2.5);
  (d) **write de tags INTEIRAS quebrado na IHM** ("required argument is not an integer"):
  UI manda float p/ SINT/DINT → toggle de modo preso + campos de teste. **Tabela autoritativa
  de tipos verificada no snapshot 5**: TestCfg_Mode/WSCmd_Mode/Jogs = SINT; Dwell/Timeout/
  UpdateMs/JogRefresh/StopAll = DINT; fix de coerção em curso (agente caiu em 529, retomado).
- Soft-limits E4R/E4L aplicados ao vivo ([3,1057] via `SoftLimitNeg=0/Pos=1060/Margin=3`;
  Thiago depois gravou 1057/3 no projeto e mediu os 4 eixos).

### Estado do teste do R033 (para retomar pós-compact)
Máquina: MANUAL, interlock OK, 4 eixos homados (re-homados) em pos 0, DESABILITADOS.
TestCfg todos ZERADOS. Falta: fix de tipos do painel (agente ae3e... trabalhando) → deploy →
preencher TestCfg pela tela → HABILITAR eixos → TestMode_Enable → START modo 0 (vai-e-vem) →
depois modo 1 (senoide; SAIRÁ PULSADA via gateway — esperado; mini-gráfico mostra alvo×posição).

## Links
- Revisão snapshot 3 + R033: `plc/2026.07.15_revisao-snapshot3/`
- Pacote 5: `plc/2026.07.16_pacote5-homing-test/` (pronto; incremento StopAll em curso)
- Plano sync/ecat: `plc/2026.07.16_sync-ecat-tests/` (em geração) + `sdk/sdk-servo-toolkit`
- Ferramentas: `sdk/sdk-plc-toolkit` (novo) · `sdk/iris-bench-panel` (SPEC-telas.md)
- AOI Rev 1.6: `plc/2026.07.15_aoi-rev13/` (Rev16 + DIFFs + MANIFEST)
- Journal anterior (arco completo do bench): `journal/2026-07-15-iris-plc-rewire.md`

## Adendo 8 — SENOIDE LISA VIA GATEWAY: bit5 seguro (AOI 1.7b) + R033 v4 (P+FF)

- **Investigação bit5 (D4, dois lados do Anybus)**: sampler pylogix 30 Hz
  (`Servo3Rx.ControlWord` + `AnyBusComm:O.Data[44..45]` + `Servo3Tx.StatusWord` + pos)
  × Motion Studio lendo 0x6040 no drive. Resultado: **bit5 ATRAVESSA o gateway**
  (drive lê 15↔63) — hipóteses "PLC não emite" e "gateway engole" ELIMINADAS.
  Caminho PLC limpo: AOI → `COP(ServoNRx.ControlWord, O.Data[44],2)`, sem máscara.
- **Causa do pulsado**: bordas de bit4 efetivas ~3/s no drive (paradas cravadas em
  ~301 ms, medidas) + vel de perfil constante ≫ vel do alvo. Task CONTINUOUS→
  PERIODIC 10 ms não resolveu (fase do toggle 20 ms ≥ 2×RPI e nada mudou).
- **Fix em 2 peças (T2b replicado via gateway)**:
  (1) **AOI Rev 1.7b** — meia-fase do sync `0x000F`→`0x002F` (bit5 ALTO o streaming
  inteiro, paridade T2b). Destravou **adoção contínua do alvo** no EL8-EC: drive segue
  posição na taxa do RPI sem depender de borda. `plc/2026.07.16_aoi-rev17b/`.
  (2) **R033 v4** — vel = feedforward (|d/dt alvo|, lei do T4b) **+ termo P**
  (3,0/s × |erro|, piso 5, teto TestCfg_Vel) por eixo; v3 (ff puro) clipou amplitude
  (292/800) por atraso irrecuperável com bordas raras. `plc/2026.07.16_pacote8-senoide-ffvel/`
  (CSV consolidado 12 tags; +TestSinVel_mmps/TestVelCmd_mmps).
- **Resultado medido (Servo3, 500/600/T15/cap200)**: movimento **99,3%** do tempo
  (v2: 28,7%), amplitude cheia 200,0–800,0, únicas pausas = 10×~67 ms nas cristas
  (zero de velocidade da senoide — físico). **Fase 6 ATUALIZADA: PP+bit5 via ABC3107
  VALIDADO em bancada — produção NÃO precisa de master EtherCAT dedicado p/ seguimento.**
- Aceleração: manter estática generosa (T2b usava 10×A·ω²; TestCfg 2000 ≈ 38×) — dinâmica
  seria pior (teto justo onde precisa corrigir erro; 0x6083/84 amostrado na aceitação).
- MainTask mantida PERIODIC 10 ms (atribuição limpa + fase ≥ 2×RPI); recalibrar
  scan-counts (GMHb 200→2 s etc.) se virar definitivo.
- **Modo automático (guia pronto)**: `plc/2026.07.16_guia-teste-auto/`. Wiring OK
  (R010/R020/R022/GMSim c/ heartbeat), bloqueios: RcpAuto[0..15] ZERADA (confirmado
  live; `rcp_writer.py` no scratchpad popula/dump), R021 sobrescreve Target (inibir
  JSR p/ testar receita), gatilho de ciclo é DI físico (GMSim_CarEntering não dispara).
  Runtime de receitas: WS via CIP write + WS_TagsValid (backlog WS: módulo recipe-push).

## Pendências (atualizado)
- Registrar resultado no HTML do plano (Rev 15) + PDF.
- Painel: absorver fix de coerção no agente + extras pulados; velocidade/erro da senoide na tela.
- Teste automático: popular RcpAuto, inibir R021, forces init, rodar guia.
- Thiago: update-zip (pacote 7, higiene, encoder absoluto S1/2/4), remover bypass `or 1` R007.

## Adendo 9 — RECEITAS DO BLENDER EXECUTADAS VIA GATEWAY (pacotes 9/10/10.1) + regime final Kp=0

- **Arco da noite**: TestMode ganhou modo RECEITA (pacote 9: fase 6 aproximação + fase 7
  tracking c/ linha simulada + janelas de câmera nos DOs + trace no painel) → evoluiu p/
  **curva f_N(s) 256 pts/eixo** (pacote 10: UDT_RcpCurve256, RcpCurve[16] ~66 KB, interp
  O(1), validação dos 256 pts no arme, fallback base+carro) → **v6.1** (pacote 10.1:
  one-shot — 1 passagem e para; `TestKp_ps` e `TestLookahead_ms` ajustáveis; painel c/
  preview de v̂ máx por eixo da curva, cap 600 no modo receita, m/min⇄mm/s).
- **Receitas reais extraídas do Blender** (tracker/montana/spin): fidelidade quantificada —
  RcpAuto (base+ganho 1) SÓ representa a câmera (E2, ganho 0,93); res ganho ~0 na janela
  e cortina ganho −3,24 EXIGEM a curva. Curvas re-amostradas 256 pts (RMS 0,7–1,9 mm).
  LineLen por modelo = vão entre barreiras 2216,4 + comprimento do carro (6396/6848/6497).
  **Frame de BANCADA** (revisão visual do Pedro): E1/E2 invertidos (montagem), E1 parte
  1210 (excursão ×0,956 p/ caber em [6,1210] sem clamp — janela útil REAL = Neg+3..Pos−3,
  code 9 pegou o piso 3 vs 6), E2 parte 1100, E4 fecha até 1050, janelas = passagem
  inteira. `AxisDatumOffset=0` na bancada (frame máquina); offsets Recipe-sala (−906/
  −1509/−78) só quando formos ao frame da sala. `curvas-256-bancada/`.
- **3 formas consistentes das receitas**: PLC ao vivo (rcp_writer --curve, chunks+read-back),
  tag-L5X c/ valores p/ .ACD (experimental; L5K byte-idêntico ao snapshot; sem BOM = 1ª
  variação se falhar) e CSVs. Persistência: **Save c/ Upload tag values** = downloads
  restauram receitas sozinhos. CSV do 10.1 estava LF → **CRLF** (import silencioso não
  cria tags — gotcha reconfirmado).
- **⚠️ VIBRAÇÃO/entrecorte: causa = termo P (Kp=3)** — ciclo-limite c/ realimentação
  atrasada pelo funil gateway; senoide também exibia (não é a grade). **Kp=0 (T2b puro)
  reduziu drasticamente**; lookahead ajuda menos. MAS ff puro exige teto suficiente:
  rodada 116,7 mm/s c/ teto 200 → déficit nunca recuperado (E1 RMS 478 mm, rastejo a
  5 mm/s no piso, one-shot encalha eixos fora do lugar). **Teto 500 resolveu**: 3 ciclos
  completos, amplitude cheia, RMS 10–27 mm @116,7 (inclui viés do lookahead 200 ms —
  ajuste fino p/ 30–50 ms pendente), vel máx 499/249/396, 100% OpEnabled, zero warnings.
  **Regime recomendado: Kp=0 + lookahead moderado + teto dimensionado pelo preview.**
- **Freio E2 (queda da manhã)**: sem reprodução; dados limpos (0 saídas de OpEnabled,
  0 bit7, 0 movimento contra alvo nas verticais). "Quedas aparentes" da noite = artefatos
  da rodada saturada. Pendência aberta: histórico de warnings + Pr4.xx no Motion Studio.
- **Arthur (front)**: análise verificada tag a tag (~90% correto; 3 erros — duplicatas
  controller-scope é armadilha que ele não viu; memo endereçado a "Amantrini" = resíduo).
  Relatório alarme a alarme: `reports/md/2026-07-16-alarmes-front-plc.md` — 55 do contrato
  não existem nominalmente em lado nenhum; 6 reais decodificados + HeatingAlarm; ~8 novos
  c/ fonte pronta (RefLost = candidato nº1); contraproposta 6+Heating+2 na DINT.
  Espelhamento de órfãs = pacote 11... **renumerado: alarmes = pacote 12**.
- **AutomaticCycle — s real**: spec do integrador de posição (pacote 11) escrita:
  `specs/2026-07-16-line-position-integrator-design.md` — R023, GSV WALLCLOCKTIME,
  âncoras nas 2 barreiras (debounce 30 ms compensado), k=2216,4/integrado (clamp
  0,8–1,2, EMA entre carros), correção suave rate-limit 15 mm/s, guards (coast/HOLD/ré/
  fim), re-aponta R020/R021, 11 cenários de bancada. AGUARDA REVISÃO do Pedro.
- **TestMode × AutomaticCycle**: s sintético (TONR×LineVel, pacote 9/10) testa a LEI;
  R023 (pacote 11) é a FONTE do s real — separação registrada.

## Pendências (atualizado 2)
- Pedro: revisar spec pacote 11 (integrador) + decidir pacote 12 (alarmes/espelhos Arthur).
- Ajuste fino lookahead (30–50 ms) + decidir Kp default (0 vs 0,3 recuperação) p/ port ao ciclo real.
- v6.2 (backlog): segurar último alvo até AtPosition antes de concluir one-shot.
- Freio E2: Motion Studio (warnings + Pr4.xx) quando houver janela.
- Selar receitas+TestCfg no .ACD (Save c/ upload); testar import dos tag-L5X (experimental).
- HTML Rev 15 + PDF (em curso via subagent).
