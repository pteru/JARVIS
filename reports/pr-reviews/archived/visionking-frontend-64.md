# PR Review: visionking-frontend#64

**Title:** Fix/868hdwn07/layout fix
**Reviewed:** 2026-02-18T12:30:00-03:00
**Complexity:** complex

## Summary
This PR implements significant UI/UX improvements across multiple components: restructured sidenav with sub-menu support, in-place profile editing on the users page, redesigned FAQ page with master-detail layout, updated help dialog styling, and various layout adjustments for maintenance and settings pages. It also renames "Produtos Inspecionados" to "Relatórios" throughout the application and moves the FAQ route under the portal module.

## Findings

### Critical
None

### Warnings

1. **Authentication guard bypassed (known placeholder)** (`auth.guard.ts:24-26`) — The auth guard returns `true` for all routes. This is expected since user authentication is not yet implemented in the dashboard, but should be tracked and removed once the auth feature is built.

2. **Permission checks bypassed (known placeholder)** (`sidenav.component.ts:94-95`) — Role-based menu filtering is disabled; all menus visible to all users. Same as above — expected until auth is implemented.

3. **Password change validation incomplete** — Old password is captured but never validated; password change logic is commented out.

4. **Missing error handling in profile save** — No error callback in the `updateUser` subscription.

5. **Potential memory leak** — Language service subscription in sidenav is never unsubscribed.

6. **Typo in language option** — "Espanish" should be "Spanish".

### Suggestions

1. Duplicate password toggle icon code in `users.component.html` could be extracted to a shared component.
2. Consider using the async pipe for all observables to avoid manual subscription management.
3. Use CSS variables consistently instead of hardcoded colors.
4. Add form validation error messages for profile editing fields.

## Verdict
**APPROVE WITH COMMENTS**

The layout and UX improvements are solid — sidenav restructuring, profile editing, FAQ redesign, and the Relatórios rename all look good. The auth/permission bypasses are known placeholders pending the authentication feature implementation and are not regressions. The warnings above are non-blocking but should be addressed in follow-up work.
