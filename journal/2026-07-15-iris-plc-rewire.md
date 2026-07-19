---
type: Session Log
title: "IRIS 03007 — Rewire PLC sobre AOI: Fase 1 adapter + Onda 1 (S/2/3/5)"
description: "Fechamento da Fase 1 (adapter _Adp + CSV de tags), fases 0.5/0b, decisão de escopo controller-scope, e onda paralela de 4 fases com doc de reconciliação de fronteira."
session: 2026-07-15
tags: [iris-plc-rewire, iris-scds, "03007", automacao, plc, grafcet, cia402]
timestamp: 2026-07-15
product: IRIS
language: pt-BR
---

# IRIS 03007 — Rewire PLC sobre AOI (Fase 1 + Onda 1)

## Feito
- **Fase 0.5** (inventário mm-layer): achado central — o snapshot do Thiago **já migrou p/ a AOI**; os campos `EnableState/Ramp.*/HomeState` ficaram **órfãos** = exatamente o que o adapter sintetiza.
- **Fase 0b** (contrato WS/GM): 8 UDTs `UDT_IF_*` + 11 instâncias + `IF_Station[11]`; GM já idêntico (não importar); 19 L5X xmllint OK.
- **Fase 1 fechada**: 12 rotinas `Servo{1..4}_{In,_,Out}_Adp` + `adapter-tags.CSV` (47 controller tags). Bug `MIN()` (inválido no ST-Logix) → clamp por `IF`. Offsets EDS **88/84** confirmados. Pacote zip entregue ao Thiago.
- **Onda 1 paralela** (4 subagentes): Fase S (`R007_Safety`), Fase 2 (`R011`/`R031`), Fase 3 (`R010`/`R030`), Fase 5 (`R006`/`R050`/`R052`) — 8 rotinas, todas xmllint OK.
- HTML master do plano → **Rev 3** com histórico de revisões (data/hora) + status por fase.

## Decisões
- **Escopo — mm-layer partida** (grafcets no MainProgram × AOI/adapter no programa Servo, `ServoAxis` program-scoped duplicado, `AxisOK` só no MainProgram): **unificar em controller-scope** (Opção A) — promover `ServoAxis1..4`/`AxisOK`/`EnableServo1..4`, apagar os sombreamentos. Batch via CSV.
- **Perfil PP** vem da **recipe por movimento** + clamp 1000 mm/s (default 200 até cablar); tags `Cfg.*_ups` legacy (counts/s) descartadas.
- Jog `+1=JogFwd` (afasta do motor); re-home = **latch** (guard `NOT Homed` na AOI Rev 1.1); Zero_Button removido (patch R051); `ZeroOffset` fonte única = AOI.
- Anticolisão **global** via `AxisOK` → **`SafetyOK`** (Fase S) supersede o placeholder `EXT_GMSafetyOK` e o `AxisOK` no adapter.
- **Thiago ≠ Amantrini** (correção do Pedro; memória salva).

## Pendências
- **Thiago remapeia só o `Servo1`** e devolve → **replicar em 2/3/4** via `gen_adapter.py` (template único).
- **Revisão obrigatória do adapter** (bloqueia teste ao vivo): deadman congela em standstill no homing sequencial → usar `InitHeartbeat`/`St_HomingActive` (produzidos por R011) como liveness no init.
- **Patch do MainRoutine**: inserir `JSR(R007_Safety)` entre R005 e R010; remover `AFI()` do R030.
- **Decisões do Pedro**: nome `SafetyOK`; envelopes/soft-limits/HW-limits + matriz de categorias de parada; rótulo bit `R010_STEP.0`; `LastCmdSeq`×`WSCmd_Seq`; polaridade `PDB_Delta`; confirmar `PRV10IRIS5:O.Data=SINT[128]`; ~23 do contrato 0b.
- Fase 4 (Auto R020) e Fase 6 (Sync R021) bloqueadas (dep. 2+S e 4+0.5). PDF Rev 3 do plano a re-exportar.

