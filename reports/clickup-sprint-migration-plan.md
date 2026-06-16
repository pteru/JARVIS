# ClickUp Sprint Task Migration Plan

**Date:** 2026-03-24
**Space:** TÉCNICO (`3164545`)
**Issue:** 331 tasks have their primary location in sprint folders instead of regular folders
**Goal:** Move each task's primary home to the correct regular-folder list, keeping the sprint as a secondary location

---

## Summary

| Product | Sprint Folder | Tasks to Migrate |
|---|---|---|
| Smart Die | [01] SMART DIE sprints (`90115085362`) | 111 |
| Smart Die | [01] SMART DIE HARD (`90115287009`) | 4 |
| Spot Fusion | [02] SPOT FUSION sprints (`90115784429`) | 101 |
| Vision King | [03] VISION KING sprints (`90115784442`) | 115 |
| **Total** | | **331** |

## Migration Procedure (Per Task)

1. Add the task to the target regular-folder list (via `clickup_add_task_to_list`)
2. Move the task's primary home to that list (via `clickup_move_task`)
3. The sprint list becomes a secondary location automatically
4. Verify the task still appears in both the regular list AND the sprint

---

## [01] SMART DIE — 115 Tasks

> **NOTE:** [01005] DEMESTA list needs to be created in ClickUp before migrating DEMESTA tasks.
> Front/Back unified into Software. Calibração Gap and Reconstrução Superfície have no tasks yet — all sim work goes to Modelos, sensor work to Projeto Eletrônico or [01001].

### → [01] Software (`205149538`) — 42 tasks (includes former Front/Back)

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hkdym9` | data-processing: implementar os tratamentos de dados | done | SD Sprint 30 |
| 2 | `868fnjkzz` | software: desenvolver firmware para hub (UDP) | done | SD Sprint 29 |
| 3 | `868fnjkqc` | software: desenvolver firmware para módulo ESP (UDP) | done | SD Sprint 21 |
| 4 | `868fnjk57` | backend: review geral de endpoints | done | SD Sprint 19 |
| 5 | `868fnjjrq` | software: preparar PC .243 para testes | done | SD Sprint 20 |
| 6 | `868hkdz4a` | firmware: inicialização do hub sem reset | done | SD Sprint 30 |
| 7 | `868hkdx9w` | firmware: verificar volume de aquisições esperado | done | SD Sprint 30 |
| 8 | `868hkdx10` | firmware: config de inicialização dos sensores | done | SD Sprint 30 |
| 9 | `868h0fpb9` | Definir config do módulo esp | done | SD Sprint 29 |
| 10 | `868g76g3p` | Verificar funcionamento de todos os serviços | done | SD Sprint 28 |
| 11 | `868h8gvfd` | dev: revisar serviço de coleta e processamento de dados | done | SD Sprint 28 |
| 12 | `868ddc2gm` | Banco de Dados: Revisar estrutura do banco de dados | done | SD Sprint 9 |
| 13 | `868dcmk37` | Implementar Keyspace Notification no PM | done | SD Sprint 10 |
| 14 | `868d1bvv9` | Realizar configuraçao do keydb.conf para deixar keyspace ativado padrão no Redis | done | SD Sprint 5 |
| 15 | `868crg51k` | Spike: Investigar forma de compartilhamento de SDK no GCP | done | SD Sprint 4 |
| 16 | `868dcmgne` | Testar fluxo de trigger externo com PCBs reais | done | SD Sprint 30 |
| 17 | `868fvx1qw` | Configurar triggers do front e back e estruturar arquitetura de pastas | done | SD Sprint 20 |
| 18 | `868ddbhxr` | frontend e backend: Configurar docker para geração de container | done | SD Sprint 19 |
| 19 | `868ddbh2b` | backend: Criar endpoint que retorna lote atual | done | SD Sprint 18 |
| 20 | `868ddbgx0` | backend: Criar endpoint que retorna uma lista de painéis | done | SD Sprint 17 |
| 21 | `868ddbgtk` | backend: Criar endpoint que retorna uma lista de sensores | done | SD Sprint 17 |
| 22 | `868ddbgm1` | frontend: Criar serviço para consumir API backend para tela de produção | done | SD Sprint 19 |
| 23 | `868ddbj2y` | frontend: Realizar teste geral integrado com backend | done | SD Sprint 26 |
| 24 | `868f4z45w` | Switch: Revisão de topologia para switch comercial | done | SD Sprint 17 |
| 25 | `868hke4me` | front/back: adicionar novas visualizações | in progress | SD Sprint 32 |
| 26 | `868hrfz4m` | front/back: fix da tela de produção | done | SD Sprint 30 |
| 27 | `868h8gvhv` | front: fix de bugs no dashboard | done | SD Sprint 28 |
| 28 | `868h0fqpn` | front: Testes de visualização de dados | done | SD Sprint 30 |
| 29 | `868fp86qa` | front: Desenvolver visualização outras telas do sistema | done | SD Sprint 19 |
| 30 | `868ddbg9b` | frontend: Criar filtro de visualização por tipo de sensor no CAD 3D | done | SD Sprint 17 |
| 31 | `868ddbg0n` | frontend: Criar componente visualização e manipulação CAD 3D | done | SD Sprint 17 |
| 32 | `868g75apj` | Front: Corrigir a posição dos sensores no modelo 3D | done | SD Sprint 23 |
| 33 | `868eupe8n` | frontend: estruturar repositório sdk-ui-components | done | SD Sprint 14 |
| 34 | `868crg7wp` | PAM-Stamp: Criar uma ferramenta para automatizar inputs de DataSet | done | SD Sprint 19 |
| 35 | `868h0fczq` | draw-in: teste dinâmico de captura de dados | done | SD Sprint 30 |
| 36 | `868g759bg` | Draw-in: testes de funcionamento dos sensores | done | SD Sprint 26 |
| 37 | `868fvx6zr` | Soldagem dos sensores | done | SD Sprint 20 |
| 38 | `868dpuppg` | Sensores v2: Resinar 1 sensor Draw-in no casing para testar processo | done | SD Sprint 10 |
| 39 | `868h8gvcw` | hardware: Finalizar e embalar sensores | done | SD Sprint 30 |
| 40 | `868fate5n` | Sensores v2: Testes de resinagem no molde de alumínio (GAP) | done | SD Sprint 19 |
| 41 | `868fataeb` | Sensores v2: Acabamento no molde de alumínio | done | SD Sprint 17 |
| 42 | `868fnjhaz` | hardware: preparar 2 hubs com fontes alteradas | done | SD Sprint 19 |

### → [01] Projeto Eletrônico (`210907230`) — 13 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868ergyad` | Listar mudanças para reprojeto das PCBs | done | SD Sprint 19 |
| 2 | `868ecy6uc` | v2: reprojeto das PCBs | done | SD Sprint 20 |
| 3 | `868fgby7y` | Compra Gravador PIC32 Microchip | done | SD Sprint 20 |
| 4 | `868fgby5k` | Compra Módulo ESP32 Ethernet | done | SD Sprint 19 |
| 5 | `868h0fdvc` | Soldagem de componentes no HUB | done | SD Sprint 28 |
| 6 | `868fr3gcf` | Soldar conectores nos hubs | done | SD Sprint 20 |
| 7 | `868hn3ke5` | Investigação de funcionamento dos sensores | blocked | SD Sprint 32 |
| 8 | `868hddjcx` | sensores v2: Verificar funcionamento de placas | blocked | SD Sprint 32 |
| 9 | `868hddj1t` | sensores v2: Furação das tampas | done | SD Sprint 30 |
| 10 | `868hbubg5` | Suporte hardware | done | SD Sprint 28 |
| 11 | `868hc31fn` | Revisão Topologia | done | SD Sprint 28 |
| 12 | `868fnjj81` | hardware: furação das caixas para 2 hubs | done | SD Sprint 19 |
| 13 | `868ekgrbw` | v2: Resinar com sensor gap para testar funcionamento | done | SD Sprint 13 |

