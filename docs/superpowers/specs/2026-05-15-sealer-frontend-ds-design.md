---
type: Design Spec
title: SEALER frontend-ds — profile `vk-sealer`
description: Habilitar o repositório `visionking/services/frontend-ds` (Angular 19) a servir o produto **SEALER** como um **profile `vk-sealer`**, irmão do produto Body que o repo serve hoje. Diferente do IRIS...
timestamp: 2026-05-15
---

# SEALER frontend-ds — profile `vk-sealer`

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-15
**Project:** 03008 Hyundai Piracicaba — SEALER (inspeção de cordões de selante)
**Fonte:** reunião "Alinhamentos - Frontend (03008, 03007, 01001, 02008)" de 2026-05-09 + investigação técnica de renderização 3D.
**ClickUp:** TBD — nova atividade de software SEALER (cronograma [4.x]).
**Fluxo de trabalho:** esta spec → **Tiago** desenha o Figma `vk-sealer` → **Guilherme** desenvolve sobre o Figma. A spec é, portanto, também o **briefing de design** para o Tiago — descreve telas, fluxos e estados com detalhe suficiente para desenhar.

## 1. Goal

Habilitar o repositório `visionking/services/frontend-ds` (Angular 19) a servir o produto **SEALER** como um **profile `vk-sealer`**, irmão do produto Body que o repo serve hoje. Diferente do IRIS (que é o próprio VK Body com pequenos deltas), o SEALER é um **produto distinto**: tem suas próprias telas, sua própria entidade de dados (o **cordão de selante**) e uma **visualização 3D nova** (cor variando ao longo do comprimento do cordão). Esta spec define as 3 telas do SEALER, o componente de visualização 3D do cordão, e abre a discussão sobre **como introduzir o conceito de profile** num repo que hoje é mono-produto.

## 2. Scope

**In:**
- Introdução do **profile `vk-sealer`** no `frontend-ds` (mecanismo discutido na seção 4 — decisão em aberto).
- **3 telas** do SEALER, detalhadas na seção 3 como briefing de design:
  - **Retrabalho** — TV 75" na linha, passiva, onde os 2 operadores trabalham.
  - **Produção** — painel de acompanhamento (peças que passaram, saúde do sistema, última imagem capturada).
  - **Tracking** — tela ativa de detalhe/relatório navegável por carroceria.
- **Componente de visualização 3D do cordão** (`SealerBead3dComponent`) com escala de cor ao longo do comprimento — seção 5.
- Telas transversais (login, configuração, gestão de usuários) **alinhadas ao padrão comum** dos demais produtos — não redesenhadas aqui, apenas referenciadas.
- Estados operacionais por tela (operacional / aguardando carroceria / sem conexão).

**Out (rejeitado ou deferido):**
- **Auth + roles** — deferido para spec futura, mesmo deferimento do IRIS-07. MVP serve rotas abertas read-only.
- **Sweep de perfil 2D ao longo da curva** — descartado como técnica de render 3D (decisão do usuário). Restam 2 caminhos (seção 5).
- **`display-manager` / Android TV** — SEALER usa a TV 75" via navegador (mesma direção do IRIS); sem app nativo.
- **Streaming de vídeo contínuo** — a "última imagem capturada" é monitoramento de estado de baixa frequência, não stream (seção 3.2).
- **WebSocket / SSE** — polling REST basta; push real-time fica como evolução.

## 3. As três telas (briefing de design para o Figma)

> O SEALER inspeciona cordões de selante aplicados na carroceria. O sistema verifica **aplicação (presença), posição, largura e altura** do cordão via câmeras 3D, em fluxo de inspeção **passivo**.

### 3.1 Retrabalho — TV 75" na linha (passiva)

**Quem usa:** 2 operadores simultaneamente, um responsável pelo **lado esquerdo** e outro pelo **lado direito** da carroceria. A mesma TV 75" serve os dois.

**Natureza:** **100% passiva.** O mundo físico controla o conteúdo — quando o carro chega na estação, a carroceria correspondente aparece; quando o carro sai, ela some. O operador **não navega, não seleciona** carroceria; ele apenas lê a tela e executa o retrabalho físico do cordão.

