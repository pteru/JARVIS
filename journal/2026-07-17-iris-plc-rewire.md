---
type: Journal
title: "IRIS 03007 — madrugada: jog em hold, P-0 + pacote 11 gerados, GMSim/William, HTML Rev 16"
description: Encerramento da noite de bancada e preparação do dia 17 — saga do jog (deadman recalibrado, fix de touch sem efeito, teste sintético decisivo em hold), pacote P-0 de saneamento, decisões D1-D8 do integrador, pacote 11 (R023+BenchMap) validado com simulação numérica, memo de ajustes do GMSim para o William e auditoria integral do plano HTML (Rev 16).
tags: [iris-plc-rewire, iris-scds, "03007", plc, automacao]
timestamp: 2026-07-17
project: "03007"
product: visionking
language: pt-BR
status: current
---

# IRIS 03007 — madrugada 16→17/07 (pré-import P-0 + pacote 11)

## Feito
- **Jog "twitching" — EM HOLD c/ diagnóstico avançado**: jog segurado avança ~2 mm/s
  c/ micro-paradas (deveria 30 mm/s). Descartados COM DADOS: deadman do PLC (recalibrado
  500 p/ scan CONTINUOUS — a task nunca ficou Periodic; 50 scans viravam ~70 ms e
  ciclavam c/ o refresh de 100 ms), JogKeeper (refresh chega, mediana 100 ms),
  touchscreen (fix `touch-action:none`+`setPointerCapture` deployado — sem efeito),
  JogBlocked, duplicatas de escopo. Gotchas achados no caminho: uvicorn NÃO loga POSTs;
  kiosk zumbi engole cliques (fix = restart do chrome, não ctrl+F5); kiosk relançou SEM
  `--force-device-scale-factor=0.9`. **Próximo passo decisivo (manhã): simular o botão
  via POST /api/jog a 150 ms (move E4R ~90 mm) — separa frontend×backend/PLC.**
- **P-0 saneamento gerado** (`plc/2026.07.17_pacote-p0-saneamento/`): R050 sem o hack
  `XIC(teste)` (rungs 2-5 — 4 câmeras disparavam juntas), R007 sem `or 1` (OPCIONAL —
  mascara os 4 DI de anticolisão; decisão do Thiago na bancada), TABELA-REMOCAO (12 tags),
  LEIA c/ deadman 50(Periodic)/500(Continuous) e lookahead 200→40.
- **Decisões do integrador (D1-D8) fechadas pelo Pedro**: D1 `Trk_SpeedScale` (m/min→mm/s);
  D2 `Trk_GapRef_mm` tag, bancada 2302 (vão físico será MEDIDO); D3 SEM tabela nova —
  `RcpAuto.StyleCode` é o mapa (códigos GM arbitrários; bancada regrava 1/2/3); D4
  BenchMap chaveado por `UseGMLink`; D5-D8 ratificadas (rate-limit 15 mm/s, k 0,8-1,2 +
  EMA 0,25, âncora saída ±25%, ré até −100 mm).
- **Pacote 11 gerado e validado** (`plc/2026.07.17_pacote11-integrador/`): R023 (381
  linhas ST, integrador + BenchMap como seção 0), R020 patchado por L5X (T0/T2/T3 →
  `Trk_BarrierIn/Out`; `GM_LongPosition`→`WS_LongPos_Corrected` ×24 + gate `Trk_Valid`),
  patches manuais R030 (CarPresent) e R052 (3 SINAIs do IF_Track), 59 tags CSV, spec
  APPROVED. **Mapa Spare1[0] verificado**: .0=B01 .1=B02 (TRUE=interrompido);
  .2-.5=anticol P1..P4 ATIVO-ALTO=OK (polaridade INVERTIDA vs DI — BenchMap normaliza).
  Validação extra: simulação numérica do núcleo (A2 k=0,9996; A3/M-32 k→1,052 = EMA
  teórico; nos carros 1-2 do A3 o resid 164/123 mm excede MaxResid → DEGRADADO por
  projeto até o k convergir). R021 adiado pro P-2 (seção é inerte). Riscos: sintaxe GSV
  c/ instância vazia (preencher no Verify se reclamar); `VMaxLine=250` [confirmar GM];
  C1 real popular Spare1 como o sim [confirmar Thiago].
- **Memo GMSim → William** (`plc/2026.07.17_gmsim-ajustes-william/`): heartbeat =
  `Cfg_HbPeriod` 50→20 (200 ms; online); vão JÁ é tag (`Cfg_BarrierDist`=2302 — atualizar
  quando medir, sem import); handshake JÁ implementado no runner (WAIT_COMPLETE consome
  CycleComplete; "avanço cego" era o fake-IRIS) — ligar `Sim_UseIrisLink` no P-4 +
  timeout 10→60 s + log. Nosso lado: RPI do consumed ≤100 ms c/ heartbeat 200 ms.