### → [01] Projeto Mecânico (`901107101206`) — 3 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868fv3p45` | hardware: simulação estrutural do casing draw-in aliviado | done | SD Sprint 20 |
| 2 | `868g19kvk` | hardware: fabricar segundo molde de alumínio | done | SD Sprint 23 |
| 3 | `868fp7yej` | hardware: planejar fabricação de nova concentradora | done | SD Sprint 27 |

### → [01005] DEMESTA (**LIST NEEDS TO BE CREATED**) — 2 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hd5xwz` | DEMESTAA: gerar sólido de remoção dos sensores e exportar em STP | in review | SD Sprint 32 |
| 2 | `868hd5xmz` | DEMESTAA: estudo e definição de posição de sensores | in review | SD Sprint 32 |

### → [01001] Implantação SJC-S10-CC (`900701761455`) — 18 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hzfre3` | sjc: avaliação dos dados do teste | to-do | SD Sprint 32 |
| 2 | `868hzfqy2` | sjc: teste em planta | to-do | SD Sprint 32 |
| 3 | `868hddkyv` | SJC: Montar Lista de materiais do painel alternativo | done | SD Sprint 29 |
| 4 | `868h0fjxn` | Preparação do painel - SJC | pending | SD Sprint 32 |
| 5 | `868fnjgw6` | SJC-S10: documentação de torque de aperto do draw-in | done | SD Sprint 19 |
| 6 | `868eju9cc` | SJC: montar cronograma atualizado | done | SD Sprint 13 |
| 7 | `868b79xyz` | SJC: Testes Funcionais Internos | done | SD Sprint 10 |
| 8 | `868b708fj` | SJC: Testes de Montagem Internos | done | SD Sprint 30 |
| 9 | `868fp7p1a` | hardware: imprimir espaçadores | done | SD Sprint 19 |
| 10 | `868e5q8nq` | Sensores v2: Providenciar chapas de fixação das caixas | done | SD Sprint 18 |
| 11 | `868fp830n` | hardware: verificar aquisição de resina | done | SD Sprint 19 |
| 12 | `868fxe6a7` | SJC: Fabricação do novo case Draw-in Matriz S10 | done | SD Sprint 22 |
| 13 | `868ddcx9b` | SJC: Resinagem dos sensores | done | SD Sprint 24 |
| 14 | `868ekgr8x` | v2: Resinar novo cilindro com tampa traseira para testar desmoldagem | done | SD Sprint 13 |
| 15 | `868ekgr1q` | v2: Resinar novo molde de silicone com garantia de centro e face traseira | done | SD Sprint 13 |
| 16 | `868eju8je` | v2: Resinar molde de silicone com resina cinza | done | SD Sprint 13 |
| 17 | `868eju7pk` | v2: Preparar tubo com corte lateral para resinagem com epoxy | done | SD Sprint 13 |
| 18 | `868eju6pn` | v2: resinagem em molde de silicone com tubo PVC (resina epoxy) | done | SD Sprint 13 |

