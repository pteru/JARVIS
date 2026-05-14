# IRIS-07 frontend-iris — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao `visionking/services/frontend-ds` (Angular 19 SPA) as 4 rotas kiosk de retrabalho do IRIS GM SCDS, com polling automático de PVI corrente, auto-refresh de defeitos por mudança de PVI, estados de fallback (sem PVI / sem conexão), modo kiosk (header e sidenav escondidos, fonte aumentada) e procedimento ops de Chromium kiosk nos PCs auxiliares. Auth + roles e CAD 3D real ficam fora deste MVP.

**Spec:** `docs/superpowers/specs/2026-05-13-iris-07-frontend-design.md`

**Tech stack:** Angular 19 + Material 19 + RxJS 7.8 + @google/model-viewer 4.1 + SSR (Express Node.js). Testes: Jasmine + Karma via `ng test`. Build via `ng build`.

**Worktree:**
- Frontend-ds: `/home/teruel/worktrees/frontend-iris-07/` (NEW — branch `feat/iris-07` off `origin/develop`)

**Track ordering:** Track A é prerequisito. Tracks B, C, D podem ser desenvolvidas em paralelo após A. Track E depende de B+C+D. Track F depende de E. Track G é independente (pode rodar em paralelo com B-F). Tracks H e I são de finalização. Track J é apenas documentação de pendências.

---

## Track A — Worktree + baseline

### Task A1: Criar worktree e validar baseline

**Files:** worktree externo, sem modificações de código.

- [ ] **Step 1: Criar worktree em `feat/iris-07` off `origin/develop`**

```bash
cd /home/teruel/JARVIS/workspaces/strokmatic/visionking/services/frontend-ds
git fetch origin
git worktree add /home/teruel/worktrees/frontend-iris-07 -b feat/iris-07 origin/develop
cd /home/teruel/worktrees/frontend-iris-07
npm install
```

Expected: instalação limpa de dependências.

- [ ] **Step 2: Rodar baseline `ng test`**

```bash
cd /home/teruel/worktrees/frontend-iris-07
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | tail -20
```

Expected: testes existentes verdes. Se quebrarem antes de qualquer mudança, abrir issue/pause antes de avançar.

- [ ] **Step 3: Rodar baseline `ng build`**

```bash
npx ng build 2>&1 | tail -10
```

Expected: build limpo. Anotar tamanho de bundle para regressão futura.

**Estimativa Track A:** 0,5 dia.

---

## Track B — Rotas + `RetrabalhoViewComponent` skeleton

### Task B1: Adicionar rotas + skeleton + normalização de `station` (TDD)

**Files:**
- Modify: `src/app/app.routes.ts`
- Create: `src/app/views/retrabalho-view/retrabalho-view.component.ts`
- Create: `src/app/views/retrabalho-view/retrabalho-view.component.html`
- Create: `src/app/views/retrabalho-view/retrabalho-view.component.scss`
- Create: `src/app/views/retrabalho-view/retrabalho-view.component.spec.ts`

- [ ] **Step 1: Teste de rota falhando — Router resolve `RetrabalhoViewComponent` para as 4 estações**

```typescript
// retrabalho-view.component.spec.ts
const stations = ['superior-direita', 'superior-esquerda', 'lateral-direita', 'lateral-esquerda'];

stations.forEach(s => {
  it(`route /retrabalho/${s} resolves component`, fakeAsync(() => {
    router.navigateByUrl(`/retrabalho/${s}`);
    tick();
    expect(location.path()).toBe(`/retrabalho/${s}`);
  }));
});
```

Expected: fail — componente e rota não existem.

- [ ] **Step 2: Teste de normalização — componente expõe `groupName` com `_` no lugar de `-`**

```typescript
it('normalizes station param replacing - with _', () => {
  // route param = 'superior-direita' → component.groupName = 'superior_direita'
  expect(component.groupName).toBe('superior_direita');
});
```