- **HTML Rev 16** (auditoria integral + PDF 2,0 MB): 6 críticos corrigidos (doc afirmava
  AOI 1.5b rodando; pacotes 4/5/6 "prontos p/ envio" já importados; receitas "zeradas"
  já seladas; estrutura 2-programas vs 40 rotinas/CONTINUOUS; hacks sem registro;
  roadmap mandava decidir estratégia já validada). Bloco novo "Estado no snapshot 6".

## Decisões
- Regime de movimento de produção: **Kp=0 + lookahead ~40 ms + teto pelo preview**
  (P só existia p/ bordas raras pré-1.7b; virou fonte de vibração).
- Receitas: 3 formas consistentes; persistência por Save c/ upload SELADA no snapshot 6.
- Port TestMode→AutomaticCycle: plano P-0..P-6 (~6,5-8 d) em
  `plc/2026.07.16_port-auto-prep/ANALISE-snapshot6-gmsim-e-plano-port.md`.

## Pendências (fila da manhã, em ordem)
1. Jog: teste sintético via POST (decisivo; move E4R ~90 mm — com o Pedro na bancada).
2. Decisão **Periodic 10 ms × Continuous** c/ Thiago → define deadman 50×500 + watchdogs; Save da task.
3. Imports: **P-0** → **pacote 11** (ordem do MANIFEST) → download.
4. Pedro/eu: reescrever voláteis (TABELA do pacote 11 + TestCfg + styles 1/2/3 + lookahead 40) → Save c/ upload.
5. William: `Cfg_HbPeriod`=20 (+ ajustes do memo).
6. Medir o vão físico (trena) → `Trk_GapRef_mm` + `Cfg_BarrierDist`.
7. **B0**: integrador ao vivo c/ runner do GMSim (parado/rodando/M-32 p/ o k).
8. Freio E2 (Motion Studio warnings + Pr4.xx) quando houver janela; zoom do kiosk se incomodar.

## Links
- P-0: `plc/2026.07.17_pacote-p0-saneamento/` · Pacote 11: `plc/2026.07.17_pacote11-integrador/`
- Memo William: `plc/2026.07.17_gmsim-ajustes-william/IRIS-03007-GMSim-Ajustes.md`
- Spec integrador (approved): `specs/2026-07-16-line-position-integrator-design.md`
- Plano/HTML Rev 16 + PDF: `plc/2026.07.14_cia402-pp-aoi/`
- Journal do dia anterior (adendos 1-9): `journal/2026-07-16-iris-plc-rewire.md`

---

## Adendo 1 — manhã/tarde 17/07: comunicação bilateral, A1-A10 completos, P-2 gerado

### Feito
- **Link bilateral PLC↔PLC fechado**: GMSim→IRIS já vinha limpo (heartbeat 200 ms,
  William aplicou `Cfg_HbPeriod=20`); IRIS→GMSim estava morto — causa: `GM_Out` era
  `TagType="Base"` no projeto IRIS (nunca marcada Produced). Pedro marcou Produced +
  download → `cIrisIn` acompanhando com lag ≤ RPI 100 ms. Validado por amostragem
  simultânea nos dois lados.
- **Defaults do integrador verificados 13/13** pós-download (Save c/ upload funcionou;
  receitas e TestCfg sobreviveram). Styles regravados **tracker=1, montana=2, spin=3**
  (RcpAuto+RcpCurve) casando com o GMSim; `TestLookahead_ms=50`.
- **Watchdog GM recalibrado**: `StTimeoutCommGM` (R006, em scans) expirava em ~41 ms
  no scan CONTINUOUS de 203 µs → `Trk_CommOK` piscava e nada armava. RAM:
  `GMHb_TimeoutScans` 200→**9849** (2 s reais). Prova definitiva do P11-6
  (watchdogs scans→tempo).
- **Aceitação A1-A10 completa em bancada** (pacote 11 + GMSim): A1 116,6 mm/s exatos;
  A2 3× (kMeas 0,9965-1,0016, resid ≤9 mm); A3 M-32 kMeas 1,0786 (teoria 1,077),
  EMA 0,25 exata na subida e decaída (M-32 do runner é ONE-SHOT — rearmar por carro);
  A4 rampa drenando a 15,5 mm/s (=CorrSlew); A5 kMeas 1,4 rejeitado, k preservado;
  A7 HOLD em 0,96 s c/ s congelado Δ0,0 mm; A8 LineStop congela s (gate LineRunning);
  A9 ré −110 mm c/ Trk_Reverse e retomada; A10 saturação 7000 + reciclagem na B01.
  A6: injeção direta impossível (runner reescreve Sim_B02 por scan; force no Studio →
  memo William), mas rejeição fora-da-janela provada 3× com dados reais.