### → [01] Modelos (Production) (`901107101218`) — 17 tasks (includes all sim work)

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hy9j7r` | draw-in: predição do desenho da borda da chapa estampada a partir das medidas | in progress | SD Sprint 32 |
| 2 | `868hven16` | draw-in: testar predição com dados de simulação | done | SD Sprint 31 |
| 3 | `868hven00` | draw-in: configurar limites de produção | done | SD Sprint 31 |
| 4 | `868hvemz8` | draw-in: implementar separação closing vs. forming | done | SD Sprint 31 |
| 5 | `868hvemwk` | draw-in: implementar predição de draw-in | done | SD Sprint 31 |
| 6 | `868hkdxuy` | dados: gerar dados mocados representativos | done | SD Sprint 31 |
| 7 | `868ghrbk6` | sim: extrair label da amostra a partir dos outputs | done | SD Sprint 28 |
| 8 | `868gcd2mw` | sim: rodar com mais níveis (3^k) | done | SD Sprint 24 |
| 9 | `868gcd0kn` | sim: tratar outputs para obter curva de drawin | done | SD Sprint 27 |
| 10 | `868g76n4y` | Sim: Exploração de range de parâmetros a partir dos nominais | done | SD Sprint 24 |
| 11 | `868g75b20` | Sim: análise de independência de malhas | done | SD Sprint 22 |
| 12 | `868h8gv4n` | sim: Revisão de projeto segundo normas base | done | SD Sprint 28 |
| 13 | `868hddhcz` | pam-stamp: Avaliar perda de precisão na simulação | done | SD Sprint 29 |
| 14 | `868hddku2` | pam-stamp: Estudar parâmetros do Stamp 2G | done | SD Sprint 29 |
| 15 | `868hke63v` | pamstamp: investigar estratégia de resolução híbrida | in progress | SD Sprint 32 |
| 16 | `868hd5yvn` | DEMESTA: estudar relatório e arquivos de simulação PAM-Stamp | done | SD Sprint 29 |
| 17 | `868crg7wp` | PAM-Stamp: Criar uma ferramenta para automatizar inputs de DataSet | done | SD Sprint 19 |

### → [01] Documentação (`901107838638`) — 11 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868crg186` | Documentar Repositório: GD | done | SD Sprint 4 |
| 2 | `868crg11g` | Documentar Repositório: Status | done | SD Sprint 4 |
| 3 | `868crg0u0` | Documentar Repositório: TR | done | SD Sprint 4 |
| 4 | `868crg0k6` | Documentar Repositório: PM | done | SD Sprint 4 |
| 5 | `868crg0dq` | Documentar Repositório: Connect | done | SD Sprint 4 |
| 6 | `868crfz89` | Documentar Repositório: Setting | done | SD Sprint 4 |
| 7 | `868crfz15` | Documentar Repositório: PD | done | SD Sprint 4 |
| 8 | `868crfqhy` | Documentar Repositório: Firmware PIC | done | SD Sprint 5 |
| 9 | `868crfqh9` | Documentar Repositório: Firmware ESP32 | done | SD Sprint 5 |
| 10 | `868crfpx9` | Documentar Repositório: Loader | done | SD Sprint 4 |
| 11 | `868beuje1` | [Documentação] Revisão inicial plano de projeto Smart Die | done | SD Sprint 1 |

### → [01] Testes Integrados Internos (`901107321788`) — 3 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868h0f57g` | Treinamento smart die (setup de teste) | done | SD Sprint 27 |
| 2 | `868gqc945` | hardware: montar draw-in resinado com case metálico e película e verificar funcionamento | done | SD Sprint 27 |
| 3 | `868gqc7h6` | hardware: realizar solda e testes do chip draw-in | done | SD Sprint 27 |

### → Compras e Importações (`217028564`) — 2 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868gcxduq` | hardware: definir lista SVLEC para compra | done | SD Sprint 28 |
| 2 | `868ejuatc` | v2: comprar gravador J-link v9 | done | SD Sprint 15 |

### SDH Sprint Tasks → [01] Projeto Eletrônico (`210907230`) — 4 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868c4xxrq` | Sensores v1: Teste de sensores resinados | done | SDH Sprint 1 |
| 2 | `868b1qqhw` | Sensores v1: Resinar lote de sensores | done | SDH Sprint 1 |
| 3 | `868b5mpng` | Sensores v2: Teste de montagem com PCBs | done | SD Sprint 30 |

---

## [02] SPOT FUSION — 101 Tasks

### → [02006] Implantação HYUNDAI-FLOOR (`901110860515`) — 38 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hyt36m` | hyundai: análise de dados da planta (dump) | to-do | SF Sprint 28 |
| 2 | `868hvenye` | Análise de possíveis falhas e soluções para visita Hyundai | done | SF Sprint 1 |
| 3 | `868fvwe3c` | hyundai: tratamento de picos das curvas | done | SF Sprint 16 |
| 4 | `868g17w2d` | hyundai: atualizar modelos no painel | done | SF Sprint 19 |
| 5 | `868g17w0r` | hyundai: passar modelos melhores para equipe da planta | done | SF Sprint 17 |
| 6 | `868g17ku4` | hyundai: realizar inferência nos novos dados de planta | done | SF Sprint 17 |
| 7 | `868g17kqn` | hyundai: exportar dados de planta dos pontos do teste | done | SF Sprint 17 |
| 8 | `868fv8x4p` | hyundai: Inicialização do sistema na fábrica | done | SF Sprint 19 |
| 9 | `868fv8p4p` | hyundai: planejamento e soldagem de novas amostras para avaliação | done | SF Sprint 16 |
| 10 | `868fp0jwc` | Hyundai: Preparar laboratório para testes finais | done | SF Sprint 15 |
| 11 | `868fp0j78` | Hyundai: Transferir dados entre bancos | done | SF Sprint 15 |
| 12 | `868fnb2qp` | Hyundai: Instalação do painel na planta | done | SF Sprint 17 |
| 13 | `868fgx09p` | hyundai: Ajustes no getdata | done | SF Sprint 14 |
| 14 | `868fgadh6` | hyundai: testes finais nos experimentos | done | SF Sprint 15 |
| 15 | `868fga7xg` | hyundai: verificar exibição do CAD Hyundai no front | done | SF Sprint 16 |
| 16 | `868fga6v2` | hyundai: finalizar painel | done | SF Sprint 14 |
| 17 | `868fga3z1` | hyundai: testar get-data e def-module com mensagem manual | done | SF Sprint 14 |
| 18 | `868fga3e7` | hyundai: bugfix no plc-monitor relativo à leitura do style | done | SF Sprint 14 |
| 19 | `868fga35d` | hyundai: ajustar bos-connector para leitura frequente | done | SF Sprint 14 |
| 20 | `868fbcmbq` | hyundai: inferência nos dados do laboratório | done | SF Sprint 13 |
| 21 | `868fat0vw` | hyundai: adaptar tag-monitor-siemens para extrair Model Type do VIN Number | done | SF Sprint 13 |
| 22 | `868fa1awf` | hyundai: ajustes de nomenclatura no Front | done | SF Sprint 13 |
| 23 | `868fa19j3` | hyundai: teste automático integrado ao lab | done | SF Sprint 15 |
| 24 | `868fa18y8` | hyundai: integrar PC/painel no lab | done | SF Sprint 13 |
| 25 | `868fa18ax` | hyundai: setup do PC (DB, Redis, CAD) | done | SF Sprint 16 |
| 26 | `868fa177j` | hyundai: Montar esquema elétrico do painel no EPLAN | done | SF Sprint 14 |
| 27 | `868fa16dv` | hyundai: obter coordenadas de cada spot_id inspecionados | done | SF Sprint 15 |
| 28 | `868fa0zx9` | hyundai: preparar material para validar integração com PLC Hyundai | done | SF Sprint 13 |
| 29 | `868fa0znu` | hyundai: montar DB de testes no PLC Siemens | done | SF Sprint 13 |
| 30 | `868ey54q3` | hyundai: executar e avaliar soldas (CDP a CDP) | done | SF Sprint 11 |
| 31 | `868ey54k0` | hyundai: montar sequência de experimentos (stackup a stackup) | done | SF Sprint 11 |
| 32 | `868ey547h` | hyundai: levantar estoque de todas as chapas dos stackups selecionados | done | SF Sprint 11 |
| 33 | `868erqprv` | Visita Hyundai | done | SF Sprint 10 |