## Links
- Plano: `pmo/projects/03007/plc/2026.07.14_cia402-pp-aoi/IRIS-03007-Plano-Rewire-AOI.html` (Rev 3)
- Reconciliação onda 1: `plc/2026.07.15_onda1-reconciliacao-fronteira/RECONCILIACAO-onda1.md`
- Adapter Fase 1: `plc/2026.07.15_adapter-template/` (+ pacote `2026.07.15_adapter-fase1-import/`)
- Inventário 0.5: `plc/2026.07.15_fase0.5-mmlayer-inventario/INVENTARIO-mmlayer.md`
- Contratos: 0b `plc/2026.07.15_fase0b-contrato-wsgm/`; WS `handoffs/2026.07.14_contrato-ws-arthur/` (Anexo D); GM `handoffs/2026.07.13_gm-sim-plc-buyoff/`
- Onda 1: `plc/2026.07.15_{faseS-seguranca,fase2-homing-init,fase3-modo-manual,fase5-contratos-wsgm}/`

## Adendo (15:40) — Onda 2 → decisão "direto total"

- **Pivô do integrador (snapshot `Iris_Strokmatic_120726_3.L5X` → `(1).L5X`):** a mm-layer
  `ServoAxis` foi **abandonada**. O Thiago aplicou o plumbing — 12 rotinas `_Adp` importadas,
  glue antigo `Servo1..4` removido, **AOI liga em `Servo{N}Rx/Tx`**, `R002_Scale` reposicionado,
  JSRs dos `_Adp` ligados. Os grafcets ainda estavam em `ServoAxis`.
- **DECISÃO (Pedro): DIRETO TOTAL** — a AOI instância `Servo{N}` é a interface. Comando nos
  inputs mm da AOI (`Servo{N}.Target_mm/.MoveAbs/.JogFwd/.Home/.Vel_mmps`); feedback nos outputs
  nativos (`Homed/CurPos_mm/Fault/State/Busy/Homing/HomingError`; erro em `Servo{N}Tx.LastErrorCode`).
  **NUNCA comandar em `Servo{N}Rx.*`** (é o PDO em counts que a AOI escreve). Elimina as camadas
  intermediárias `AxCmd/AxFb` (Onda 2, SUPERSEDIDA) e a síntese `EnableState/Ramp*`.
- **Onda direto-total (5/5, xmllint OK, 0 refs residuais):** fases 2 (R011 ±0.5/R031), 3 (R010/R030),
  5 (R006/R050/R052), S (R007) re-apontadas p/ AOI direto; **não-coberto** (R001 remove `Cfg.*_ups`
  legacy · R004 `EnableState≥90`→`Fault OR State=250` · limpeza de ~94 linhas mortas/`_Adp`).
- **Verificação R007×R003:** R007 **não duplica**. R003_Faults = 2 rungs (fonte do `AxisOK` +
  FaultReset); R004 só reporta. E-stop/STO/soft-limits/envelope/parada/`SafetyOK` = **novos**.
  → R007 justifica-se separado; **R003 NÃO é legado** (fonte do AxisOK, R007/R004 dependem).
- **Tags a criar antes do import:** `SafetyOK`, `InitHeartbeat`, `St_HomingActive/Err`, `WSCmd_Seq`(DINT).
- **Bring-up / decisões:** índice E4R=Servo3/E4L=Servo4 [Thiago]; fonte do perfil `Vel/Accel/Decel_mmps`
  (recipe × adapter); `MoveAbs` por borda (jog-passo) × contínuo (R021 tracking); **unidade Anexo D**
  `IF_Axis.Pos` REAL mm × DINT counts (encoder Classe 1 Fase B — reconciliar c/ Arthur); remover `AFI()` do R030.
- **Handoffs entregues:** `handoffs/2026.07.15_ajustes-contrato-ws-arthur.md`,
  `handoffs/2026.07.15_acoes-integracao-thiago.md`; pacote `plc/2026.07.15_servo234-import/…zip`.
- **Docs-mestre:** `plc/2026.07.15_onda2-balanco/RECONCILIACAO-onda2.md` (direto-total),
  `plc/2026.07.15_fase0b-contrato-wsgm/RECONCILIACAO-wsgm.md §8` (decisões 0b),
  verificação em `plc/2026.07.15_faseS-direto-total/VERIFICACAO-R007-vs-R003.md`. Plano HTML **Rev 5**
  (cap. 0.3 cobertura de rotinas).
