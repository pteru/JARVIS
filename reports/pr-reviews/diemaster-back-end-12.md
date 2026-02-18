I've completed the PR review. Here's the review for PR #12:

---

# PR Review: diemaster-back-end#12
**Title:** Feat/868fvx1qw/configurar triggers  
**Reviewed:** 2026-02-18T10:27:03-03:00  
**Complexity:** complex

## Summary
This is a large architectural refactoring PR that restructures the project from `infra/` to `tooling/`, adds PostgreSQL database integration with Sequelize ORM, implements authentication infrastructure (JWT/Passport), and adds comprehensive production monitoring endpoints with sensor and panel management. The PR also migrates from yarn to npm and adds significant infrastructure for error handling, pagination, and API response standardization.

## Findings

### Critical
1. **Database password exposed in logs** (`src/modules/database/postgresql/shared/modules.ts:93`): The `buildSequelizeModule` function logs the entire `coercedConfig` object including database credentials.

2. **Missing input validation on path parameters** (`src/modules/production/controllers/production.controller.ts`): The `panelId` parameter is typed as `number` but received as string from URL params without proper transformation.

3. **Auth test files have empty test implementations**: Tests only check if controllers/services are defined but don't test actual functionality.

### Warnings
1. **Hardcoded mock data in production controller** (`production.controller.clean.ts`)
2. **Missing error type in catch blocks** - uses `error.message` without type checking
3. **Typo in variable name** (`src/core/filters/exceptions.filter.ts`): `mesage` instead of `message`
4. **`synchronize: true` in Sequelize config** - dangerous in production
5. **Random password generation is weak** - uses `Math.random()` instead of `crypto.randomBytes()`
6. **databaseErrors exposed in response** - should be dev-only
7. **Missing session secret configuration**

### Suggestions
1. Consolidate production controller files
2. CI workflow still references yarn (should use npm)
3. Add rate limiting to auth endpoints
4. Add validation for date filters
5. Remove commented code

## Verdict
**CHANGES REQUESTED**

Critical security issues must be addressed before merging:
1. Database credentials logged in plaintext
2. Weak password generation for reset functionality
3. Missing authentication tests
4. CI workflow references yarn while project migrated to npm

---

To save this review to the specified location, please run:
```bash
mkdir -p /home/teruel/JARVIS/reports/pr-reviews && cat > /home/teruel/JARVIS/reports/pr-reviews/diemaster-back-end-12.md << 'EOF'
# PR Review: diemaster-back-end#12
... (paste full content above)
EOF
```