Expected: fail.

- [ ] **Step 3: Criar componente skeleton lendo `:station` via `ActivatedRoute`**

```typescript
@Component({ selector: 'app-retrabalho-view', standalone: true, ... })
export class RetrabalhoViewComponent {
  station = signal<string>('');
  groupName = computed(() => this.station().replace(/-/g, '_'));

  constructor(private route: ActivatedRoute) {
    this.route.paramMap.pipe(takeUntilDestroyed())
      .subscribe(p => this.station.set(p.get('station') ?? ''));
  }
}
```

- [ ] **Step 4: Registrar rota em `app.routes.ts`**

```typescript
{
  path: 'retrabalho/:station',
  loadComponent: () => import('./views/retrabalho-view/retrabalho-view.component')
    .then(m => m.RetrabalhoViewComponent),
  data: { kiosk: true },
}
```

- [ ] **Step 5: Rodar testes — todos verdes**

**Estimativa Track B:** 0,5 dia.

---

## Track C — `PviPollerService`

### Task C1: Service de polling de PVI corrente (TDD)

**Files:**
- Create: `src/app/core/services/pvi-poller.service.ts`
- Create: `src/app/core/services/pvi-poller.service.spec.ts`
- Modify: `src/environments/environment.ts` (+ `environment.development.ts` se existir) — adicionar `pviPollIntervalMs: 3000`

- [ ] **Step 1: Teste falhando — emite fetch inicial imediatamente (`startWith(0)`)**

```typescript
it('emits initial PVI fetch immediately', fakeAsync(() => {
  let received: string | null = 'unset' as any;
  service.watchPvi('superior_direita').subscribe(v => received = v);
  const req = httpMock.expectOne(r =>
    r.url === '/api/redis/pvi-current' && r.params.get('station') === 'superior_direita'
  );
  req.flush({ station: 'superior_direita', pvi: 'PVI123' });
  tick(0);
  expect(received).toBe('PVI123');
}));
```

Expected: fail — service não existe.

- [ ] **Step 2: Teste falhando — emite novamente após `pviPollIntervalMs`**

```typescript
it('polls every intervalMs', fakeAsync(() => {
  const emissions: (string|null)[] = [];
  service.watchPvi('superior_direita').subscribe(v => emissions.push(v));
  httpMock.expectOne(/pvi-current/).flush({ pvi: 'A' });
  tick(3000);
  httpMock.expectOne(/pvi-current/).flush({ pvi: 'B' });
  expect(emissions).toEqual(['A', 'B']);
}));
```

- [ ] **Step 3: Teste falhando — `distinctUntilChanged` suprime duplicatas**

```typescript
it('suppresses duplicate PVI emissions', fakeAsync(() => {
  const emissions: (string|null)[] = [];
  service.watchPvi('s').subscribe(v => emissions.push(v));
  httpMock.expectOne(/pvi/).flush({ pvi: 'A' });
  tick(3000);
  httpMock.expectOne(/pvi/).flush({ pvi: 'A' });  // mesmo PVI
  tick(3000);
  httpMock.expectOne(/pvi/).flush({ pvi: 'B' });
  expect(emissions).toEqual(['A', 'B']);
}));
```

- [ ] **Step 4: Teste falhando — erro HTTP emite `null` (não derruba o stream)**

```typescript
it('emits null on HTTP error and continues polling', fakeAsync(() => {
  const emissions: (string|null)[] = [];
  service.watchPvi('s').subscribe(v => emissions.push(v));
  httpMock.expectOne(/pvi/).error(new ProgressEvent('Network error'));
  tick(3000);
  httpMock.expectOne(/pvi/).flush({ pvi: 'A' });
  expect(emissions).toEqual([null, 'A']);
}));
```

- [ ] **Step 5: Implementar `PviPollerService`**