- **R021 legado deletado** pelo Pedro (rotina + JSR) — seção era inerte e escreveria
  Target=100 nos steps 2/3 do GMSim; P-2 traz a rotina nova completa.
- **Pacote P-2 gerado por subagent** (`plc/2026.07.17_pacote-p2-r021/`): R021 novo
  422 linhas ST (transplante da fase 7 do R033: f_N(s_look) em RcpCurve, ff=derivada×
  WS_LongVel_Corrected, Kp=0, engate por janela 25 mm, freeze≠desengate, re-park S4
  contra pulso MoveAbs perdido — bug real achado na análise). 48 tags, self-check 64
  identificadores vs snapshot. Enviado ao Thiago como está.
- **iris-bench-panel — 4 features deployadas** (subagent, kiosk v=251→254): tela
  Câmeras (trigger pulso/contínuo em TriggerCamera1..4 + viewer ao vivo do KeyDB
  porta 4000 db2 `Camera_N.image_streaming` JPEG 640×512), Enable/Disable All na
  barra, aba **Tracking** (barra da linha c/ cursor do carro, trace 120 s, k/comms/
  anticolisão). Kiosk: watchdog `/opt/kiosk/kiosk.sh` + URL em `/etc/kiosk-url`.

### Decisões
- Mapa styles bancada: tracker=1/montana=2/spin=3 (D3; GM manda códigos no Station[0].Style).
- Jog fica pro FINAL do dia (Pedro); lookahead padrão 50 ms.
- A numeração: P-1 do plano == pacote 11 (importado+validado); P-4 parcialmente
  adiantado (produce/consume vivo; falta só Sim_UseIrisLink+CycleTimeout do William).

### Pendências
1. Import P-2 (Thiago) → reescrever voláteis (styles, lookahead, GMHb 9849, Auto*)
   → Save c/ upload.
2. **B1**: modo AUTO + eixos homados/habilitados + carro virtual → primeiro movimento;
   b1_sampler (subagent gerando) = registro de aceitação (RMS<30 mm/eixo). A11 junto.
3. Rajada de 225 k anomalias na janela de mexidas do William — não reproduziu em teste
   controlado; observar no B1.
4. Memo William v2: Cfg_CycleTimeout 6000, Sim_UseIrisLink no P-4, botão de borda
   falsa p/ A6, M-32 persistente opcional, Pnl_Speed clampa em 30.
5. Jog (teste sintético POST) — deixado pro fim do dia.

### Links
- P-2: `plc/2026.07.17_pacote-p2-r021/` · Bilateral: tags `GM_Out`/`cIrisIn` + `ucGMToIRIS`/`cGMToIRIS`

---

## Adendo 2 — tarde/noite 17/07: B1 rodou, 3 bugs de engate, rastreio contínuo

### Feito
- **Bugs de INIT destravados (o INIC nunca tinha rodado antes)**: o AUTO travava.
  Diagnóstico ao vivo: (1) R020 tinha OTE de `Servo{N}.MoveAbs` incondicional que,
  fora do AUTO, matava o pulso do S3 do R011 (init preso pra sempre) — fix JMP/LBL
  gateado por `NE(Sys_Mode,2)`; (2) `RestPos=5,0` inalcançável (clamp de soft-limit
  em 6) — mudado p/ 10; (3) `WS_TagsValid` duplicada (controller órfã vs program
  consumida) + `st_ZonasAquecidas` WIP Willer — forçadas; (4) R010 sem saída de INIC
  (escapei forjando latch) — transição INIC→MANUAL adicionada; (5) R011 sem retry do
  S3. Tudo consolidado no **lote único** (`plc/2026.07.17_lote-consolidado/`, 4 L5X
  R007/R010/R011/R020 + 6 tags). Aceite provado: sujei o E3 (→60), INIC trouxe sozinho
  a 10 e chegou em AUTO em 5,7 s.
- **Sensor de anticolisão P2 é o bloqueador físico**: as 3 primeiras tentativas de B1
  latchearam sempre no `DI_Anticolisao_P2` (=`Local:1:I.Pt03`, sensor do E1) quando o
  E1 se move na zona baixa — sensor intermitente. O `InterlockCauseLatched` novo (do
  patch R007 debounce) NOMEOU a causa (=1 anticol) sem watcher externo. Bypass por
  **I/O force do Pt03=0** no Studio (Thiago) — E1 sem anticol até trocar o sensor.
- **B1 RODOU (tentativa 4, com fixes de engate)** — marco do dia: pela 1ª vez os eixos
  seguiram a curva puxados pelo carro virtual. Antes disso, 2 bugs de engate achados:
  BUG1 (R021 cravava `SyncEngage` com a AOI ainda ocupada na aproximação → borda
  perdida; fix `AND Servo{N}.State=30`); BUG2 (R020 aproximava E1/E2 na mesma `PosN15`
  → E1 no lugar errado; fix aproximar por `RcpCurve[].PosE{N}_mm[0]`). Patch
  `plc/2026.07.17_patch-b1-engate/`. Resultado B1: **E2 PASS (RMS 10,7 mm)**, E1 FAIL
  marginal (30,2 — descida/retorno agressivos, tuning depois), E4R/E4L engataram tarde.
