---
type: Design Spec
title: IRIS-07 — frontend-iris
description: Habilitar o `visionking/services/frontend-ds` (Angular 19) para servir o IRIS GM SCDS aproveitando o trabalho da POC Stellantis 03010 (mesmo produto VK Body) e os mockups já desenhados no Figma `ZD...
timestamp: 2026-05-13
---

# IRIS-07 — frontend-iris

**Status:** Draft, pending user review.
**Author:** Pedro Teruel (with Claude)
**Date:** 2026-05-13
**Project:** 03007 IRIS GM SCDS Paint
**ClickUp:** [3.9] IRIS-07 spec (`868jk1jhe`)
**Deadline interno:** 09/06 (spec → implementação → integração)

## 1. Goal

Habilitar o `visionking/services/frontend-ds` (Angular 19) para servir o IRIS GM SCDS aproveitando o trabalho da POC Stellantis 03010 (mesmo produto VK Body) e os mockups já desenhados no Figma `ZDfitEWm0gYTmGYbyxRnf7` ("✅Mockup v1"). O delta IRIS-07 são (a) **4 rotas kiosk dedicadas** para as TVs de retrabalho (uma por estação), (b) **mecanismo de detecção automática de PVI corrente** via polling no backend, (c) **estados operacionais** que faltam no frontend atual (kiosk mode, fallback offline, auto-refresh em mudança de PVI). Auth + roles ficam **fora deste MVP** — todas as rotas serão abertas read-only para o primeiro deploy.

## 2. Scope

**In:**
- 4 rotas kiosk de retrabalho:
  - `/retrabalho/superior-direita`
  - `/retrabalho/superior-esquerda`
  - `/retrabalho/lateral-direita`
  - `/retrabalho/lateral-esquerda`
- Dashboard de produção (rota `/`) mantida como hoje, **aberta** (sem login no MVP).
- Service Angular que faz **polling de PVI corrente** no backend a cada 2-5s (intervalo configurável via env), com base em `GET /api/redis/pvi-current?station=<group_name>`.
- Auto-refresh da lista de defeitos quando PVI muda: `switchMap` cancela request anterior se PVI mudar antes da resposta chegar.
- Componente `retrabalho-view` reutilizando os componentes existentes (`ModelViewerThreeComponent` + `DefectsPanelComponent`) com layout baseado no frame `v1-retrabalho-lateral` do Figma.
- Modo kiosk via query param ou rota: header/sidenav escondidos, fonte aumentada, fundo branco/contrastado.
- Tela de fallback: "Aguardando carroceria na estação" (sem PVI) e "Sem conexão com servidor" (erro de rede).
- Procedimento de instalação Chromium kiosk no PC auxiliar (docs operacionais, sem código).

**Out (rejeitado ou deferido):**
- **Auth + roles** — deferido para spec futura. MVP serve todas rotas abertas. Detalhamento de papéis/acessos vem depois conforme operação for amadurecendo.
- **WebSocket / Server-Sent Events** — polling REST simples basta para 2-4 TVs em rede isolada. Push real-time fica como evolução se latência virar problema.
- **`display-manager` Android TV** — descartado (ver memória `project_03007_iris_no_display_manager`). PCs com Chromium kiosk substituem totalmente o app Kotlin nativo.
- **3D mesh dinâmico por Style** — depende do CAD da GM ([G5]) que ainda não foi enviado. Usa GLB estático no `assets/models/` (mesmo padrão do `frontend-ds` atual).
- **Tela de admin para gerenciar TVs** — não necessário sem display-manager.
- **i18n** — fica como está hoje (PT-BR). Telas internas GM podem exigir EN paralelo depois — fora do MVP.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Rede Hirschmann (isolada)                                     │
│                                                                │
│   4× PC auxiliar com Chromium kiosk                           │
│   ────────────────────────────────                            │
│   PC sup-dir       → URL fixa /retrabalho/superior-direita    │
│   PC sup-esq       → URL fixa /retrabalho/superior-esquerda   │
│   PC lat-dir       → URL fixa /retrabalho/lateral-direita     │
│   PC lat-esq       → URL fixa /retrabalho/lateral-esquerda    │
│                                                                │
│                            │ HTTPS (GEUE CA)                  │
│                            ▼                                  │
│                  ┌────────────────────┐                       │
│                  │   nginx :443       │                       │
│                  │   serve SPA  ───┐  │                       │
│                  │   proxy /api  ──┼─→│ → backend IRIS-06     │
│                  └────────────────────┘                       │
│                                                                │
│                  ┌────────────────────┐                       │
│                  │   Angular SPA      │                       │
│                  │   roteado por URL  │                       │
│                  │                    │                       │
│                  │  retrabalho-view   │                       │
│                  │     │              │                       │
│                  │     ├─ pvi-poller  │ ←─ a cada 2-5s:       │
│                  │     │              │    GET /api/redis/    │
│                  │     │              │       pvi-current     │
│                  │     │              │                       │
│                  │     └─ defects-fetch ←─ on PVI change:    │
│                  │                          GET /api/defects? │
│                  │                          pecaId=X&         │
│                  │                          group_name=Y      │
│                  │                                            │
│                  │  ModelViewerThree (GLB + hotspots)         │
│                  │  DefectsPanel (lista Type/Position)        │
│                  └────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

**Pontos-chave:**
- Cada PC kiosk é configurado com **uma rota fixa** (carregada no boot via systemd / Task Scheduler + Chromium em `--kiosk`).
- O componente `retrabalho-view` lê `route.params.station`, configura o polling, renderiza.
- PVI poller é **dedicado por instância de rota** — quando rota muda, poller é destruído.
- Não há WebSocket; apenas HTTP GETs via nginx → backend.

## 4. Mudanças necessárias

### 4.1 Roteamento (`src/app/app.routes.ts`)

Adicionar 4 rotas kiosk + 1 catch-all:

```typescript
export const routes: Routes = [
  // existentes mantidas
  { path: '', pathMatch: 'full', component: ProductionComponent },
  { path: 'production', component: ProductionComponent },
  { path: 'cameras', component: CamerasViewComponent },
  { path: 'camera-demo', component: CameraDemoComponent },

  // novas — kiosk retrabalho (1 por estação)
  {
    path: 'retrabalho/:station',
    component: RetrabalhoViewComponent,
    data: { kiosk: true },
  },

  // fallback
  { path: '**', redirectTo: '' },
];
```

`station` será uma das 4 strings padronizadas: `superior-direita`, `superior-esquerda`, `lateral-direita`, `lateral-esquerda`. O componente normaliza `-` → `_` para casar com `group_name` do backend (`superior_direita` etc.).

### 4.2 Componente `retrabalho-view`

Layout idêntico ao frame `v1-retrabalho-lateral` do Figma:
- Header compacto: logo VisionKing + timestamp + ID/Modelo da carroceria atual
- Sidebar esquerda: lista de defeitos (Type / Position) — `DefectsPanelComponent` adaptado
- Centro: silhueta da carroceria (GLB rotacionado conforme estação) + hotspots — `ModelViewerThreeComponent` reaproveitado
- Badge NOK/Ok no canto superior direito
- Footer mínimo (versão + logo Strokmatic)

Estados visuais:
- **Operacional:** PVI ativo, defeitos renderizados.
- **Aguardando carroceria:** sem PVI no Redis. Tela cinza com mensagem grande "Aguardando carroceria na estação <nome>".
- **Sem conexão:** backend não responde por > N tentativas. Banner vermelho + mensagem "Sem conexão com servidor IRIS — verificar rede".

### 4.3 Service `PviPollerService`

```typescript
@Injectable({ providedIn: 'root' })
export class PviPollerService {
  private intervalMs = environment.pviPollIntervalMs ?? 3000;