```typescript
@Injectable({ providedIn: 'root' })
export class PviPollerService {
  private intervalMs = environment.pviPollIntervalMs ?? 3000;
  constructor(private http: HttpClient) {}

  watchPvi(station: string): Observable<string | null> {
    return interval(this.intervalMs).pipe(
      startWith(0),
      switchMap(() => this.http.get<{station: string, pvi: string | null}>(
        '/api/redis/pvi-current', { params: { station } }
      ).pipe(
        map(r => r.pvi),
        catchError(() => of(null)),
      )),
      distinctUntilChanged(),
    );
  }
}
```

- [ ] **Step 6: Adicionar `pviPollIntervalMs: 3000` em `environment.ts`**

- [ ] **Step 7: Rodar testes — todos verdes**

**Estimativa Track C:** 1 dia.

---

## Track D — `DefectsService.fetchByPviStation`

### Task D1: Método de busca de defeitos por PVI + estação (TDD)

**Files:**
- Modify: `src/app/core/services/defeito.service.ts` (ou equivalente DefectsService — verificar nome real no skeleton)
- Modify/Create: `src/app/core/services/defeito.service.spec.ts`

- [ ] **Step 1: Teste falhando — URL e params corretos**

```typescript
it('fetchByPviStation calls /api/defects with pecaId and group_name', () => {
  service.fetchByPviStation('PVI123', 'superior-direita').subscribe();
  const req = httpMock.expectOne(r => r.url === '/api/defects');
  expect(req.request.params.get('pecaId')).toBe('PVI123');
  expect(req.request.params.get('group_name')).toBe('superior_direita');
  req.flush([]);
});
```

Expected: fail — método não existe.

- [ ] **Step 2: Teste falhando — translate `-` → `_` em `group_name`**

```typescript
it('translates station hyphen to underscore for group_name', () => {
  service.fetchByPviStation('X', 'lateral-esquerda').subscribe();
  const req = httpMock.expectOne(r =>
    r.params.get('group_name') === 'lateral_esquerda'
  );
  req.flush([]);
});
```

- [ ] **Step 3: Teste falhando — response mapeada para `Defect[]`**

```typescript
it('returns Defect[] from API', () => {
  let result: Defect[] = [];
  service.fetchByPviStation('X', 's').subscribe(d => result = d);
  httpMock.expectOne(/defects/).flush([
    { id: 1, type: 'SCRATCH', position: { x: 10, y: 20, z: 30 } }
  ]);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe('SCRATCH');
});
```

- [ ] **Step 4: Implementar método**

```typescript
fetchByPviStation(pvi: string, station: string): Observable<Defect[]> {
  const groupName = station.replace(/-/g, '_');
  return this.http.get<Defect[]>('/api/defects', {
    params: { pecaId: pvi, group_name: groupName }
  });
}
```

- [ ] **Step 5: Rodar testes — todos verdes**

**Estimativa Track D:** 0,5 dia.

---

## Track E — `RetrabalhoViewComponent` completo (integração)

### Task E1: Combinar pvi-poller + defects-fetch via `switchMap` (TDD)

**Files:**
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.ts`
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.html`
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.scss`
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.spec.ts`

- [ ] **Step 1: Teste falhando — mudança de PVI dispara fetch de defeitos**

```typescript
it('fetches defects when PVI changes', fakeAsync(() => {
  const pviSubject = new BehaviorSubject<string | null>(null);
  pviPollerSpy.watchPvi.and.returnValue(pviSubject);
  defectsSpy.fetchByPviStation.and.returnValue(of([{ id: 1 } as Defect]));

  fixture.detectChanges();
  pviSubject.next('PVI001');
  tick();
  expect(defectsSpy.fetchByPviStation).toHaveBeenCalledWith('PVI001', 'superior-direita');
  expect(component.defects().length).toBe(1);
}));
```

- [ ] **Step 2: Teste falhando — PVI null retorna array vazio (sem chamar fetch)**