- **E4 diagnóstico → rastreio CONTÍNUO**: o E4 (curva plana 114 até s≈4200, pulso a
  **1041 mm em s≈4415**, volta) perdeu o fechamento porque só podia engatar em S3, que
  começou em s≈5000. Raiz: a arquitetura estagia N15(S2)→N6(S3) sequencial, mas as
  curvas `f_N(s)` já codificam o timing. Decisão do Pedro: **rastreio contínuo dos 4
  eixos** (janela única S2∪S3, aproximar os 4 no início). Patch em geração
  (`plc/2026.07.17_patch-rastreio-continuo/`).
- **Painel — muitas telas novas/ajustes** (deploy contínuo via IP 192.168.0.189, kiosk
  watchdog v=250→259): aba Câmeras (trigger single/contínuo + viewer KeyDB
  `Camera_N.image_streaming` JPEG), Enable/Disable All, botão ABRIR PASSAGEM (→RestPos
  sem re-home), aba **Tracking** (trace carro/eixos separados + logic-analyzer de
  latches de sensores + toggle UseGMLink 2-toques), e correções de layout (barras sem
  quebra, altura de flags reservada). Curvas suavizadas nos 3 slots (cantos arredondados
  −44..−64% de accel) e **enviadas de volta ao Blender** (`v4-mov-all-cars-SUAVE.blend`
  + `DOC-shifts-retiming-v4-v9.md`) p/ o Tiago avaliar cobertura de reflexos.

### Decisões
- Rastreio de produção = **contínuo, 4 eixos**, não estagiado por câmera. As janelas
  de câmera passam a ser gateadas por posição na passagem inteira.
- Convenção L5X do projeto: mnemônicos curtos **NE/EQ/LT/GE** (nunca NEQ) — memória
  `feedback-iris-l5x-ne-not-neq` criada após 2 recorrências.
- `RestPos=10` (não 5 — inalcançável). Deriva de projeto: Lo/Hi deviam ser RestPos±0,5.

### Pendências (ordem de import consolidada em `plc/2026.07.17_ORDEM-IMPORT-CONSOLIDADA.md`)
1. Thiago: importar lote + patch B1 + **patch rastreio contínuo** (R020/R021 do rastreio
   substituem os do B1) numa sessão → download → reaplicar voláteis → Save c/ upload.
2. Trocar o sensor de anticolisão P2 (físico) → remover o I/O force do Pt03.
3. Re-rodar B1 com rastreio contínuo: aceite = E4 fazendo 114→1041→114, RMS<30/eixo.
4. Tuning do E1 (marginal 30,2): lookahead/teto.
5. Memo William v2 (`IRIS-03007-GMSim-Ajustes-v2.md`): botão borda falsa, HMI reescreve
   estado (investigar), styles `[1,3,2]` já aplicados por ele.
6. Jog (teste sintético POST) — segue pro fim.

### Links
- Lote: `plc/2026.07.17_lote-consolidado/` · Patch B1: `plc/2026.07.17_patch-b1-engate/`
- Rastreio contínuo: `plc/2026.07.17_patch-rastreio-continuo/` · Ordem: `.../2026.07.17_ORDEM-IMPORT-CONSOLIDADA.md`
- Blender suave: `sdk/sdk-blender-tools/scenes/v4-mov-all-cars-SUAVE.blend`

---

## Adendo 3 — WIP: debug do não-engate no patch rastreio-contínuo (registro pré-compact)

### Estado: INVESTIGAÇÃO ABERTA — retomar daqui

**Sintoma**: com o patch rastreio-contínuo importado (download feito), a passagem
Tracker@7 rodou inteira SEM nenhum engate (AutoEng1..4=0 sempre), apesar de o E1
ficar parado EXATAMENTE sobre a curva (|erro|=0 por ~5 s, s=893→1458).
CSV da corrida: `scratchpad/b1_run_1784317938.csv` (2992 amostras).

**Evidência dura (do CSV, janela 100<s<6000, 1260 amostras)**:
- `arm_ok=1`, `reject=0`, `slot=2` — constantes.
- **`endfreeze=1` em TODAS as amostras** ← O FLAGRANTE.
- `lookpos=6396 (=LineLen) congelado`, `velff=0.0` — resíduos do FIM da passagem
  ANTERIOR; o bloco do s_look nunca rodou.
- `tracking=0`, `frozen=0`.