  watchPvi(station: string): Observable<string | null> {
    return interval(this.intervalMs).pipe(
      startWith(0),
      switchMap(() =>
        this.http.get<{station: string, pvi: string | null}>(
          `/api/redis/pvi-current?station=${station}`
        ).pipe(
          map(r => r.pvi),
          catchError(err => of(null))  // null = sem conexão ou sem PVI
        )
      ),
      distinctUntilChanged(),  // só emite quando muda
    );
  }
}
```

Uso em `RetrabalhoViewComponent`:

```typescript
ngOnInit() {
  this.pviPoller.watchPvi(this.station).pipe(
    takeUntilDestroyed(this.destroyRef),
    switchMap(pvi => pvi
      ? this.defectsService.fetchByPviStation(pvi, this.station)
      : of([])
    ),
  ).subscribe(defects => this.defects = defects);
}
```

### 4.4 Service `DefectsService.fetchByPviStation`

```typescript
fetchByPviStation(pvi: string, station: string): Observable<Defect[]> {
  const groupName = station.replace('-', '_');
  return this.http.get<Defect[]>(`/api/defects`, {
    params: { pecaId: pvi, group_name: groupName }
  });
}
```

### 4.5 Kiosk mode (CSS / route data)

`AppComponent` lê o `route.data.kiosk` flag. Quando `true`:
- Esconde header global e sidenav (`*ngIf="!isKiosk"`).
- Aplica classe CSS `kiosk-mode` no `<body>`: fonte base +50% (12pt → 18pt), max-width: 100vw, sem scrollbars.
- Browser fullscreen é responsabilidade do Chromium (`--kiosk` flag), não da SPA.

### 4.6 Procedimento de instalação Chromium kiosk (operacional, sem código)

Documento `docs/iris-07-kiosk-setup.md`:
- OS: Ubuntu 22.04 LTS no PC auxiliar.
- Chromium instalado via `apt`.
- Service systemd ou desktop autostart que executa:
  ```
  chromium-browser \
    --kiosk \
    --noerrdialogs --no-first-run --disable-translate \
    --autoplay-policy=no-user-gesture-required \
    https://<nginx-iris>/retrabalho/<station>
  ```
- Watchdog cron para reiniciar Chromium se travar (`pgrep chromium || systemctl restart chromium-kiosk`).
- Configuração do PC para auto-login no boot (auto-login user `iris-kiosk`).
- Política de power management: desabilitar suspend/sleep da tela e do PC.

## 5. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| 1 | 4 rotas kiosk acessíveis: `/retrabalho/{station}` para as 4 estações | navegar manualmente em browser de desenvolvimento |
| 2 | `PviPollerService` faz GET no backend a cada 2-5s e emite só em mudança de PVI | DevTools network panel + console logs |
| 3 | Quando PVI muda no Redis, `RetrabalhoViewComponent` busca defeitos novos e atualiza UI em < 5s (poll interval + render) | injetar PVI sintético via `redis-cli` e cronometrar |
| 4 | Sem PVI → tela "Aguardando carroceria"; sem conexão → banner "Sem conexão" | desconectar Redis e verificar |
| 5 | Filtro por `group_name` correto: cada estação mostra apenas defeitos da sua região da carroceria | smoke test E2E com 12 defeitos distribuídos pelas 4 estações |
| 6 | Modo kiosk: header e sidenav escondidos, fonte aumentada, fundo limpo | inspecionar DOM + visual |
| 7 | Chromium em `--kiosk` consome a URL e renderiza fullscreen 1920×1080 sem barras/abas | dry-run em PC kiosk com URL real |
| 8 | Reinício do Chromium volta para mesma URL kiosk sem intervenção | matar processo + verificar autoload |

## 6. Pendências (não bloqueiam a spec)

1. **Auth + roles** — em iteração futura. Definir quais rotas viram protegidas (admin? produção?), mecanismo (JWT cookie? OAuth?), e como TVs continuam abertas.
2. **CAD 3D real por Style GM** — depende de [G5] (envio GM). Hoje usa GLB estático em `assets/models/52182584.glb`.
3. **Listagem real dos Styles GM** + mapeamento Style→GLB — depende de Gustavo.
4. **Hostname do PC kiosk** — confirmar com GM/Vinicius onde cada PC vai ficar fisicamente e qual IP/hostname terá.
5. **Política de tela bloqueada/sleep** — confirmar SOP com GM (operação 24/7? horário comercial? tela apagar fora do expediente?).
6. **Branding final IRIS** — header hoje mostra "VisionKing"; GM pode pedir "IRIS" ou similar. Pendência baixa.
7. **i18n EN paralelo** — TBD com GM se auditoria precisa ler em inglês.

## 7. Próximos passos

1. **User review** desta spec.
2. Plan de implementação (`docs/superpowers/plans/2026-05-13-iris-07-frontend.md`) com TDD focado em `PviPollerService`, `RetrabalhoViewComponent`, fallback states, kiosk CSS.
3. Coordenar com Vinicius: 4 PCs auxiliares (especificação HW, OS, fixação física na área de retrabalho).
4. Acompanhar [G4] **Computadores adicionais TVs retrabalho** — destrava o deploy físico das TVs.
5. Spec futura: auth + roles (pendência 6.1).