```typescript
it('shows empty defects when PVI is null', fakeAsync(() => {
  pviSubject.next(null);
  tick();
  expect(component.defects().length).toBe(0);
  expect(defectsSpy.fetchByPviStation).not.toHaveBeenCalled();
}));
```

- [ ] **Step 3: Implementar lógica em `ngOnInit`**

```typescript
ngOnInit() {
  combineLatest([
    this.route.paramMap.pipe(map(p => p.get('station') ?? '')),
  ]).pipe(
    switchMap(([station]) => this.pviPoller.watchPvi(station.replace(/-/g, '_')).pipe(
      switchMap(pvi => pvi
        ? this.defectsService.fetchByPviStation(pvi, station)
        : of([])
      ),
      tap(d => this.currentPvi.set(pvi)),
    )),
    takeUntilDestroyed(this.destroyRef),
  ).subscribe(defects => this.defects.set(defects));
}
```

- [ ] **Step 4: Layout HTML — reaproveitar `ModelViewerThreeComponent` + `DefectsPanelComponent`**

```html
<header class="retrabalho-header">
  <img src="assets/logo-vk.svg" />
  <span>{{ currentPvi() ?? '—' }}</span>
  <span>{{ now | date:'HH:mm:ss' }}</span>
</header>
<main class="retrabalho-body">
  <aside class="defects-list">
    <app-defects-panel [defects]="defects()" />
  </aside>
  <section class="model-area">
    <app-model-viewer-three [defects]="defects()" [station]="station()" />
  </section>
</main>
<footer class="retrabalho-footer">v{{ version }} · Strokmatic</footer>
```

- [ ] **Step 5: SCSS compacto** — header < 60px, footer < 30px, grid 30/70 para defects/model.

- [ ] **Step 6: Rodar testes — todos verdes**

**Estimativa Track E:** 1 dia.

---

## Track F — Estados visuais (fallbacks)

### Task F1: Tela "Aguardando carroceria" + "Sem conexão" (TDD)

**Files:**
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.ts` (estado computado)
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.html`
- Modify: `src/app/views/retrabalho-view/retrabalho-view.component.spec.ts`

- [ ] **Step 1: Teste falhando — estado `waiting` quando PVI=null e sem erro recente**

```typescript
it('shows waiting state when pvi=null and no consecutive errors', () => {
  component.currentPvi.set(null);
  component.consecutiveErrors.set(0);
  expect(component.viewState()).toBe('waiting');
});
```

- [ ] **Step 2: Teste falhando — estado `offline` quando N erros consecutivos**

```typescript
it('shows offline state when consecutiveErrors >= threshold', () => {
  component.consecutiveErrors.set(3);
  expect(component.viewState()).toBe('offline');
});
```

- [ ] **Step 3: Teste falhando — estado `operational` com PVI ativo**

```typescript
it('shows operational state when pvi is set', () => {
  component.currentPvi.set('PVI001');
  component.consecutiveErrors.set(0);
  expect(component.viewState()).toBe('operational');
});
```

- [ ] **Step 4: Implementar `viewState` como `computed` signal + contador de erros**

`PviPollerService` precisa emitir um sinal distinto entre `null` por erro vs `null` por ausência. Opção mínima: expor segundo `Observable<boolean>` `lastErrorOccurred$`, ou alterar shape para `{ pvi: string | null, error: boolean }`. Optar pelo shape rico — atualizar Track C como follow-up se já mergeado.

- [ ] **Step 5: HTML com `@switch (viewState())`**

```html
@switch (viewState()) {
  @case ('waiting') {
    <div class="state-waiting">Aguardando carroceria na estação {{ stationLabel() }}</div>
  }
  @case ('offline') {
    <div class="state-offline">Sem conexão com servidor IRIS — verificar rede</div>
  }
  @case ('operational') {
    <!-- layout normal -->
  }
}
```

- [ ] **Step 6: SCSS** — telas de fallback ocupam viewport inteiro, fonte grande (≥ 48px), contraste alto.

