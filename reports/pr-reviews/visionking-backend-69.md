# PR Review: visionking-backend#69
**Title:** Fix/868hdwn07/layout fix
**Reviewed:** 2026-02-20T16:24:35-03:00
**Complexity:** complex

## Summary
This PR refactors Docker infrastructure by renaming containers to follow a consistent naming convention (`dev-visionking-*` and `prod-visionking-*`), renames compose files for consistency, and adds defensive checks in the Redis service to handle connection failures gracefully. It also fixes a bug where Redis passwords with special characters would break URI parsing by adding `encodeURIComponent`.

## Findings

### Critical
- **Hardcoded enum values breaking production**: In `src/core/enums/data-replication-target.enum.ts`, the enum values `REDIS_VK01` and `REDIS_VK02` have been changed from `'redis-vk01'` / `'redis-vk02'` to `'dev-visionking-redis-01'` / `'dev-visionking-redis-02'`. These enum values are likely used in database records, API responses, or configuration. Changing enum string values is a breaking change that will cause mismatches with any existing persisted data or external consumers expecting the old values. The enum *names* should remain the same (`REDIS_VK01`) and container hostnames should be injected via environment variables, not hardcoded in enums.

- **Production .env pointing to dev containers**: In `infra/docker/production/backend/.local.env`, all database and Redis hostnames have been changed from production IP addresses (e.g., `192.168.15.2`) to Docker dev container names (e.g., `dev-visionking-postgres-01`). This will break production deployments as the containers won't resolve these hostnames. The "production" directory should contain production values, not dev overrides.

- **Production deploy compose using dev hostnames**: In `infra/docker/production/deploy-visionking-backend.yml`, all `DB_HOST_*` and `REDIS_IP_*` values point to `dev-visionking-*` container names. This deploy file will fail in actual production environments where those containers don't exist.

### Warnings
- **Missing `encodeURIComponent` for username**: In `redis.service.ts:142`, only the password is URI-encoded (`encodeURIComponent(process.env.REDIS_PASSWORD)`), but the username is not. If the username contains special characters, the connection string will be malformed. Apply the same encoding to `user`.

- **Potential null pointer after encoding**: The `encodeURIComponent(process.env.REDIS_PASSWORD)` call will throw if `REDIS_PASSWORD` is undefined. Consider adding null checking: `encodeURIComponent(process.env.REDIS_PASSWORD ?? '')`.

- **Redundant `setRedisIp` calls**: In `system-settings.service.ts`, `setRedisIp(ConnectionNames.POINT_ONE)` is now called in multiple places (lines 46, 163, 209). If `setRedisIp` is idempotent, this is just inefficient. If it has side effects (reconnecting), this could cause connection churn. Consider calling it once during service initialization.

### Suggestions
- **Network changed to external without setup docs**: The `deploy-visionking-backend.yml` changes the network from a locally created bridge (`visionking-network-prod`) to an external network (`visionking: external: true`). This requires the network to pre-exist before deployment. Add a comment or documentation on how to create this network.

- **Consider environment-specific .env files**: Rather than editing the "production" .env file to contain dev values, maintain separate files like `.local.env.dev` and `.local.env.prod`, or use environment variable substitution at deploy time.

- **Add test coverage for Redis connection edge cases**: The new defensive code in `redis.service.ts` (resetting `this.client` to undefined, checking initialization before select) is good but should have unit tests covering the connection failure and recovery scenarios.

## Verdict
CHANGES REQUESTED

The PR has fundamental issues with production configuration files being overwritten with development values, and enum string values being changed which will break any existing data using those values. The Redis service improvements are good, but the infrastructure changes will break production deployments.