**Layout / requisitos de design:**
- **Imagem espelhada** — a representação 3D do carro na tela deve estar espelhada de modo que **esquerda na tela = esquerda real do operador** diante do carro. Sem o espelhamento a visualização fica contra-intuitiva.
- **Linha tracejada central** dividindo visualmente o lado esquerdo do direito.
- **Setas indicativas** + um **aviso explícito de espelhamento** para o operador não se confundir.
- **Divisão de trabalho por coordenada Y** (plano médio da carroceria): cordões com Y positivo pertencem a um operador, Y negativo ao outro. É o critério que resolve "de quem é este trecho".
- **Cordões transversais** (que cruzam o meio do carro): o sistema precisa **atribuir um dono** ao cordão — ou pelo robô responsável, ou por regra de maior comprimento por lado — para que dois operadores não retrabalhem o mesmo trecho. *(Regra exata em aberto — seção 8.)*
- **Visualização 3D do cordão** (seção 5) é o **coração desta tela**: o operador vê quais cordões estão NOK e onde, com a cor indicando o tipo/severidade do defeito.
- **Ícones de defeito** sobre a carroceria, com **auto-ajuste vertical anti-sobreposição**: onde vários defeitos ocorrem próximos, os ícones se deslocam para a lateral, cada um ligado à sua posição real por um **tracejado-guia**, evitando poluição visual.

**Estados visuais:**
- **Operacional** — carroceria presente, cordões e defeitos renderizados.
- **Aguardando carroceria** — sem carro na estação. Tela limpa com mensagem grande.
- **Sem conexão** — backend não responde. Banner de erro.

**Restrição física (nota operacional, não de UI):** a TV **não pode ser instalada no chão** — respingo de selante cairia sobre a tela. Posicionamento elevado.

### 3.2 Produção — painel de acompanhamento

**Quem usa:** acompanhamento, possivelmente alguém fora da linha (escritório/supervisão). Equivale à tela `production` do produto Body (`ProductionComponent`).

**Natureza:** painel de monitoramento, leitura passiva.

**Conteúdo:**
- **Lista das peças que passaram** pela inspeção — histórico recente de carrocerias inspecionadas com seu status.
- **Status / saúde do sistema** — indicadores de que o sistema está operando normalmente.
- **Última imagem capturada** — exibida para **monitoramento de estado**, não como streaming. Atualiza a cada carro (baixa frequência). Permite perceber visualmente uma **lente suja** ou **falha de captura** (ex.: respingo na lente aparece na foto). É deliberadamente "saúde de sistema", não vídeo ao vivo.

### 3.3 Tracking — detalhe/relatório navegável (ativa)

**Quem usa:** análise/relatório fora do ciclo de produção. Equivale à tela **`tracking` do SpotFusion** (fluxo lista-de-peças → detalhe).

**Natureza:** **ativa** — o usuário navega, seleciona uma carroceria histórica, gira e aproxima o 3D. Não atrelada ao carro que está na linha agora.

**Conteúdo / requisitos:**
- **Lista de carrocerias inspecionadas** → clicar → **detalhe daquela carroceria**.
- Visualização 3D **navegável**: rotacionar, zoom, vista de assoalho. Aqui **não há split esquerda/direita** nem espelhamento — parado, mostra a orientação correta/real.
- **Filtros** — isolar uma classe de defeito ou um tipo de modo de falha por vez.
- **Escala de cor gradiente** (estilo FEM/engenharia, seção 5) para dados quantitativos — espessura/largura do cordão ao longo do comprimento — incluindo o modo **isoline** (só linhas de fronteira de nível, fundo cinza, estilo curva de nível de terreno).
- Mais nível de detalhe por defeito do que a tela de Retrabalho.

## 4. Mecanismo de profile (decisão arquitetural em aberto)

> O usuário pediu explicitamente que as **alternativas sejam discutidas na spec** — esta seção não decide, apresenta os trade-offs para uma conversa arquitetural mais profunda.

**Constatação:** o `frontend-ds` hoje **não tem nenhuma camada de profile**. O repo *é* o produto Body — rotas, componentes e assets são do Body diretamente. "Adicionar o `vk-sealer` ao lado do `vk-body`" exige, antes, **criar o próprio conceito de profile**. Não há padrão existente a estender.

### Alternativa A — Profile por env var (build/deploy)

Introduz `VK_PROFILE=body|sealer`. Codebase compartilhada; rotas, componentes, assets e tema selecionados por profile no build (`ng build --configuration=sealer`) ou em deploy. Exige refatorar o código Body atual para baixo de um profile `body`.