- **Entregáveis direto-total:** `plc/2026.07.15_fase{2,3,5}-direto-total/`, `faseS-direto-total/`,
  `naocoberto-direto-total/` (import-ready; **ainda não importados** pelo Thiago).

## Adendo 2 (17:00) — Pacote 2 enviado + cenário de safety real → Pacote 3 (Interlock)

- **Pacote 2 entregue ao Thiago** (`plc/2026.07.15_pacote2-import/IRIS-03007-pacote2.zip`): 21 L5X
  (fases 2/3/5 + não-coberto, **sem Fase S** — retida p/ iteração) + CSV com só **8 tags novas**
  (verificado contra o snapshot: Servo1..4/Rx/Tx e as 47 aux dos `_Adp` já importadas por ele).
  Janela init **±0.5 mm** confirmada; perfil interino via `Rcp*_Adp` (200/clamp 1000), receita depois.
- **Cenário de safety REAL (Pedro)** — bem mais enxuto que o R007 v1 assumia:
  - Segurança nominal = **Armor Block safety da GM → STO dos drives**, sem passar pelo PLC
    (5069-L310ER standard, sem Safety Task). NÃO existe E-stop no nosso sistema.
  - Fins de curso físicos → **DIs dos drives** (não do PLC); leitura indireta via Fault/ErrorCode.
  - `DI_Barreira_01/02` NÃO são safety: **sensores de saída (Pt00) / entrada (Pt01) do pórtico**
    → renomear `DI_SaidaPortico`/`DI_EntradaPortico`. Cruzamento de envelopes entre eixos é
    **by design** (sincronia = lógica/receitas) → **sem monitor de gap** no v2.
  - `DI_ContactorFeedback` ×2 (Pt06/07) = contatores mestres dos **6 SSRs das resistências**
    → falha corta aquecimento + alarme, **sem travar eixos**.
  - Anticolisão: Pt02..05 → Servo1..4 **na ordem** (um sensor por eixo).
  - Contrato GM **cobre** safety de linha: `GM_In.SafetyOK` (BIT). Bug achado: R052 publicava
    `WS.SafetyOK := EXT_GMSafetyOK` (órfã, sempre 0) → fix `:= GM_In.SafetyOK`.
  - Renames: **`SafetyOK` → `InterlockOK`**; rótulos de doc **E1/E2/E4R/E4L** ↔ Servo1..4
    (só documentação, nenhum identificador muda).
- **Pacote 3 gerado por subagent** (`plc/2026.07.15_pacote3-interlock/IRIS-03007-pacote3.zip`, 33 KB):
  `R007_Interlock` novo (anticolisão + soft-limit monitor c/ **guard de config** `S_SoftLimCfgOK_1..4`
  + `S_LineOK` GM + `S_PowerOK_{N}` via `Servo{N}Tx.StatusWord AND 16#0010` + heating à parte +
  latch/`Reset_Cmd` → `InterlockOK`, causas 1..4); R005 (renames + Pt06/07); R050 (gate de
  aquecimento **em série nos rungs** — SSRs são OREF dos PIDs R100..R105, evita dupla escrita);
  R010/R011 (InterlockOK); R052 (fix + re-aponta IF_Safety/IF_Sensors p/ fontes vivas);
  CSV 22+1 tags; MANIFEST (renames no Studio ANTES do import; órfãs a apagar: `Safety_*`,
  `AntiCollision_*`, `GM_SafetyOK`, `EXT_GMSafetyOK`, `SafetyOK` pós-reimport).
  xmllint 6/6 + greps de regressão zerados. **Aguardando review do Pedro** antes de enviar.

## Adendo 3 (18:30) — Pacote 4 + errata de import + Plano C de tags + sim/receitas