### → [02] Software (`901109560051`) — 18 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hzdyr9` | sw: busca de dados alternativa no BOS6000 | to-do | SF Sprint 28 |
| 2 | `868hyt3yn` | sw: teste de FPS de inferência | in progress | SF Sprint 28 |
| 3 | `868hyt3kr` | sw: fix no builder bos-connector | to-do | SF Sprint 28 |
| 4 | `868hqju1v` | Review e correções da pipeline com Spotfusion Inference | done | SF Sprint 26 |
| 5 | `868hdw3h1` | infra: subir dados do dump | done | SF Sprint 25 |
| 6 | `868h0cvyy` | Otimização de software: default-module => spotfusion-inference | done | SF Sprint 25 |
| 7 | `868h0ctw2` | Otimização de software: armazenamento no banco | done | SF Sprint 23 |
| 8 | `868h8f1uu` | Projetar arquitetura para otimização dos serviços de instalação | done | SF Sprint 26 |
| 9 | `868h8f1e0` | Projetar arquitetura de serviços para uso da MV-SC6050 | done | SF Sprint 25 |
| 10 | `868h0dfyj` | Documentar arquiteturas atuais | done | SF Sprint 23 |
| 11 | `868g7eafr` | Arquitetura de solução para novas features | done | SF Sprint 26 |
| 12 | `868d7hcnp` | Implementar tag monitor para PLC siemens | done | SF Sprint 2 |
| 13 | `868d7anr8` | Alteração do módulo A para o novo modelo | done | SF Sprint 2 |
| 14 | `868d1b8td` | Transferir a criação de tabelas e funções para o entrypoint | done | SF Sprint 1 |
| 15 | `868h8ew5c` | Consolidação das infos do perfil de corrente no DB | done | SF Sprint 25 |
| 16 | `868gh6v5z` | lab/software: automatizar ingestão de chisel e peel no DB | done | SF Sprint 26 |
| 17 | `868g7df6n` | instalar TAG visualizer .tar | done | SF Sprint 18 |
| 18 | `868hkhf6u` | Organizar os bancos de dados do lab | done | SF Sprint 1 |

### → [02] Modelos (`901109635130`) — 11 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hkj6dp` | vision: avaliar limite min de resolução para modelo rebarba | done | SF Sprint 27 |
| 2 | `868hdw3d2` | ds: análise dos dados de produção de GVT | done | SF Sprint 26 |
| 3 | `868hd6hvp` | ds: estudar modelagem usando operadores neurais | done | SF Sprint 25 |
| 4 | `868gc7n0g` | ds: deduzir regra geral para correção de corrente ideal vs. real | done | SF Sprint 23 |
| 5 | `868g7dnqm` | ds: aplicar técnica de clusterização sobre parâmetros e stackup | done | SF Sprint 19 |
| 6 | `868g7dk0v` | ds: aplicar técnica de clusterização sobre o t-SNE e encontrar métrica para comparação | done | SF Sprint 18 |
| 7 | `868djhz72` | Estudo de correlação entre features do ViewR e os rótulos das soldas | done | SF Sprint 5 |
| 8 | `868fv942f` | GMB-SJC: Inferência e levantamento de métricas do teste destrutivo | done | SF Sprint 16 |
| 9 | `868fp0fk1` | GMB: Revisar modelos destinados às plantas | done | SF Sprint 16 |
| 10 | `868fz0tfe` | GMB-GVT: Revisar modelos para deploy | backlog | SF Sprint 17 |
| 11 | `868h8ex4j` | Ajustar arquivos de treinamento para arquivamento em ONNX | done | SF Sprint 24 |