- ➕ Alinha com a convenção `VR_PROFILE=steel|sealer` já adotada no `sealer-result` (ver bundle SEALER, conceito 5). Um bundle por produto, leve.
- ➕ Isolamento claro — nenhum código de um produto entra no bundle do outro.
- ➖ Refatoração inicial do Body não-trivial; cada produto vira uma configuração de build.

### Alternativa B — Profile em runtime

Um único build serve qualquer produto; o profile é escolhido em runtime por config.

- ➕ Um artefato só; troca de produto sem rebuild.
- ➖ Body e Sealer convivem no mesmo bundle/processo — bundle maior, superfície de erro cruzada, "código morto" do outro produto sempre presente.

### Alternativa C — Apps separados no mesmo repo

`vk-body` e `vk-sealer` como aplicações/diretórios irmãos dentro do repo (workspace Angular multi-projeto), compartilhando libs comuns (`projects/shared`).

- ➕ Sem refatorar o Body; separação física limpa; cada app evolui independente.
- ➖ Menos compartilhamento real em runtime; risco de divergência das libs comuns; mais cerimônia de build.

**Recomendação preliminar:** A (env var build-time) por consistência com `sealer-result`/`VR_PROFILE` e isolamento de bundle — mas a decisão fica para a conversa arquitetural. As telas e o componente 3D desta spec são **agnósticos ao mecanismo**: valem para qualquer das três alternativas.

## 5. Visualização 3D do cordão (`SealerBead3dComponent`) — referência técnica

> Registrada aqui como referência técnica embutida, conforme pedido na reunião ("o que foi investigado pode ficar no arquivo como referência na hora de desenvolver").

**Lib:** `@google/model-viewer` (v4.1.0, já no `frontend-ds`), que roda **Three.js** internamente. Mesma lib do Body, SmartDie e SpotFusion.

**Entrada de dados (por cordão):** ~40 pontos `X/Y/Z` amostrados do CAD da linha de centro do cordão, cada ponto com **atributos medidos** (presença, largura, altura, espessura).

**Curva:** traçar a linha como **spline de 3º grau** (`CatmullRomCurve3`, `curveType: 'centripetal'`) — curva suave que passa pelos pontos, **não** interpolação linear. Desejável um controle de grau da spline.

**Espessura:** em **unidade de mundo** (`LineMaterial.worldUnits = true` ou `TubeGeometry`) — a espessura é uma dimensão real do espaço 3D e **encolhe com a perspectiva**, ao contrário dos marcadores de pixel fixo do SpotFusion. A **seção do cordão é retangular** e deve ser respeitada quando houver modelo.

**Dois caminhos de implementação** (o sweep de perfil 2D foi descartado):

1. **Provisório** — enquanto a Hyundai não envia o modelo 3D dos cordões: traçar via `Line2` (fat line) ou `TubeGeometry`, com cor por vértice. É uma **ponte temporária**.
2. **Definitivo** — com o **modelo 3D de cada cordão** enviado pelo cliente: projetar cada vértice da malha do cordão na linha de centro (parâmetro de comprimento de arco `s`), mapear o atributo medido em `s` para a escala de cor e escrever **cor por vértice**. A GPU interpola entre vértices → transição suave. Funciona com a seção retangular sem mudança.

**Duas famílias de escala de cor** (a spec do design system precisa declarar ambas como tokens — hoje **não existem** no DS):

- **Discreta (qualitativa)** — modos de falha binários. 3–4 cores de alto contraste. Convenção da reunião: **vermelho** = falta de material/falha · **verde** = aplicação correta · **amarelo** = erro de especificação. ⚠️ amarelo puro some no fundo → usar laranja/vermelho para o severo. Hierarquia de severidade governa a escala.
- **Gradiente (quantitativa, estilo FEM/engenharia)** — dados contínuos (largura/espessura ao longo do comprimento). Degradê contínuo com **amplitude tonal máxima** declarada. Inclui um modo **isoline** (só fronteiras de nível). Semântica da métrica de espessura: correto = verde · falta = vermelho (pior) · excesso = azul — *mapa exato em aberto, seção 8.*

## 6. Mudanças necessárias