- [ ] **Step 7: Rodar testes — todos verdes**

**Estimativa Track F:** 0,5 dia.

---

## Track G — Kiosk mode

### Task G1: `isKiosk$` + esconder header/sidenav + CSS `kiosk-mode` (TDD)

**Files:**
- Modify: `src/app/app.component.ts` (ler `route.data.kiosk`)
- Modify: `src/app/app.component.html` (esconder header/sidenav com `*ngIf`)
- Modify: `src/app/layout/header/header.component.html` ou equivalente
- Modify: `src/app/layout/sidenav/sidenav.component.html` ou equivalente
- Modify: `src/styles.scss` (classe `kiosk-mode` no body)
- Modify: `src/app/app.component.spec.ts`

- [ ] **Step 1: Teste falhando — `isKiosk$` true ao navegar para rota kiosk**

```typescript
it('isKiosk$ emits true on /retrabalho/:station', fakeAsync(() => {
  let kiosk = false;
  app.isKiosk$.subscribe(v => kiosk = v);
  router.navigateByUrl('/retrabalho/superior-direita');
  tick();
  expect(kiosk).toBeTrue();
}));
```

- [ ] **Step 2: Teste falhando — `isKiosk$` false na rota `/`**

```typescript
it('isKiosk$ emits false on /', fakeAsync(() => {
  router.navigateByUrl('/');
  tick();
  let kiosk = true;
  app.isKiosk$.subscribe(v => kiosk = v);
  expect(kiosk).toBeFalse();
}));
```

- [ ] **Step 3: Implementar `isKiosk$` em `AppComponent`**

```typescript
isKiosk$ = this.router.events.pipe(
  filter(e => e instanceof NavigationEnd),
  map(() => this.getDeepestRouteData(this.route)?.['kiosk'] === true),
  startWith(false),
  distinctUntilChanged(),
);
```

- [ ] **Step 4: Aplicar `*ngIf="!(isKiosk$ | async)"` no `<app-header>` e `<app-sidenav>`**

- [ ] **Step 5: Renderer2 adiciona/remove classe `kiosk-mode` no `<body>`**

```typescript
this.isKiosk$.subscribe(k => {
  if (k) this.renderer.addClass(document.body, 'kiosk-mode');
  else this.renderer.removeClass(document.body, 'kiosk-mode');
});
```

- [ ] **Step 6: SCSS global**

```scss
body.kiosk-mode {
  font-size: 18pt;  // +50% sobre 12pt base
  overflow: hidden;
  & ::-webkit-scrollbar { display: none; }
}
```

- [ ] **Step 7: Rodar testes — todos verdes**

**Estimativa Track G:** 0,5 dia.

---

## Track H — Procedimento Chromium kiosk (docs ops)

### Task H1: Runbook de instalação no PC auxiliar

**Files:**
- Create: `docs/iris-07-kiosk-setup.md` (no repo do frontend-ds)

- [ ] **Step 1: Cobrir secções obrigatórias**
  - OS base (Ubuntu 22.04 LTS) + instalação Chromium via `apt`.
  - Usuário `iris-kiosk` + auto-login no boot via `lightdm.conf` ou `gdm` autologin.
  - Service systemd `iris-kiosk.service` que invoca:
    ```
    chromium-browser --kiosk --noerrdialogs --no-first-run \
      --disable-translate --disable-pinch \
      --autoplay-policy=no-user-gesture-required \
      https://<nginx-iris>/retrabalho/<station>
    ```
    com `Restart=always`.
  - Watchdog cron (cada 1min): `pgrep chromium || systemctl restart iris-kiosk`.
  - Power management: `xset s off`, `xset -dpms`, desativar suspend (`systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`).
  - Variação por estação: 4 PCs × 4 URLs distintas.

- [ ] **Step 2: Não inclui código de produção** — runbook apenas para ops/Vinicius.

**Estimativa Track H:** 0,5 dia.