- **Pacote 4 fechado** (`plc/2026.07.15_pacote4-auto/IRIS-03007-pacote4.zip`): R020 direto-total
  (janela ±0.5; recipe por style `RcpAuto_Pos*_mm[8]` via `GM_In.Station[0].Style`, identidade
  0..7 placeholder; gancho `[SIM]`; abort+re-arm) + **fix d4 no R030** (zerava `MoveAbs`/jog/home
  CONTINUAMENTE fora do MANUAL, matando os pulsos do R020/R011 → agora só na borda de saída;
  MANUAL=0, não 2) + **`WSCmd_Mode`** no R010 (pedido de modo via pylogix, mesmas regras das
  transições locais, ack=-1, echo em `IF_Sys.Mode`) + adendo Arthur
  (`handoffs/2026.07.15_adendo-wscmd-mode-arthur.md`). Achado da fase 4: o R020 v5.5 escrevia
  `Target_mm` mas **nunca pulsava `MoveAbs`** — o auto era inerte.
- **Import real do pacote 3 falhou (76 erros)** → root cause: **SPECIFIER do CSV RSLogix não cria
  dimensão** (é p/ alias) — `SafeSoftLim*` nasceram escalares; MESMO defeito pré-existia nas 0b
  (`IF_Axis/Track/Station` escalares no projeto vivo) derrubando o R052. Bônus: warning "Shorted
  branch" revelou **bug pré-existente no R003 rung 0** — branch paralelo VAZIO curta os XIOs →
  `AxisOK` sempre 1 (anticolisão via AxisOK NUNCA funcionou; R007_Interlock lê DIs direto, imune).
- **CSV corrigido também falhou; tag-L5X idem** → **Plano C**: (1) `TABELA-TAGS-MANUAL.md`
  (digitação no tag editor — 22+1 tags pacote 3, 8+2 pacote 4, correção Dimensions IF_*[4/2/11] e
  SafeSoftLim*[4]); (2) piloto `R007_Interlock_ctx.L5X` com tags embutidas em `<Context>`
  (serialização mimetizada do snapshot: array = atributo `Dimensions="N"` + Data L5K/Decorated,
  ref `Temp_PV` REAL[7]) — se o wizard oferecer Create, vira o caminho dos próximos pacotes.
- **Simulação (discussão iniciada)**: William já avançado simulando a linha p/ rodar no "PLC GM
  simulado". Fronteira proposta: William substitui o PLC GM (produz `UDT_GM_Com_In` byte-idêntico
  + consome `GM_Out`) e os cenários/harness ficam lá; no nosso PLC só a chave de sensores.
  **Decisão Pedro: UDT separado p/ sim** (`UDT_SIM_Com` consumido como `SIM_In`: Heartbeat/
  SimActive/VirtEntrada/VirtSaida/ScenarioId/VirtLongPos) — contrato de produção congelado;
  consentimento duplo (`SimCfg_Enable` nossa + SimActive + hb fresco); mux em camada lógica
  `Snsr_*` (R005 = espelho fiel); `IF_Sys.SimActive` publicado; interlock NUNCA simulável.
  Handoff p/ William pendente de aprovação; implementação nossa = pacote 5.
- **Receitas (aberto, chave p/ o Auto)**: pacote 4 tem posições por style mas janelas de câmera
  ainda globais, velocidade não-recipe e NINGUÉM popula os arrays. Recomendação apresentada:
  **WS resolve receita por job** (lookahead `IF_Station[11]` → WS escreve bloco "receita ativa"
  via pylogix c/ `RcpAuto_Seq` handshake; fallback residente mínimo + alarme). Aguardando decisão.
- Jog/home da WS: cadeia mapeada — R030 já consome `WSCmd_Jog*`/`Home*`; faltava só `AFI()` +
  interlock vivo + modo MANUAL (gap de contrato virou o `WSCmd_Mode` do pacote 4).
- Plano HTML → **Rev 6** (PDF ok): §0.3 por pacote, Fase S supersedida → Interlock, Fase 4 em curso.

## Adendo 4 (19:00) — Espec dos UDTs de sim + review do GM-Sim do William