### 6.1 Profile `vk-sealer`
Conforme mecanismo escolhido (seção 4). Inclui: rotas do SEALER, tema/tokens, assets (GLB da carroceria + cordões), e o ponto de entrada que seleciona o produto.

### 6.2 Rotas do SEALER (`app.routes.ts`, no profile)
- `/retrabalho` (ou `/retrabalho/:lado` se as estações forem separadas — confirmar com layout físico) — tela passiva da TV 75", `data: { kiosk: true }`.
- `/` e `/producao` — tela de Produção.
- `/tracking` (lista) e `/tracking/:carroceriaId` (detalhe) — tela ativa.

### 6.3 Componentes novos
- `SealerBead3dComponent` — visualização 3D do cordão (seção 5).
- `RetrabalhoSealerComponent` — orquestra a tela passiva: espelhamento, linha central, divisão por Y, ícones auto-ajustados.
- `ProducaoComponent` — lista de peças + saúde + última imagem (pode reaproveitar muito de `ProductionComponent` do Body).
- `TrackingListComponent` + `TrackingDetailComponent` — fluxo lista → detalhe.

### 6.4 Reaproveitamento do Body
`ModelViewerThreeComponent`, `DefectsPanelComponent`, `StatusAlertComponent`, `CameraViewerComponent` são candidatos a reúso/extração para a lib compartilhada (depende do mecanismo de profile).

### 6.5 Modo kiosk
Mesmo padrão do IRIS-07: `route.data.kiosk` esconde header/sidenav, aumenta fonte, fundo limpo; fullscreen é do navegador.

## 7. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | Profile `vk-sealer` build/serve sem arrastar código exclusivo do Body (conforme mecanismo escolhido) | inspeção do bundle / configuração de build |
| 2 | Tela **Retrabalho** renderiza carroceria espelhada, linha tracejada central, divisão por coordenada Y | smoke visual com carroceria sintética |
| 3 | `SealerBead3dComponent` traça o cordão como spline suave, espessura em world-units, cor variando ao longo do comprimento | render de teste com ~40 pontos + atributos sintéticos |
| 4 | Ícones de defeito próximos se auto-ajustam na vertical sem sobreposição, com tracejado-guia à posição real | cena com defeitos agrupados |
| 5 | Tela **Produção** mostra lista de peças aprovadas, saúde do sistema e última imagem capturada | smoke com dados de teste |
| 6 | Tela **Tracking** permite selecionar carroceria histórica, girar/zoom, filtrar por classe, alternar escala discreta/gradiente/isoline | navegação manual |
| 7 | Estados aguardando-carroceria e sem-conexão exibidos corretamente nas telas passivas | desconectar backend / remover carroceria |
| 8 | Telas transversais (login/config/usuários) seguem o padrão comum dos demais produtos | comparação com Body/SmartDie |

## 8. Pendências (não bloqueiam a spec)

1. **Mecanismo de profile** — decisão arquitetural (seção 4), conversa mais profunda pendente.
2. **Cordão transversal** — regra de atribuição de dono (robô-responsável? maior comprimento por lado?).
3. **Mapa de cor da métrica quantitativa** — vermelho só para falta ou também para excesso? azul = excesso? Definir antes de criar os tokens no DS.
4. **Escala de cor no design system** — tokens da escala discreta e da gradiente (+ isoline) não existem; exigem nova modificação no DS, coordenada com o Guilherme/Tiago.
5. **Caminho de render 3D definitivo** — depende do envio dos modelos 3D dos cordões pela Hyundai (possivelmente segunda-feira); caminho 1 é ponte até lá.
6. **Estações de Retrabalho** — confirmar se a TV 75" é única ou se há rotas por estação (impacta `/retrabalho` vs `/retrabalho/:lado`).
7. **Mapeamento de telas comuns** entre SEALER/IRIS/SmartDie/SpotFusion — precisa sair antes de detalhar config/manutenção, para não retrabalhar.

## 9. Próximos passos

1. **User review** desta spec.
2. **Tiago** desenha o Figma `vk-sealer` com base nas 3 telas da seção 3.
3. Conversa arquitetural sobre o mecanismo de profile (seção 4).
4. Plan de implementação (`docs/superpowers/plans/2026-05-15-sealer-frontend-ds.md`) com TDD, após o Figma.
5. Coordenar com a spec `sealer-backend-ds` (contrato de API das 3 telas).