---

## Track I — Smoke test E2E manual

### Task I1: Validar end-to-end com backend IRIS-06 + smoke data

**Files:** sem código novo; capturas + log.

- [ ] **Step 1: Subir backend IRIS-06 com smoke data**

Conforme plan IRIS-06, popular Redis DB com PVI sintético + 12 defeitos distribuídos pelas 4 estações.

- [ ] **Step 2: Navegar pelas 4 rotas no browser de desenvolvimento**

```
http://localhost:4200/retrabalho/superior-direita
http://localhost:4200/retrabalho/superior-esquerda
http://localhost:4200/retrabalho/lateral-direita
http://localhost:4200/retrabalho/lateral-esquerda
```

Verificar:
- Header e sidenav escondidos (kiosk mode ON).
- Fonte ampliada.
- Lista de defeitos só mostra os da estação correspondente.

- [ ] **Step 3: Trocar PVI sintético via `redis-cli`**

```bash
redis-cli SET pvi:superior_direita PVI999
```

Cronometrar: tela atualiza em < 5s (poll interval + render).

- [ ] **Step 4: Testar fallbacks**
  - Limpar Redis → estado "Aguardando carroceria".
  - Matar backend → estado "Sem conexão" após 3 polls.

- [ ] **Step 5: Tirar 4 screenshots** em estado operacional para anexar na spec.

**Estimativa Track I:** 0,5 dia.

---

## Track J — Pendências DEFERIDAS (não geram tasks)

> Não criar issues nem branches para os itens abaixo. Listados para referência cruzada com a spec §6.

- **Auth + roles** — iteração futura. MVP serve rotas abertas.
- **CAD 3D real por Style GM** — depende de [G5]. Mantém GLB estático em `assets/models/52182584.glb`.
- **Listagem real dos Styles GM + mapping Style→GLB** — depende de Gustavo.
- **PCs físicos** — depende de [G4] (compra/entrega Vinicius).
- **Sleep policy / horário operacional** — confirmar SOP com GM.
- **Branding final IRIS** (texto header) — pendência baixa.
- **i18n EN paralelo** — TBD com GM.

---

## Critérios de merge para a branch `feat/iris-07`

1. ✅ Tracks A-I green: `ng test` 100% passa (incluindo specs novos de B, C, D, E, F, G).
2. ✅ `ng build` produção limpo, sem warnings novos de bundle/treeshake.
3. ✅ 4 rotas kiosk acessíveis manualmente, com kiosk mode aplicado (header/sidenav escondidos).
4. ✅ Polling de PVI confirmado via DevTools network + cronometragem < 5s entre mudança no Redis e re-render.
5. ✅ Fallbacks visuais "Aguardando carroceria" e "Sem conexão" testados.
6. ✅ Smoke E2E com backend IRIS-06 + 4 screenshots anexados.
7. ✅ Runbook `docs/iris-07-kiosk-setup.md` criado.
8. ⚠️ Validação em PC físico kiosk fica como **post-merge follow-up** quando [G4] entregar os PCs.
9. ⚠️ Track J documentada na spec, **não bloqueia o merge**.

---

## Estimativa de esforço

| Track | Esforço |
|---|---|
| A — worktree + baseline | 0,5 dia |
| B — rotas + skeleton | 0,5 dia |
| C — `PviPollerService` | 1 dia |
| D — `DefectsService.fetchByPviStation` | 0,5 dia |
| E — `RetrabalhoViewComponent` completo | 1 dia |
| F — estados visuais (fallbacks) | 0,5 dia |
| G — kiosk mode | 0,5 dia |
| H — runbook Chromium kiosk (docs) | 0,5 dia |
| I — smoke E2E manual + screenshots | 0,5 dia |
| J — pendências DEFERIDAS | 0 (sem task) |

**Total scaffolding:** ~5 dias efetivos de implementação. Validação em PC físico kiosk é post-merge (depende de [G4]).