**Diagnóstico parcial**: `AutoEndFreeze` ficou LATCHED=1 desde uma passagem
anterior (pós-download houve ao menos uma passagem que armou e terminou — arm/slot/
LineLen residuais são consistentes). Quem limpa o EndFreeze é o ARME
(`AutoEndFreeze := 0`, última linha do bloco, roda em QUALQUER borda de arme,
mesmo com reject). Logo **a borda do arme NÃO disparou na passagem que falhou**
(EndFreeze=1 já em s=46, ~0,3 s após a entrada em S2).

**Verificado LIMPO (não re-verificar)**:
- L5X importado é fiel ao src.st (diff executável = zero).
- Diff executável CT×B1 = exatamente as 6 linhas pretendidas (AutoWinTrack).
- Fix `Servo{N}.State = 30` presente nos 4 eixos.
- R020: rung de aproximação S2 (one-shot, 4 eixos, PosE{N}[0]), pulso MoveAbs e
  JMP/LBL idênticos ao B1 pro E1/E2; aproximação real OK (E1 chegou a 1210 em
  s≈715 a 200 mm/s — mesmo timing do B1 que engatava).
- Condição do arme (CT src linhas ~118-157): `IF AutoWin12 AND (NOT AutoWasWin12)`
  com `AutoWasWin12 := AutoWin12` toda scan após o bloco; `AutoWin12 :=
  (NOT AutoKill) AND R020_STEP.2` continua computada (não virou vestigial).

**Hipóteses vivas (em ordem)**:
1. `AutoWasWin12` preso em 1 na entrada de S2 (borda nunca cai) — mecanismo
   desconhecido; talvez interação com a ordem/refactor do CT, ou o STEP.2
   nunca ter baixado entre as passagens do ponto de vista do R021.
2. Algo re-seta `AutoEndFreeze:=1` toda scan: só possível se
   `WS_LongPos >= AutoLineLen_mm` com `AutoLineLen_mm=0` (pós-download sem arme
   novo) — mas LineLen residual era 6396 (slot=2 residual), então improvável.
3. Borda do arme acontecendo com `AutoKill=1` (modo ainda ≠2 no scan da entrada
   em S2) e nunca re-tentada — a construção por borda perderia o arme se S2
   entrar antes do modo assentar. **Candidata forte**: na corrida falha, o
   INIC→AUTO e a entrada em S2 foram próximos; se STEP.2 subiu com Sys_Mode
   ainda 1, Win12 ficou 0; quando o modo virou 2, STEP.2 JÁ estava 1 →
   Win12 sobe → borda... deveria disparar. MAS se o arme disparou ANTES
   (numa tentativa anterior com STEP.2) e `AutoWasWin12` ficou 1 sem transição...
   (verificar a sequência exata de STEP×Sys_Mode×Win12).

**Próximo passo decisivo (ao retomar)**: UMA passagem instrumentada com sonda
lendo por scan (ou o mais rápido possível): `AutoWasWin12`, `AutoWin12`,
`AutoEndFreeze`, `AutoArmOK`, `R020_STEP`, `Sys_Mode`, `Servo1.State` — o
primeiro segundo após a B01 decide entre as hipóteses. Alternativa sem rodar:
write manual de `AutoEndFreeze=0` via pylogix com o sistema armado e ver se o
rastreio "acorda" (confirma que o EndFreeze é o único bloqueio).
**Fix provável** (desenhar após confirmação): arme por nível-com-memória em vez
de borda pura (re-armar se S2 ativo e ainda não armado NESTA passagem — ex.
latch AutoArmedPass limpo em S0/S4), e/ou EndFreeze limpo também na detecção de
nova passagem do R023 (s reciclou) em vez de só no arme.

**Contexto de bancada ao pausar**: sistema em DESLIG (Pedro desativou tudo);
P2 segue em I/O force (Pt03=0); voláteis todos reescritos e conferidos 21/21;
GMSim Tracker@7. Watcher/sampler prontos no scratchpad (`b1_watch5.log`,
`b1_sampler_run5.log` foram da corrida falha).

---

## Adendo 4 — dia fechado: xz0 + ARME-DESLIG + flicker GM_In + runaway E4R

**Feito**
- Bug do não-engate FECHADO: teste discriminante (watcher zera `AutoEndFreeze`
  no recycle) provou que o EndFreeze preso era o único bloqueio; causa raiz =
  arme por borda com janela em nível. Patch **ARME-DESLIG** gerado (R021 arme
  por nível + latch `AutoArmedPass` limpo na queda de s >1000 mm; R010 computa
  `St_Desligamento` por timer 9849 scans) — **importado pelo Thiago** junto com
  LOTE+rastreio-cont (snapshot `(7)` 18:23 conferido por grep) e Save c/ upload.