### → [02] Laboratório (`217010844`) — 17 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hx80ub` | Preparar lab/ Realizar soldas | done | SF Sprint 26 |
| 0 | `868h8f22h` | Atualização Software e firmware ViewR e ViewNet | done | SF Sprint 24 |
| 0 | `868h0c8rf` | Instalar software BOS7000 | done | SF Sprint 23 |
| 0 | `868h0c9hu` | Validar funcionamento do PSI7000 | pending | SF Sprint 28 |
| 0 | `868h8f29h` | Startup do PSI7000 com Centerline | pending | SF Sprint 28 |
| 0 | `868h8f2ry` | Desenvolver setup de demonstração | done | SF Sprint 25 |
| 2 | `868hddn9t` | lab: soldar experimentos/ São Leopoldo | done | SF Sprint 25 |
| 3 | `868hd6ayp` | lab: instalar mangueiras na nova pinça | done | SF Sprint 25 |
| 4 | `868hd6f4t` | lab: realizar soldas do DoE para simulação | to-do | SF Sprint 28 |
| 5 | `868hc372e` | lab: realização de macrografia em amostras do lab | done | SF Sprint 26 |
| 6 | `868drakdg` | bosch: soldar chapas em condições conhecidas (pontos bons e ruins) | done | SF Sprint 5 |
| 7 | `868d7cdfx` | Usinar eletrodos para testes de desgaste | done | SF Sprint 2 |
| 8 | `868d7a40j` | Novos testes de defeitos induzidos: Desgaste excessivo | done | SF Sprint 2 |
| 9 | `868d7a36z` | Novos testes de defeitos induzidos: Shunt | done | SF Sprint 3 |
| 10 | `868fa1969` | lab: teste automático do BOS6000 | done | SF Sprint 13 |
| 11 | `868fa18qb` | lab: integrar PLC Siemens em rede paralela | done | SF Sprint 13 |
| 12 | `868fvwdt7` | lab: Alimentar Bosch 7000 | done | SF Sprint 25 |
| 13 | `868erqfex` | Abrir chamados de compra para materiais do lab | done | SF Sprint 25 |

### → [02] Hardware (`217010835`) — 5 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hd6u41` | vision: testar profundidade de foco da Smart Cam | to-do | SF Sprint 28 |
| 2 | `868hd6qw1` | vision: testar sensibilidade da detecção de ponto à inclinação | to-do | SF Sprint 28 |
| 3 | `868hd6q4g` | vision: estudar estratégia para ajuste de foco | to-do | SF Sprint 28 |
| 4 | `868h0cmqr` | Validar uso da câmera MV-SC6050 | blocked | SF Sprint 28 |
| 5 | `868h8ex8d` | Treinamento de utilização da automação de treinamentos de rede | blocked | SF Sprint 28 |

### → [02] Documentação (`901109508050`) — 2 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868h0dhmq` | Mapeamento padrão de topologia de instalação | done | SF Sprint 25 |
| 2 | `868gn4dqd` | mapear features operacionais p/ Spot Fusion | done | SF Sprint 23 |

### → Simulation / Data Science — 5 tasks → [02] Modelos (`901109635130`)

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hyt6fj` | spinn: validacao da simulacao vs. DoE exploratório | in progress | SF Sprint 28 |
| 2 | `868hyt5r3` | spinn: operacionalizar SimuFact | in progress | SF Sprint 28 |
| 3 | `868fv9aj8` | sim: Obter valores de resistividade das ligas de aço | done | SF Sprint 19 |
| 4 | `868fv96f5` | sim: Extração de curva de resistência dinâmica | done | SF Sprint 17 |
| 5 | `868fv95up` | sim: Calibração da simulação de crescimento de nugget | done | SF Sprint 17 |

### → Cross-project / Other — 9 tasks

| # | Task ID | Task Name | Status | Recommended List | List ID |
|---|---|---|---|---|---|
| 1 | `868gcw792` | sjc: enviar relatório com tempos do PLC para resultado | done | [02001] GM-SJC-Tampa | `217010888` |
| 2 | `868g7ek5f` | GVT: Análise de mudança de tags no PLC | done | [02002] GM-GVT-BSO | `900701787578` |
| 2b | `868h8f2r2` | Visita GVT/RS | done | [02002] GM-GVT-BSO | `900701787578` |
| 3 | `868g7dmrh` | SJC: Retornar Server e diagnosticar painel | done | [02001] GM-SJC-Tampa | `217010888` |
| 4 | `868h0dh28` | COMAU: Visita técnica | done | [02008] Nissan/COMAU | *see note* |
| 5 | `868h0dgdj` | Nissan-TN: Visita técnica | done | [02008] Nissan/COMAU | *see note* |
| 6 | `868hd635n` | Visita Volvo | done | [02] Documentação | `901109508050` |
| 7 | `868hd637n` | Nissan: Responder questionário de Cybersecurity | done | [02008] Nissan/COMAU | *see note* |
| 8 | `868czw6bn` | Reunião com Barbara sobre B-Side | done | [02004] GM-GVT-BSIDE | `901109508048` |

---

## [03] VISION KING — 115 Tasks

### → [03002] Arcelor Barra Mansa (`901109407841`) — 32 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hkkj7t` | arcelor: update geral do sistema pós-campanha | done | VK Sprint 27 |
| 2 | `868hdwn07` | vk-arcelor: fix de layout | done | VK Sprint 26 |
| 3 | `868hdwbhn` | arcelor-dev: ajustar vk-inference para yolo-obb | done | VK Sprint 26 |
| 4 | `868hdwbbf` | arcelor-ds: comparar modelo novo ao deploy atual (McNemar) | done | VK Sprint 26 |
| 5 | `868hdwb3c` | arcelor-ds: treinar modelo yolo padrão análogo ao yolo-obb | done | VK Sprint 25 |
| 6 | `868hd6yhg` | arcelor: deploy updates para c014 | done | VK Sprint 26 |
| 7 | `868hd6yg9` | arcelor: campanha 14 | done | VK Sprint 26 |
| 8 | `868hatt9m` | arcelor-ds: aprimorar modelo vk01 OBB com rótulos corrigidos | done | VK Sprint 24 |
| 9 | `868h8fkrz` | vk-arcelor: fix database-writer | done | VK Sprint 24 |
| 10 | `868h8fkdg` | vk-arcelor: fix do novo layout | done | VK Sprint 24 |
| 11 | `868h8fgzt` | vk-arcelor: função de reset de tracking | done | VK Sprint 24 |
| 12 | `868h8fgmd` | vk-arcelor: backup da campanha 13 | done | VK Sprint 25 |
| 13 | `868h8fg9y` | vk-arcelor: front - deploy e testes | in review | VK Sprint 28 |
| 14 | `868h8ffxw` | vk-arcelor: fix do vk-inference | done | VK Sprint 24 |
| 15 | `868h8ffcu` | Registrar informações sobre método de validação de CFD da calha | done | VK Sprint 24 |
| 16 | `868h8fdad` | sealer: reorganizar planilha mestra para comparativos de opções | done | VK Sprint 24 |
| 17 | `868h0emjr` | arcelor-BM: Tela de gerenciamento de usuários | done | VK Sprint 23 |
| 18 | `868h0e0kw` | arcelor BM: Criar documentação do novo dashboard | done | VK Sprint 24 |
| 19 | `868h0e028` | arcelor BM: acompanhamento da campanha | done | VK Sprint 23 |
| 20 | `868h0dzp5` | arcelor BM: fechar pacote de updates pré-campanha | done | VK Sprint 23 |
| 21 | `868gh79ew` | arcelor: implementar aplicação do regras_de_negócio baseado em evento | done | VK Sprint 20 |
| 22 | `868gdf3ju` | arcelor: segmentar codificação de cores por câmera/face | done | VK Sprint 19 |
| 23 | `868gce41p` | arcelor: finalizar implementação de regras de alarme | done | VK Sprint 20 |
| 24 | `868g9q4au` | arcelor: implementar ferramenta para monitorar fechamento de snap graficamente | done | VK Sprint 18 |
| 25 | `868frr3r6` | Arcelor BM: Desenvolver visionking-result | done | VK Sprint 16 |
| 26 | `868fv2x7k` | Arcelor BM: Deploy geral pré-campanha | done | VK Sprint 16 |
| 27 | `868fp14h6` | Arcelor BM: Revisar lógica do defeito aprovado e reprovado | done | VK Sprint 15 |
| 28 | `868fp10x5` | Arcelor BM: Especificar serviços suporte de manutenção | done | VK Sprint 16 |
| 29 | `868fv2wee` | lab: Compra de materiais para calhas | done | VK Sprint 16 |
| 30 | `868fw5axr` | Arcelor BM: Rotulagem de riscos | done | VK Sprint 16 |
| 31 | `868faubfm` | http: testes integrados das novas aplicações | done | VK Sprint 14 |
| 32 | `868g189mm` | Arcelor BM: Exportar modelo ONNX com 1 channel | done | VK Sprint 17 |

