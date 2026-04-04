# DieMaster Backend — PR #25 Review Remediation

## Context

PR #25 (`fix/868hrfz4m/production-screen`) was merged to `develop` on diemaster-back-end.
A post-merge review identified 3 remaining issues that must be fixed.

The frontend counterpart PR was also merged. The frontend no longer sends JWT tokens for guest users — it sets `guestMode=true` in sessionStorage and sends requests without an Authorization header. The backend must match this by keeping production endpoints open (no JWT guard).

## Workspace

- Repo: `strokmatic/diemaster-back-end`
- Path: `workspaces/strokmatic/diemaster/services/backend`
- Base branch: `develop`
- Fix branch: `fix/pr25-review-remediation`
- Stack: NestJS, TypeScript, Sequelize, PostgreSQL

## Files to Read First

- `src/modules/production/controllers/production.controller.ts` — has the JWT guard to remove
- `src/modules/production/services/production.service.ts` — has onModuleInit and debugDatabaseTables

## Fixes

### Fix 1: Remove JWT guard from ProductionController [CRITICAL]

**File**: `src/modules/production/controllers/production.controller.ts`

Remove `@UseGuards(AuthGuard('jwt'))` decorator from the class level. Also remove `@ApiSecurity('bearer')` since the endpoints are now public. Remove the unused imports (`UseGuards` from `@nestjs/common`, `AuthGuard` from `@nestjs/passport`, `ApiSecurity` from `@nestjs/swagger`).

**Why**: Production endpoints serve the public guest-only dashboard. The frontend sends no Authorization header for guests. With the guard present, all production API calls return 401 and the dashboard shows no data.

**Before**:
```typescript
import { Controller, Get, Logger, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
// ...
@ApiTags('Production')
@ApiSecurity('bearer')
@UseGuards(AuthGuard('jwt'))
@Controller('production')
export class ProductionController {
```

**After**:
```typescript
import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
// ...
@ApiTags('Production')
@Controller('production')
export class ProductionController {
```

### Fix 2: Revert onModuleInit to fire-and-forget [HIGH]

**File**: `src/modules/production/services/production.service.ts`

Change `onModuleInit` from blocking `await` to fire-and-forget with `.catch()`. Index creation is an optimization, not a startup requirement. If it fails (permissions, connectivity), the app should still start.

**Before**:
```typescript
async onModuleInit() {
    await this.createAcquisitionIndexes();
}
```

**After**:
```typescript
async onModuleInit() {
    this.createAcquisitionIndexes().catch((e) =>
        this.logger.warn('Index creation skipped:', e.message),
    );
}
```

### Fix 3: Remove debugDatabaseTables method [HIGH]

**File**: `src/modules/production/services/production.service.ts`

Delete the entire `debugDatabaseTables()` method (lines 742-780). It dumps all table names, sensor rows (`SELECT *`), and counts. Debug utility that should not exist in production code.

Search the entire codebase for any references to `debugDatabaseTables` before deleting — if a controller route calls it, remove that route too.

## Commit

Single commit with message:
```
fix(production): remove JWT guard, fix onModuleInit, remove debug method

- Remove @UseGuards(AuthGuard('jwt')) from ProductionController
  (production endpoints are public for guest-only dashboard)
- Revert onModuleInit to fire-and-forget pattern
  (index creation failure should not crash app startup)
- Remove debugDatabaseTables() debug utility
```