- DESLIG deixou de ser armadilha (saiu sozinho pós-import, observado ao vivo).
- Receitas **zero-XZ + vão 2302** (`curvas-256-bancada-suave-xz0/`): s=0 = bico
  no plano XZ da cena (frames 29,66/502,58/993,60 t/m/s); shifts v9 removidos;
  LineLen 6482/6934/6583. Gravadas nos slots 2/3/4, read-back OK. Passagens de
  validação: RMS vs curva 1,3–7,7 mm/eixo, pulso E4 1045@4735, fim em s≈6486.
- `VERSOES-RECEITAS.md` + HTML Rev 18 (histórico de receitas) + ORDEM revisada.
- **Flicker do `GM_In`**: produtor GMSim estável; briga interna era o R090
  (fake-GM) ativo — `GMSim_Enable=1` SELADO no .ACD pelo Save. Zerado; alerta
  na ORDEM (re-selar 0 no próximo Save).
- Redesenho do ciclo DISCUTIDO (aprovado em estratégia): RestPos por eixo = pos
  inicial de receita (E1 1210 / E2 1100 / E4 114,46), `PassagemPos_mm_1..4=10`
  p/ ABRIR PASSAGEM, approach 400 mm/s (só MoveAbs; rastreio/jog/homing fora),
  R15/R16/R07/R011 por eixo, GRAFCET intacto; ConveyorOK analisado (3 vias em
  OR — não para a linha à toa; sem mudança no R052).

**Pendências (abertas ao pausar)**
- ⚠️ **Runaway E4R (Servo3)**: no INIC, acelerou ao fim de curso positivo com
  pancada (2ª vez). NÃO foi homing (guarda `NOT Homed` + user confirma sem
  acionamento). Candidatos: (1) parâmetro de direção do drive revertido em
  power-cycle (RAM≠EEPROM; motor espelhado) — conflita com sync ok atual;
  (2) corrida alvo×bit-setpoint no gateway c/ registro zerado; (3) `Homed`
  stale (ponto cego documentado da AOI Rev 1.6: comm-loss como proxy de
  power-cycle SÓ se o gateway cair junto). Experimento definido: dump de
  parâmetros drive 3×4 via el8ec-toolkit (USB-C tuning, dança do cabo) +
  power-cycle controlado do drive 3. AGUARDANDO sinal do Pedro (USB).
- Sonda de 2 ciclos (handshake PVI do 2º carro) armou mas não rodou (runaway
  interrompeu); `seq_probe.py` pronto no scratchpad.
- Patch R020 v3 (RestPos por eixo etc.) aguarda: gap da sequência GMSim +
  rodada instrumentada + correção de receitas (Pedro; curvas terminam elevadas).
- EEPROM save nos 4 drives (backlog); guarda pré-INIC (ler 4× Homed) a adotar.

**Links**: `plc/2026.07.18_patch-arme-deslig/` · `curvas-256-bancada-suave-xz0/`
· `VERSOES-RECEITAS.md` · HMI William `192.168.0.223:8090` (LINK/estilo/speed/
START; Reset dele só alcança o fake-IRIS em modo LOCAL).

---

## Adendo 5 — runaway E4R: drives inocentados, lacuna é no caminho do setpoint

**Feito**: dump comparativo drive 3 × drive 4 via el8ec-toolkit (USB-C tuning,
local): IDÊNTICOS — direção 0x607E=0 nos dois (espelho E4R/E4L é fiação/mec.,
não parâmetro), Pr0.xx todos 0, método 17, homing manso (busca 33 mm/s, aprox.
3,3 mm/s). Conclusões: (a) pancada NÃO foi homing (33 mm/s < jog) — foi perfil
MoveAbs/sync a 200 mm/s; (b) candidato "parâmetro revertido" morto; (c) EEPROM
save sai da lista.

**Mecanismo provável**: AOI streamando sync (bit4=1 + alvo counts) durante
power-cycle do drive (invisível — CommOK é do gateway); drive reboota com
contador zerado e recebe habilita+new-setpoint+alvo do frame VELHO → arranca ao
batente. Sequência de habilitação da AOI (5→30) NÃO pré-carrega
TargetPosition:=ActualPosition (verificado no snapshot (7)).

**Hardening proposto (próximo pacote AOI)**: (1) target-preload no estado 20;
(2) supervisão de vida por eixo via Statusword (reboot → estado seguro +
Homed=0); (3) checar config freeze/clear do ABC3107 em erro de subnetwork.
**Confirmação pendente**: power-cycle controlado do drive 3 c/ USB + PLC em
modo seguro. Dumps: `scratchpad/param_dump_drive3.txt` / `_drive4.txt`.

---

## Adendo 6 — runaway (pré-existente), caps de drive, R020 v3, bugs de movimento