### → [03008] Hyundai Sealer (`901112079252`) — 8 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hkkgkg` | sealer: análises estruturais | in progress | VK Sprint 28 |
| 2 | `868hd77qe` | sealer: definição sobre material da tampa e batentes | to-do | VK Sprint 28 |
| 3 | `868h8fd72` | sealer: ajustes para instalar iluminação | done | VK Sprint 25 |
| 4 | `868h8fd2k` | sealer: cálculos dinâmica pistão | done | VK Sprint 24 |
| 5 | `868h8fcv7` | sealer: definir proteção do sistema (telescópica, sanfona) | done | VK Sprint 25 |
| 6 | `868fy21bt` | Sealer Hyundai: Verificar integridade dos CADs recebidos | done | VK Sprint 16 |
| 7 | `868h8ffhy` | vk-body: Definição de otimização e finalização do projeto mecânico | in progress | VK Sprint 28 |
| 8 | `868h0en20` | vk-Body-SCS: Projeto elétrico | in progress | VK Sprint 28 |

### → [03006] IRIS GM-GVT-Body (`901111455897`) — 8 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hkkbfn` | vk-GVT: análise de threshold (sensibilidade) | done | VK Sprint 26 |
| 2 | `868h8fhdp` | vk-GVT: aprimorar modelo (visita) | done | VK Sprint 26 |
| 3 | `868faufg2` | IRIS GVT: Finalizar desenho e gerar lista de componentes do pórtico do body | done | VK Sprint 13 |
| 4 | `868fauhwf` | IRIS GVT: Providenciar paineis para treinamento de modelo | done | VK Sprint 17 |
| 5 | `868ezep65` | IRIS GVT: Desenho preliminar do setup | done | VK Sprint 11 |
| 6 | `868g6cgxe` | back: mvp vk-body | done | VK Sprint 18 |
| 7 | `868g6cgve` | front: mvp vk-body | done | VK Sprint 18 |
| 8 | `868fw58xe` | hyundai: Preparar material para kickoff Sealer | done | VK Sprint 18 |

### → [03007] IRIS GM-SCDS-Paint (`901112079243`) — 9 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hdwm87` | iris-scds: detalhar sistema de monitoramento de temperatura | in progress | VK Sprint 28 |
| 2 | `868hzer2u` | iris-gvt: rotular e retreinar defeitos tipo 3 | to-do | VK Sprint 28 |
| 3 | `868fgbq8v` | IRIS SCDS: pesquisar procedimento para levantar matrizes intrínsica e extrínsica | done | VK Sprint 15 |
| 4 | `868fgbnzq` | IRIS SCDS: montar mapa de deploy completo | done | VK Sprint 14 |
| 5 | `868frqy82` | IRIS SCDS: Fabricar equipamentos para levantamento de matrizes | done | VK Sprint 17 |
| 6 | `868frqy5g` | IRIS SCDC: Levantar matriz intrínsica e extrínsicas | done | VK Sprint 18 |
| 7 | `868fw4xn4` | IRIS SCDS: Listar cenários com servo escolhido | in progress | VK Sprint 17 |
| 8 | `868fv36ex` | IRIS SCDS: definição da lista de componentes | in progress | VK Sprint 17 |
| 9 | `868fav30x` | IRIS SCDS: Detalhar lógica de automação para distância reduzida entre carros | blocked | VK Sprint 17 |