- **Espec escrita** (aguardando review do Pedro, NÃO commitada):
  `pmo/projects/03007/specs/IRIS-03007-Contrato-SIM-UDTs.md` — 2 UDTs **direcionais**
  (`UDT_SIM_ToIris`: Heartbeat/SimActive/ScenarioId/VirtEntrada/VirtSaida/VirtLongPos;
  `UDT_SIM_FromIris`: SimAck/SysMode/InterlockOK+causa/CycleStep/AxisPos[4]/AxisHomed/IrisReady),
  definição idêntica nos 2 projetos (exigência P/C), cada um produzido por um lado.
  4 conexões na bancada; produção = módulo GM-Sim inibido → sim morre por construção.
- **Confirmado**: conexões P/C simultâneas e exclusivas por UDT funcionam nativamente
  (cada consumed tag amarra a UM produtor; RPI próprio; SIM em 100 ms).
- **Review do `GMSim_Buyoff_IRIS03007.L5X` (William)**: camada lógica COMPLETA — runner de
  cenário (6 estados, 3 modelos `Cfg_Recipe_VID/Style[3]`), heartbeat c/ injeção de falha
  (`Sim_HbFreeze`), watchdog do IRIS, monitor de endurance c/ first-out fault, FakeIris
  (temporário). **Gaps**: (1) sensores via `Spare1[0].0..5` do contrato GM (migrar p/ canal SIM;
  anticolisão NÃO migra — interlock rail); (2) **sem modelo de tempo** — bits manuais, sem corpo
  virtual (⚠ mapeamento B01↔Pt00=SAÍDA, B02↔Pt01=ENTRADA); (3) sem telemetria de volta além
  do GM_Out. **William avança a parte de tempo amanhã (2026-07-16) — discussão pausada aqui.**
- ⚠ Cruzamento: styles do William são DINTs reais configuráveis → vão expor o placeholder
  identidade-0..7 do R020 no primeiro run. **Decisão de receita (WS resolve por job × tabela
  PLC) segue aberta e segura o envio do pacote 4.**
- Handoff do William: pendente do review da espec pelo Pedro.

## Adendo 5 (19:50) — Bring-up do jog no bench + errata 2 + AOI Rev 1.2 + UDTs sim

- **UDTs de sim gerados** (`plc/2026.07.15_sim-udts/IRIS-03007-sim-udts.zip`): `UDT_SIM_ToIris` +
  `UDT_SIM_FromIris` no formato dos UDT_IF_* (caminho de import comprovado) + README (tags e
  conexões MANUAIS — tag-L5X falhou no v38). Mesmos arquivos p/ os 2 PLCs.
- **Bring-up jog Servo3 (snapshot `(2).L5X`, pacotes 2+3+errata dentro)** — cadeia de 3 bloqueios:
  1. Deadman comia `WSCmd_Jog3` (sem WS incrementando JogRefresh) → caminho local =
     `JogFwd/Bwd_Button.0..3` (bit por eixo, sem deadman). Thiago já tinha posto
     `JogDeadman_Scans=1e8` (lista de bypasses!).
  2. **Polaridade das barreiras INVERTIDA** (fato de campo): sensores NC/feixe — elétrica 1 =
     feixe intacto → `CarPresent=1` permanente + `JogOpenDir=0` = jog bloqueado 2 sentidos.
     **ERRATA 2 do pacote 3**: XIC→XIO nos rungs Pt00/01 do R005 (TRUE = corpo detectado);
     todos os consumidores (R030 CarPresent, R020 3 rungs) já assumiam a semântica normalizada.
     Espec de sim ajustada (Virt* emulam o pós-normalização). **Pendência: `JogOpenDir1..4`**
     (+1/-1 por eixo, sentido que afasta do corpo) antes de jog com corpo no túnel.
  3. **Servo3 jogou até o FDC negativo**: drive NÃO entra em falha CiA402 — fica 0x0027 c/
     StatusWord bit7 (Warning) + bit11 (Internal Limit) e FDC em `Tx.DigitalInputs` bit0
     (0x60FD). AOI fica no estado 30 "saudável", FaultReset inócuo, `NOT Enable` sem efeito.
     Destravar = **jog no sentido oposto** (limite bloqueia só a direção dele).