**Runaway — causa raiz achada no código (mas NÃO reproduzido hoje):**
- É **pré-existente** (acontece sem o v3; a AOI 1.8 NÃO resolveu — Pedro confirmou).
- Mecanismo: no **SYNC_ENTER (estado 90) da AOI**, ela escreve `Rx.TargetPosition := SyncTarget_mm` clampado **só à soft-limit** (não à CurPos) + ControlWord bit5 "change immediately". Se `SyncTarget_mm` estiver **velho/distante** no scan do engate → salto imediato na velocidade de perfil. Overshoot além do soft-limit (E4 a 1242 > 1057) = inércia.
- Por que a **AOI 1.8 não pegou**: item 1 (alvo-segue-atual) protege `Rx.TargetPosition` nos estados OCIOSOS (caminho MoveAbs). `SyncTarget_mm` é variável SEPARADA do caminho sync — a 1.8 nunca a tocou. **Consertou a variável errada.**
- Resíduo confirmado no R021 (comentário do próprio código): no fim da rodada o `SyncTarget` **CONGELA no último valor** (não zera). Intuição do Pedro ("resíduo do fim da rodada anterior") = correta.
- **FIX proposto (AOI 1.9, sobre a 1.8)**: engate BUMPLESS — no 1º scan do SYNC_ENTER inicializar alvo = CurPos, e **slew-limit por scan** de `Rx.TargetPosition` (máx VelMax·dt). Teto físico de velocidade + resíduo inofensivo. + limpar SyncTarget:=CurPos/AutoEng:=0 no fim (defesa). NÃO GERADO ainda (aguarda decisão).
- **ServoAxis4.Cfg=50000/30000 é INERTE** (nenhuma leitura fora do R001) — NÃO é a fonte da velocidade. Retirei essa hipótese.

**Caps de segurança nos 4 drives (via USB, RAM) p/ reprodução segura:**
- `Pr7.11=1800` (600 mm/s) · `Pr3.24=1800` (600) · `Pr5.13=2250` (trip overspeed ~750 mm/s → drive FALTA). Torque `Pr0.13=350` (restaurado p/ receita rodar). Passo 20 mm.
- servo3 tem também FIR `Pr2.23=300` (30 ms, do teste A/B).
- Originais TODOS: `Pr7.11=7000 · Pr3.24=0 · Pr5.13=0` (registrados em `scratchpad/drive_caps_servoN.orig`).
- Scripts: `scratchpad/drive_caps.sh set|restore <servoN>` (blindado contra sobregravar orig). `0x6080`/`0x607F`/accel NÃO escrevíveis (só nome PrX.YY) — trip cobre.
- `write` do el8ec_tool é POSICIONAL (`write PrX.YY valor --yes`), NÃO aceita `--addr`. Read aceita `--addr` e `--bits 32` (flag ANTES do subcomando).

**Reprodução (sonda residual_probe.py, ~132 Hz, read-only): runaway NÃO reproduziu** em sequência de carros (16 engates, 0 saltos; maior gap E1=6,6 mm). Suspeita: gatilho é **parar/re-armar** (DESLIG→re-INIC), não carros consecutivos. Keeper relança a sonda (600s) no mesmo log. CSV: `scratchpad/residual_run_1784341250.csv` + `residual_plot.png`.

**Bugs de movimento CONFIRMADOS no dado (Pedro viu na bancada):**
1. **`RcpSlot` PERMANENTEMENTE 0** durante todo S2/S3 (AutoSlot=2 correto). O S1 aparece PULADO (S0→S2 direto) → R022_RcpLookup (gated em S1) nunca roda → RcpSlot fica 0. Impacto: **janelas de câmera leem RcpAuto[0] VAZIO** (câmeras não disparam por janela); o approach leria RcpCurve[0]=0 mas o pré-posicionamento salva (Target correto, sem MoveAbs espúrio). Rastreio sobrevive só via AutoSlot no R021. **FIX: garantir S1/R022 rodar, ou repontar approach+janelas p/ AutoSlot.**
2. **E2 rastreia GROSSEIRAMENTE errado**: RMS 301,8 mm, máx 521,7 mm vs SyncTarget (E1/E3/E4 ~20-25 mm). E2 não segue o comando — investigar (pós-caps? SyncVel? recipe?). Na validação fim-alto ANTES dos caps o E2 era 8 mm — ver se os caps de 600 quebraram, ou outra coisa.
3. E1/E3/E4: erro moderado 20-25 mm RMS, picos ~100-123 mm.

**Arquitetura (realização do Pedro, muda o v3):** NÃO há gap temporal entre carros — a B02 do carro N cai junto com a B01 do N+1; só separação ESPACIAL (2302 mm). O retorno a RestPos tem que ser **tecido no início do novo ciclo**, handover durante a receita (não um estado bloqueante em S4 como o v3 faz). O "gap de ~6 s" que eu media era tempo de VIAGEM do carro, não ocioso.