### → [03] Software (`901109471398`) — 24 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868d79wav` | front: refatorar status da planta ponto 2 | done | VK Sprint 12 |
| 2 | `868d79vz6` | front: remover módulos não utilizados mais | done | VK Sprint 2 |
| 3 | `868d79vvc` | front: criar utils para funções de conversão | done | VK Sprint 2 |
| 4 | `868d6xey1` | infra: criar infra de DB representativa da planta localmente | done | VK Sprint 2 |
| 5 | `868d6rjnq` | back: exportação de relatórios | done | VK Sprint 3 |
| 6 | `868d6rjbm` | back: tela de produtos inspecionados | done | VK Sprint 2 |
| 7 | `868d6rgrw` | back: implementação correta das barras do ponto 2 | done | VK Sprint 2 |
| 8 | `868d6rgfz` | front: implementação correta das barras do ponto 2 | done | VK Sprint 8 |
| 9 | `868d6rfwh` | front: fix hover plant status | done | VK Sprint 8 |
| 10 | `868d6rdnu` | front: modal de ampliação da imagem | done | VK Sprint 8 |
| 11 | `868d6rdda` | front: tela de produtos inspecionados | done | VK Sprint 2 |
| 12 | `868d6rdae` | back: contagem de defeitos por frame | done | VK Sprint 2 |
| 13 | `868d6rcjh` | sql: adicionar novas tags do PLC | done | VK Sprint 2 |
| 14 | `868d6rcfv` | ca: adicionar novas tags do PLC | done | VK Sprint 2 |
| 15 | `868d6x5cm` | pm: adicionar novas tags do PLC | done | VK Sprint 2 |
| 16 | `868d6x57m` | is: adicionar novas tags do PLC | done | VK Sprint 2 |
| 17 | `868ddceuh` | back: Realizar agrupamento por barra_id para tela do ponto 2 | done | VK Sprint 5 |
| 18 | `868dbf8z1` | front: refatorar tabela no ponto 2 | done | VK Sprint 5 |
| 19 | `868d7cr42` | Criar documentação para deploy | done | VK Sprint 4 |
| 20 | `868ejw0t6` | front: coluna com comprimento medido no ponto 2 | done | VK Sprint 9 |
| 21 | `868ey7ec2` | front: criar Figma apenas com MVP | done | VK Sprint 11 |
| 22 | `868dq8ffx` | redesign da tela grid | done | VK Sprint 4 |
| 23 | `868ddd469` | Revisar material de treinamento | done | VK Sprint 4 |
| 24 | `868czx669` | Criar endpoint para agrupar barras filhas no ponto 2 | done | VK Sprint 1 |

### → [03] Modelos (`901109474226`) — 11 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868hzevb5` | ds: organizar dataset completo do vk-body | to-do | VK Sprint 28 |
| 2 | `868hzeuxv` | arcelor: checar imagens de farpa do dataset | to-do | VK Sprint 28 |
| 3 | `868d57zem` | dm: implementar pré-filtro analítico | done | VK Sprint 2 |
| 4 | `868d57z2u` | dm: solucionar bug de parada do serviço | done | VK Sprint 3 |
| 5 | `868d4aj0q` | c004: aprimorar modelo para não pegar a estrutura | done | VK Sprint 2 |
| 6 | `868cj7k4e` | 2.1.5.9-Iterações do modelo campanha 3 | done | VK Sprint 4 |
| 7 | `868cpq10f` | c002_17.4: testar performance do serviço "detector" (IF) | done | VK Sprint 7 |
| 8 | `868cnyewq` | C002_4 - setup: elaborar setup com materiais espelhados | done | VK Sprint 2 |
| 9 | `868f6w38k` | dm/if: consolidar ambos os servicos em um único repositório | done | VK Sprint 12 |
| 10 | `868f6w32g` | dm/if: criar ferramenta de testes em máquina local | done | VK Sprint 12 |
| 11 | `868f50wzf` | dm: endereçar novo modelo no yml c006 | done | VK Sprint 12 |

### → [03] Hardware (`901109715764`) — 7 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868h0eh27` | lab: Teste integrado completo da bancada | to-do | VK Sprint 24 |
| 2 | `868h0e834` | lab: Refatorar código ladder de movimentação da bancada | backlog | VK Sprint 24 |
| 3 | `868fv2zvk` | lab: Alterar programação do PLC para movimentação bancada | done | VK Sprint 17 |
| 4 | `868fgbhxa` | vk: Conversão de arquivo CAD do TL2 | done | VK Sprint 16 |
| 5 | `868fgbhph` | vk: preparação de pc para scanner | done | VK Sprint 14 |
| 6 | `868fgbhge` | vk: preparar HDs para transporte | done | VK Sprint 14 |
| 7 | `868fv37h2` | kiosk: resolver abertura automática do teclado virtual | backlog | VK Sprint 17 |

### → [03] Documentação (`901109715757`) — 3 tasks

| # | Task ID | Task Name | Status | Current Sprint |
|---|---|---|---|---|
| 1 | `868cj7k69` | Manual NP: Atualização informações (mudança placa utilidades) | done | VK Sprint 7 |
| 2 | `868fw58gw` | Preparar material para kickoff Stellantis | done | VK Sprint 16 |
| 3 | `868f50dcr` | IRIS: Detalhar projeto de calha isolada | done | VK Sprint 14 |

### → Other VK targets — 13 tasks