- **AOI Rev 1.2 gerada** (`plc/2026.07.15_aoi-rev12/`): saída por `NOT Enable` (estados 30/50);
  outputs `LimitNeg/LimitPos` (DigitalInputs bits 0/1 — conferir EL8-EC) +
  `DriveWarning/InternalLimit` (SW bits 7/11); guarda de jog contra limite ativo. Diff auditado:
  +29/-0/±2 linhas. **Candidato Rev 1.3**: estados 41/42/43 (handshake PP) não checam
  Enable/IsFault — presos até Halt se o drive faltar no meio do move.
- Contrato Arthur (a adendar): WS mostrar `Warning/InternalLimit/LimitNeg/LimitPos` por eixo.

## Adendo 6 (21:00) — Bug do jog da AOI → Rev 1.3

- **Bug de campo (eixo 3, pré e pós 1.2)**: jog andava só para UM lado independente do bit, e
  não parava (nem soltando o bit, nem `Halt`). Causa raiz por leitura da AOI + valores da
  instância no snapshot `(2).L5X`:
  1. Jog contínuo (estado 64) mirava o **EXTREMO do soft-limit** (JogFwd→Pos / JogRev→Neg) —
     e a janela do Servo3 estava **com sinal invertido** (`[-1245,-5]`; pós-homing método 17 o
     curso real é positivo) + eixo não-homado em -0.09 → os DOIS alvos eram negativos → sempre
     andava pro negativo (por isso foi ao FDC).
  2. Parada dependia só do **CW bit8** (estado 68); se o drive ignora, o timeout de 2 s voltava
     ao 30 **sem cancelar o setpoint** → move continuava. Input `Halt` ignorado em todos os
     estados de jog/handshake (só o 30 lia).
- **AOI Rev 1.3 gerada** (`plc/2026.07.15_aoi-rev13/`, base 1.2): jog por **segmentos
  encadeados** (`JogSegment_mm`=50, direção SEMPRE do JogDir, clamp só homado+config válida,
  não-homado permitido em passos curtos); **parada ativa estado 69** (re-alvo p/ posição atual
  + bit8 + change-immediately — para mesmo sem bit8; substituiu o 68); `Halt` honrado em
  41-43/60/64/66/67/70-72; fix 41/42/43 (fault/enable no meio do move abs → 5); outputs
  `SoftLimCfgOK`/`JogBlocked`. Diff auditado: PP/homing/sync intocados.
- **Config a corrigir nas instâncias (Thiago)**: sinais dos `SoftLimit*_mm` dos 4 eixos.
- Checklist de bancada i-viii no MANIFEST; item viii = observar se bit8 sozinho freia (decide
  simplificação futura). Pedro testa 1.2+1.3 de uma vez.
- **Pós-1.3 (campo): 2 sintomas novos** (dois botões = mesmo sentido; disable ok mas re-enable
  cai em erro) → **BUG RAIZ desde a Rev 1.1: `JustEnter` NUNCA dispara** — `State_Last := State`
  executava DEPOIS do CASE (capturava o State já transicionado). Efeito dominó: `JogDir`/
  `JogStartPos` nunca latcham (JogDir=0 → todo jog caía no tap → alvo 0.0 clampado à janela
  invertida = move p/ -5 mm, qualquer botão); timers `Reset := JustEnter` nunca resetam (TONR
  retentivo → ACC sujo → estado 20 com DN instantâneo → State 200 no re-enable); StopTarget do
  69 (1.3) não capturado → parada podia comandar move p/ 0 (⚠ aviso: não testar jog na 1.3 pura).
- **HOTFIX Rev 1.3.1** (`CiA402_PP_Axis_Rev131.L5X`, no mesmo zip): 1 linha movida
  (`State_Last := State` p/ logo após o JustEnter) + auditoria dos 13 usos de JustEnter (todos
  OK na semântica nova; interação com guard CommOK verificada). Studio exibe "1.4 hotfix 1.3.1"
  (campo Revision só aceita major.minor). Explica retroativamente vários "mistérios" do bring-up.

## Adendo 7 (22:40) — Jog pulsado (bit5) + auditoria do homing (4 CRÍTICOS) + Rev 7