**R020 v3**: importado e rodando (R011 v3 calcula RestPosLo/Hi por eixo; InterCycleT_s testado 3.0 e 4.5). Causou o runaway multi-eixo (E2/E3/E4 juntos). Curvas **fim-alto** gravadas nos slots 2/3/4 (E1/E2 terminam elevados). Pacote em `plc/2026.07.18_patch-r020v3-ciclo/` (CSV corrigido p/ CRLF — gotcha de import). Bench-panel ABRIR PASSAGEM re-roteado p/ PassagemPos (subagent, NÃO deployado). HTML Rev 19 + 3 fluxogramas gerados.

**Estado da bancada ao pausar:** DESLIG provável; 4 drives CAPADOS (RAM — restaurar depois!); FIR no servo3; sonda rodando via keeper; voláteis do v3 no PLC (RestPos_mm_N, InterCycleT_s, etc.).

**Pendências (ordem):** (1) AOI 1.9 bumpless+slew — o fix real do runaway; (2) fix RcpSlot/S1/R022 (câmeras); (3) E2 mistracking; (4) reproduzir runaway pelo caminho parar/re-armar; (5) restaurar caps de drive antes de operação normal; (6) redesenho do retorno "tecido no novo ciclo" (arquitetura sem gap).

---

## Adendo 7 — ACHADO UNIFICADOR: perda de sync + re-engate por borda

Análise do State da AOI no `residual_run_1784341250.csv` fecha o mecanismo e
UNIFICA runaway + congelamento do E2:
- **E1**: State **91 (SYNC_RUN) 100% do rastreio** → segue a receita (amplitude 1210 mm). OK.
- **E2/E3/E4**: **7326 amostras em State 30 (OCIOSO)** durante o rastreio com SyncEngage=1.
- E2 flagrante: `SyncTarget` desce 1100→578 (receita), `SyncVel` sobe a 108, mas
  `CurPos` **CONGELA em 1100** → gap chega a 521 mm. Eixo comandado e NÃO se move.

**Mecanismo (mesmo para os 2 sintomas):**
1. `SyncEngage` cai por 1 scan (lacuna na condição de engate do R021) → AOI sai do
   91 e volta pro **State 30**.
2. `SyncEngage` volta a 1, mas engate da AOI é por **BORDA** (`SyncEngage_OS`) →
   sem nova borda, AOI fica **presa no 30**. Eixo congela enquanto o comando anda.
3. SE nova borda ocorre → AOI re-engata **pulando** de CurPos p/ o `SyncTarget` já
   DISTANTE → **RUNAWAY** (SYNC_ENTER sem slew, só clampa soft-limit).

→ **Congelar (E2 hoje) e disparar (runaway) são o MESMO bug**: perda de sync +
re-engate por borda. Congela se não re-engata; salta se re-engata com alvo longe.

**FIX (mesmo AOI 1.9): (a)** engate BUMPLESS + slew-limit no SYNC_ENTER — re-engata
sem pular (mata runaway) e persegue o alvo (mata o congelamento no salto); **(b)**
fechar a LACUNA do SyncEngage no R021 (por que cai 1 scan — provável gap entre
AutoEng/AutoTrackOK/FREEZE) para não perder o sync em 1º lugar; **(c)** opcional:
AOI re-entra sync por NÍVEL (não só borda) quando SyncEngage=1 e State=30 —
mas COM o slew, senão vira runaway. Explica também E1 imune (nunca perdeu o 91).

---

## Adendo 8 — 4º sintoma (rastejo) confirmado: TODOS são um problema só

Flagrante do rastejo no CSV: **t=82,7→100,4 s, E1 leva 18 s** rastejando 1116→1210
(94 mm) a **SyncVel=5 mm/s** (State 91). Também no rastreio (t=35,9→46,3 E1 desce a 5
mm/s com 50 mm de erro). Causa: **Kp=0** → velocidade só feed-forward
(`SyncVel=velFF+Kp·erro`); quando a curva achata (velFF→0) sobra só o piso 5 mm/s
p/ fechar resíduo → rastejo longo. Kp foi zerado (decisão Pedro) por medo do pico
no engate.

**QUADRO UNIFICADO — 4 sintomas, 1 raiz (velocidade FF-only + engate por borda + sem slew):**
| sintoma | mecanismo |
|---|---|
| runaway | re-engate pós perda-de-sync salta pro alvo distante (SYNC_ENTER sem slew) |
| E2 congela | perde sync (→State 30), não re-engata (borda) |
| rastejo | Kp=0: FF→0 perto do alvo, só piso 5 mm/s |
| lag trecho rápido | Kp=0: sem termo de erro p/ alcançar |

**FIX unificado (1 pacote):** (1) AOI 1.9 = engate bumpless + slew-limit por scan
→ mata runaway E habilita Kp com segurança (slew limita vel independe do erro);
(2) `Kp>0` → mata rastejo+lag; (3) R021 = fechar lacuna do SyncEngage + re-engate
por NÍVEL (com slew) → mata congelamento. Ordem: slew PRIMEIRO (segurança), depois
ligar Kp.