| # | Task ID | Task Name | Status | Recommended List | List ID |
|---|---|---|---|---|---|
| 1 | `868faubk4` | visionking-inference: testes de desempenho e tuning na planta | done | [03002] Arcelor BM | `901109407841` |
| 2 | `868faub6x` | visionking-inference: deploy na planta | done | [03002] Arcelor BM | `901109407841` |
| 3 | `868faubcb` | front/back: deploy de novas features na planta | done | [03002] Arcelor BM | `901109407841` |
| 4 | `868fav5yx` | IRIS: Organizar dataset centralizado de imagens de paineis | done | [03] Modelos | `901109474226` |
| 5 | `868fauqwd` | IRIS: Montar relatórios comparativo entre VisionMaster e YOLO | done | [03] Modelos | `901109474226` |
| 6 | `868fauz5q` | IRIS SCDS: Preparar computador com Ubuntu | done | [03] Hardware | `901109715764` |
| 7 | `868fgbg7w` | ds: construir dataset e treinar com subclasses de risco (c010) | done | [03] Modelos | `901109474226` |
| 8 | `868f2dhu0` | Limitar quantidade de imagens inspecionadas para garantir que não há extremidade | done | [03] Software | `901109471398` |
| 9 | `868czv5rr` | Alterar serviços frontend para integrar nos novos endpoints | done | [03] Software | `901109471398` |
| 10 | `868d4z6we` | Criar tela de detalhes da barra | done | [03] Software | `901109471398` |
| 11 | `868d2num5` | c003: fazer backup de todos os yml atualmente rodando na planta | done | [03002] Arcelor BM | `901109407841` |
| 12 | `868ey79aq` | infra: backup imagens no servidor .2 | done | [03002] Arcelor BM | `901109407841` |
| 13 | `868ey7940` | infra: restore dumps c007 | done | [03002] Arcelor BM | `901109407841` |

---

## Migration Summary by Target List (Corrected)

| Target List | ID | SD | SF | VK | Total |
|---|---|---|---|---|---|
| [01] Software (unified w/ Front/Back) | `205149538` | 42 | — | — | 42 |
| [01] Projeto Eletrônico | `210907230` | 17 | — | — | 17 |
| [01001] SJC-S10-CC | `900701761455` | 18 | — | — | 18 |
| [01] Modelos (all sim + draw-in) | `901107101218` | 17 | — | — | 17 |
| [01] Documentação | `901107838638` | 11 | — | — | 11 |
| [01] Projeto Mecânico | `901107101206` | 3 | — | — | 3 |
| [01] Testes Integrados | `901107321788` | 3 | — | — | 3 |
| [01005] DEMESTA (**NEW**) | *to create* | 2 | — | — | 2 |
| Compras e Importações | `217028564` | 2 | — | — | 2 |
| [02006] HYUNDAI-FLOOR | `901110860515` | — | 33 | — | 33 |
| [02] Software | `901109560051` | — | 18 | — | 18 |
| [02] Modelos (incl. simulation) | `901109635130` | — | 16 | — | 16 |
| [02] Laboratório (incl. BOS/PSI/ViewR) | `217010844` | — | 17 | — | 17 |
| [02] Hardware | `217010835` | — | 5 | — | 5 |
| [02] Documentação | `901109508050` | — | 5 | — | 5 |
| [02001] GM-SJC-Tampa | `217010888` | — | 2 | — | 2 |
| [02002] GM-GVT-BSO (all GVT) | `900701787578` | — | 4 | — | 4 |
| [02004] GM-GVT-BSIDE | `901109508048` | — | 1 | — | 1 |
| [03002] Arcelor Barra Mansa | `901109407841` | — | — | 39 | 39 |
| [03008] Hyundai Sealer | `901112079252` | — | — | 8 | 8 |
| [03006] IRIS GM-GVT-Body | `901111455897` | — | — | 8 | 8 |
| [03007] IRIS GM-SCDS-Paint | `901112079243` | — | — | 9 | 9 |
| [03] Software | `901109471398` | — | — | 27 | 27 |
| [03] Modelos | `901109474226` | — | — | 14 | 14 |
| [03] Hardware | `901109715764` | — | — | 8 | 8 |
| [03] Documentação | `901109715757` | — | — | 3 | 3 |
| **Total** | | **115** | **101** | **116** | **331** |

### Corrections Applied (v2)

1. **Calibração Gap / Reconstrução Superfície eliminated** — no tasks belong there yet; redistributed to Projeto Eletrônico, [01001], and Software
2. **All simulation work (SD)** → Modelos (pam-stamp, sim:, draw-in prediction)
3. **Front/Back unified into Software** — includes existing Front/Back list tasks
4. **DEMESTAA = [01005]** — new list needs to be created in ClickUp
5. **`868fxe6a7`** → [01001] SJC (was in Projeto Mecânico)
6. **`868h8f2r2` (Visita GVT/RS)** → [02002] GM-GVT-BSO
7. **All GVT mentions in SF** → [02002] GM-GVT-BSO
8. **BOS7000 / PSI7000 / ViewR tasks** → [02] Laboratório
9. **`868h8f22h` (Atualização ViewR/ViewNet)** → [02] Laboratório

---

## Execution Plan

### Phase 1: Active Tasks First (non-done, 41 tasks)

Migrate open/in-progress/blocked tasks first — these are the ones people are actively working on and will benefit most from correct placement.

### Phase 2: Recently Closed (Sprint 24+, ~80 tasks)

Migrate tasks closed in the last 3 months for historical accuracy.

### Phase 3: Historical (Sprint 1-23, ~210 tasks)

Migrate all remaining historical tasks. These are closed and unlikely to be revisited, but correct placement improves reporting and searchability.

### Rollback

If a task disappears from a sprint view after migration:
1. Check if the sprint list still appears in the task's `locations` field
2. If not, use `clickup_add_task_to_list` to re-add the sprint list as a secondary location