- **Jog segue pulsado na Rev 1.5** → investigação (`INVESTIGACAO-jog-pv.md`): PDO 22B/eixo 100%
  ocupado, TargetVelocity = **0x6081** (dump real) → pv modo 3 descartado (confirmado por Pedro);
  bit5 nunca foi comprovado no EL8-EC (teste de streaming de 14/07 nunca rodou). Opções: (1) jog
  por **alvo único distante + parada ativa** (Rev 1.6, robusto por construção); (2) **bit9**
  change-on-set-point → **Rev 1.5b_TESTE gerada** (0x021F, 1 linha; critério A/B); (3) bit5 via
  config **0x60F2** → **PROCEDIMENTO-bit5-modbus.md** (USB-C direto /dev/ttyACM0, ID 63, espelhos
  CoE 0xB3xx por lookup — NÃO stride 0x80; writes RAM-only, reversão por power-cycle; leitura
  decisiva: 0xB3B7). ⚠ **Sync (90/91) também usa bit5** — Fase 6 depende do mesmo veredito.
- **AUDITORIA-homing.md — 4 CRÍTICOS**: **E2** deadlock do init no sucesso do homing (método 17
  zera NA chave → 0.0 fora da janela [+5,+1245] → R007 derruba interlock; fix = `RestPos_mm`
  ~+10 no R011/R020 — valor pendente do Pedro); **C1** costura `InitHeartbeat`→adapter NUNCA
  implementada (zero consumidores; deadman pode descartar Home_OS em silêncio; bancada funciona
  por acidente/dither); **F1+F2** `Homed` nunca limpo (nem no 250) + guard `NOT Homed` impede
  re-home → posição falsa pós power-cycle sem remédio; **B1/B2** homing ignora Halt/NOT Enable
  (anticolisão não para homing; fix = estado HOME_ABORT via queda de bit4). **E1**: AOI NÃO
  clampa MoveAbs (premissa do GoAbs do pacote 4 é falsa — clamp entra na Rev 1.6).
- **Rev 1.6 (a disparar)**: HOME_ABORT + Halt/Enable 80-83 + Homed limpo no 250 + clamp MoveAbs
  + SoftLimCfgOK pega janela invertida + jog definitivo (conf. bit9/Modbus). **Pacote 5**:
  costura InitHeartbeat, R031 timeouts/retry, `WSCmd_ReHome`, dono único HomeAll, mux sim.
- **Pacote 4 atualizado**: `WSCmd_GoAbs/GoTarget1..4` (move abs manual) + sincronia total c/
  fixes + tabela manual de tags. **Decisão Pedro: `ManualOK` mantém `AxisOK`; R003 conserta-se
  depois.** Bloqueio de envio: decisão de receitas.
- Plano HTML → **Rev 7** (PDF ok): bring-up real, erratas, AOI 1.2→1.5, pacote 4, sim.
- Memória nova: `reference_l5x_import_gotchas` (crash 0x80042847: RevisionExtension/`<>` em
  RevisionNote; CSV dim no DATATYPE; tag-L5X falha no v38).

## Adendo 8 (23:50) — Testes inline Modbus + semântica real do EL8-EC + Rev 1.6 FINAL

- **Sessão Modbus inline no Servo3** (USB-C `/dev/ttyACM1`, id 63, 500000): espelho CoE ok;
  **0x60F2 MORTO** (write não gruda — par aceita, valor descarta; ímpar = illegal address);
  **0x6502 = 0x03AD** → drive suporta PP/PV/TQ/HM/CSP/CSV/CST (pv é limitação do PDO,
  confirmado); 0x605D=1; **0x605A=2** (quick stop = rampa→Switch On Disabled);
  **0x605B=0x605C=0 → shutdown/disable em movimento = COAST** (nunca usar como freio);
  0x6085/0x60C6 = 0x7FFFFFFF (rampa quick stop ilimitada — item de comissionamento).
- **Teste A (0x6081 em voo): NEGATIVO** — velocidade não muda no meio do movimento. **bit9
  (Rev 1.5b): NEGATIVO**. Semântica fechada: **EL8-EC em PP completa TODO set-point; sem
  blending; sem change-immediately; 0x6081 amostrado só na aceitação**.
