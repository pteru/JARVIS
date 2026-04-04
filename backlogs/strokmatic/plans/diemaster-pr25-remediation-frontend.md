# DieMaster Frontend — PR #37 Review Remediation

## Context

PR #37 (`fix/868hrfz4m/production-screen`) was merged to `develop` on diemaster-front-end.
A post-merge review identified 3 remaining issues that must be fixed.

## Workspace

- Repo: `strokmatic/diemaster-front-end`
- Path: `workspaces/strokmatic/diemaster/services/frontend`
- Base branch: `develop`
- Fix branch: `fix/pr25-review-remediation`
- Stack: Angular 17, TypeScript, Angular Material, ECharts

## Files to Read First

- `src/app/features/reports/reports-content/reports-content.component.ts` — has XSS and broken spec
- `src/app/features/reports/reports-content/reports-content.component.spec.ts` — broken spec
- `src/app/features/reports/reports.component.spec.ts` — broken spec
- `src/app/features/reports/reports-sidebar/reports-sidebar.component.spec.ts` — broken spec
- `src/app/core/interceptors/error-catching.interceptor.ts` — guest 401 silent failure

## Fixes

### Fix 1: XSS in PDF export [HIGH]

**File**: `src/app/features/reports/reports-content/reports-content.component.ts`

The `exportAsPDF()` method uses `document.write()` with unescaped server data. Project names or IDs containing HTML/script tags would execute in the new window (same origin as the app).

**What to do**:

Add a private `escapeHtml` method to the component:

```typescript
private escapeHtml(str: unknown): string {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
```

Then wrap every interpolated value in the HTML template string inside `exportAsPDF()` with `this.escapeHtml(...)`. This includes all `item.*` properties and any other server-supplied data in the `<tr>` rows and the document title/header.

Do NOT change the overall structure of the method — just escape the values.

### Fix 2: Fix broken test specs [HIGH]

**Files**:
- `src/app/features/reports/reports.component.spec.ts`
- `src/app/features/reports/reports-content/reports-content.component.spec.ts`
- `src/app/features/reports/reports-sidebar/reports-sidebar.component.spec.ts`

These specs reference properties and methods that don't exist on their components (e.g., `filteredData`, `totalItems`, `onSearch`, `generateCSV`). They appear to have been copied from a template.

**What to do**:

Read each component's actual TypeScript class to understand its real properties and methods. Then rewrite each spec to:

1. Test component creation (`should create`)
2. Test actual public methods that exist on the component
3. Mock dependencies properly (especially `RelatoriosService` in `ReportsContentComponent`)

For `ReportsComponent` and `ReportsSidebarComponent`, which are simple structural components, a basic creation test with mocked dependencies is sufficient.

For `ReportsContentComponent`, test:
- `onSearch()` — verify it resets page and calls `loadData()`
- `onStatusFilter()` — verify it resets page and calls `loadData()`
- `exportAsCSV()` — verify it processes `dataSource` into a download
- `escapeHtml()` — verify it escapes HTML entities (after Fix 1 is applied)

Use Angular `TestBed` with `HttpClientTestingModule` and provide mocked services:
```typescript
providers: [
    { provide: RelatoriosService, useValue: { getProjects: () => of({ data: [], pagination: { total: 0, pages: 0 } }) } }
]
```

### Fix 3: Fix error interceptor guest 401 silent failure [MEDIUM]

**File**: `src/app/core/interceptors/error-catching.interceptor.ts`

Currently, when a guest gets a 401:
1. `refreshGuestSession()` is called → returns `EMPTY`
2. `switchMap` on `EMPTY` never emits → request silently swallowed
3. User sees nothing — dashboard hangs on loading state

Since guests have no JWT to refresh, the 401 handling should show a notification and propagate the error instead of trying to refresh.

**What to do**:

In the 401 handler, change the guest branch from attempting a refresh to showing a notification directly:

**Before** (simplified):
```typescript
if (isGuest && !isLoginRequest) {
    return this.authService.refreshGuestSession().pipe(
        switchMap(() => { /* retry request */ }),
        catchError(() => {
            sessionStorage.clear();
            this.router.navigate(['/login']);
            return EMPTY;
        }),
    );
}
```

**After**:
```typescript
if (isGuest && !isLoginRequest) {
    const message = this.createMessage(
        error?.error?.message,
        this.translate.instant('ERROR_UNAUTHORIZED'),
    );
    this.notificationService.open(message, 'error');
    return throwError(() => message);
}
```

This matches the original develop behavior: guests see a toast notification on 401 and the error propagates to the calling component. Remove the now-unused `switchMap` import if it's no longer used elsewhere in the file.

## Commits

Single commit with message:
```
fix(reports,security): fix XSS, broken specs, and guest error handling

- Escape HTML in PDF export to prevent stored XSS via project names
- Rewrite reports test specs to match actual component APIs
- Fix guest 401 handler: show notification instead of silent failure
```