- **Descoberta-chave do campo: "com Halt ele para"** — bit8 FUNCIONA quando MANTIDO (estado
  50). O bug era o estado 69: standstill por `CurVel_mmps` (escala nunca validada, lê ~0)
  fechava em ~20 ms — ANTES do Ack do re-alvo (30-100 ms) → bit8 liberado com alvo original
  pendente → drive RETOMA por norma. Por isso soltar o jog completava o segmento.
- **Rev 1.6 FINAL** (`CiA402_PP_Axis_Rev16.L5X`): jog por ALVO ÚNICO (borda da janela homado;
  `JogUnhomedSpan_mm`=200 sem referência; `JogSegment_mm` deprecado) + **estado 69 refeito**
  (fases: bit8 → re-alvo bit4 até Ack → fecha handshake → standstill por POSIÇÃO 5 scans/100
  counts → só então libera bit8; timeout 2s → 5 SEM liberar bit8 no 69) + homing abortável
  (80-83 c/ Halt/NOT Enable → estado 89, standstill por posição) + `Homed:=0` no 250 + clamp
  MoveAbs/JogRel (homado+cfg) + `SoftLimCfgOK` endurecido (janela > 2×margem). Sync 90-92
  intocado (Fase 6 herda a semântica real: estratégia B set-point casado × D remap 0x60FF —
  tolerância de tracking da óptica define).
- Fase 6/sync: teste A negativo mata o "pv disfarçado"; baseline = set-point casado com a
  linha + correções esporádicas; remap do assembly (Accel/Decel→0x60FF, config via Modbus)
  é a opção definitiva se a tolerância exigir.
- Pacote 4: explicada a pendência de receitas (dono: (a) PLC-resident × (b) WS resolve por
  job via lookahead IF_Station[11] + bloco ativa c/ Seq — recomendação (b)). Aguardando decisão.

## Adendo 9 (22:57) — Receitas DECIDIDAS (residente, 16 slots) + pacote 4 revisão final

- **Correção de premissa (Pedro)**: NÃO há lookahead — `Station[0]` é a NOSSA estação, a
  primeira da linha (as demais são posteriores). O job chega junto com o corpo → resolver
  receita por job na WS é impossível. **Modelo decidido: tabela RESIDENTE no PLC com TODOS
  os styles em runtime**, sincronizada pela WS via pylogix quando a config muda (esporádico,
  `RcpTable_Rev`, sem handshake por ciclo).
- **Espec fechada**: `UDT_RcpAuto[16]` — `StyleCode` (código GM real = chave de busca) +
  `Valid` + `PosN15/PosN6_mm` + `Vel_mmps` (reservado) + **3 janelas × 4 câmeras**
  (`UDT_RcpWin` Start/End; desabilitada = Start>=End) — cobre a **tampa traseira varrida
  pelas N6 no fechamento das cortinas** (spec Sequence-Comunicacao: janelas POR CÂMERA,
  dependem de geometria por modelo). R020 S1: busca por código → slot; não achou → slot 0
  default + `St_RcpStyleDesconhecido` (não trava o ciclo). Janelas antigas globais
  `Recipe_N15/N6_Start/End` deixam de ser consumidas.
- Pacote 4 revisão final DESPACHADA (UDTs + R020 + tabela manual + adendo Arthur — sync de
  receitas no MESMO lote do WSCmd_Mode/GoAbs, sem retrabalho de contrato). [CONFIRMAR]:
  sequência da tampa traseira no grafcet; valores geométricos por modelo (óptica).
- Decisões registradas: `ManualOK` mantém `AxisOK` (conserto do R003 em manutenção futura).

## Proposta de especialista (aprovação do Pedro)
Tópico `iris-plc-rewire` recorrente (fora do roster). Se virar linha de trabalho estável:
`python3 scripts/okf/new_specialist.py iris-plc-rewire --class project --terms "iris plc rewire aoi grafcet servo 03007" --tags "iris-plc-rewire,iris-scds,03007,automacao"` — **não criar sem aprovação**; por ora dupla filiação com `iris-scds`.
