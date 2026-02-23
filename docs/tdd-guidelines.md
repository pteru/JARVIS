# TDD Guidelines for JARVIS Workspaces

## 1. Purpose

Tests are **executable specifications** for autonomous agents.

When a backlog task includes tests, Claude Code agents (sandbox, dispatcher) have an unambiguous
completion signal: the test runner exits 0, or it doesn't. Without tests, "done" is a judgment call —
the agent reports success, the reviewer hopes it's true. With tests, verification is mechanical.

These guidelines standardize how tests are written, organized, and integrated with the JARVIS
orchestration workflow across all Strokmatic workspaces.

---

## 2. Core Principles

1. **Test-first for new behavior.** Write the failing test before the implementation. The test
   defines what "done" means — the agent stops when it passes.

2. **Test-after for bug fixes.** Reproduce the bug with a test that fails on the current code,
   then fix the code until the test passes. This prevents regressions.

3. **No regressions.** Every test that passes today must still pass tomorrow. A "fix" that breaks
   existing tests is not a fix.

4. **Simplest failing test.** Start with the smallest assertion that captures the behavior. Expand
   coverage after the happy path works.

5. **Tests are first-class code.** Apply the same code quality standards (naming, structure,
   readability) to test files as to production code. No "temporary" test hacks.

6. **Coverage is diagnostic, not a goal.** Use coverage reports to find untested paths, not as a
   KPI to game. 80% coverage with meaningful assertions beats 100% coverage with trivial ones.

---

## 3. Decision Matrix

| Scenario | Approach | Rationale |
|---|---|---|
| New feature | **Test-first** | Test defines the acceptance criteria |
| Bug fix | **Test-after** (reproduce first) | Regression test proves the fix works |
| Refactor | **Test-before** (ensure existing coverage) | Tests guard against behavioral changes |
| Config change | **Skip** | YAML/JSON validation is sufficient |
| Documentation | **Skip** | No runtime behavior to verify |
| One-off script | **Skip** (unless reusable) | Cost exceeds benefit for throwaway code |
| Legacy code (no tests) | **Test-after** (add tests incrementally) | Cover the code you touch, not everything |

**Rule of thumb:** If the dispatcher's `verify_task_completion` will check test results, you need tests.
If the change is purely declarative (config, docs, markdown), you don't.

---

## 4. Per-Language Conventions

### 4.1 Python — pytest

**Framework:** `pytest` with `conftest.py` for shared fixtures.

**Reference:** `workspaces/strokmatic/sdk/sdk-inspection-grouping-optimizer/tests/`

```
project/
  src/
    module.py
  tests/
    __init__.py
    conftest.py          # Shared fixtures (sample data, temp dirs, mock clients)
    test_module.py       # Tests mirror src/ structure
    fixtures/            # Static test data (JSON, CSV, images)
```

**Conventions:**
- Test files: `test_<module>.py` (pytest auto-discovery)
- Test functions: `test_<behavior>()` — describe what is tested, not how
- Fixtures in `conftest.py`, not repeated per file
- Use `tmp_path` (built-in) for temp files, never hardcode paths
- Mark slow tests: `@pytest.mark.slow` — exclude from fast CI runs
- Run: `python -m pytest tests/ -v`

**Example pattern:**
```python
# tests/conftest.py
import pytest

@pytest.fixture
def sample_input():
    return {"parts": [{"id": "A1", "x": 0, "y": 0}, {"id": "A2", "x": 10, "y": 5}]}

# tests/test_optimizer.py
def test_optimizer_groups_nearby_parts(sample_input):
    result = optimize(sample_input)
    assert len(result.groups) == 1
    assert {"A1", "A2"} == {p.id for p in result.groups[0].parts}

def test_optimizer_rejects_empty_input():
    with pytest.raises(ValueError, match="at least one part"):
        optimize({"parts": []})
```

### 4.2 Node.js (new projects) — node:test

**Framework:** `node:test` (built-in) + `node:assert/strict`. No external dependencies.

**Reference:** `mcp-servers/meeting-assistant/test/`

```
project/
  src/
    module.ts
  test/
    module.test.ts       # Tests alongside or in test/ dir
```

**Conventions:**
- Test files: `<module>.test.ts`
- Use `describe()` / `it()` from `node:test`
- Use `assert` from `node:assert/strict` (throws on failure, no chaijs needed)
- Use `mock` from `node:test` for mocking — no sinon/jest mocks
- Run: `node --test --import tsx test/*.test.ts` (for TypeScript)

**Example pattern:**
```typescript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptAccumulator } from '../src/transcript.js';

describe('TranscriptAccumulator', () => {
  it('appends lines with timestamps', () => {
    const acc = new TranscriptAccumulator();
    acc.add('Hello', 'Speaker A');
    assert.equal(acc.lines.length, 1);
    assert.equal(acc.lines[0].speaker, 'Speaker A');
  });

  it('returns empty array when no lines added', () => {
    const acc = new TranscriptAccumulator();
    assert.deepEqual(acc.lines, []);
  });
});
```

### 4.3 NestJS (existing backends) — Jest

**Framework:** Jest + `@nestjs/testing` (TestingModule, providers, mocks).

**Reference:** `workspaces/strokmatic/diemaster/services/backend/src/`

```
src/
  modules/
    auth/
      auth.service.ts
      auth.service.spec.ts      # Co-located with source
      controllers/
        auth.controller.ts
        auth.controller.spec.ts
  core/
    parsing/
      __tests__/
        parsing.boolean.spec.ts  # Or in __tests__/ subdirectory
```

**Conventions:**
- Test files: `<module>.spec.ts` — co-located with the source file
- Use `Test.createTestingModule()` to build isolated DI containers
- Mock external services (database, Redis, RabbitMQ) at the provider level
- Run: `npm test` or `npx jest --config jest.config.ts`

**Example pattern:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: { findByEmail: jest.fn() } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('should reject invalid credentials', async () => {
    await expect(service.validate('bad@email.com', 'wrong'))
      .rejects.toThrow('Invalid credentials');
  });
});
```

### 4.4 Angular (existing frontends) — Jasmine/Karma

**Framework:** Jasmine + `@angular/core/testing` (TestBed, ComponentFixture).

**Reference:** `workspaces/strokmatic/spotfusion/services/frontend/src/app/`

**Conventions:**
- Test files: `<component>.spec.ts` — co-located with component
- Focus testing on **services and pipes**, not template DOM queries
- Use `TestBed.configureTestingModule()` with minimal declarations
- Mock HTTP calls with `HttpClientTestingModule`
- Run: `ng test` or `npx karma start`

**Guidance:** Angular template tests are brittle and slow. Prefer testing service logic and
data transformations. Only write component tests when the component contains meaningful logic
(not just template bindings).

---

## 5. Integration with JARVIS Workflow

### 5.1 Backlog Task Format

When creating backlog tasks that require tests, include explicit test criteria. The dispatcher
already parses keywords like `test`, `pytest`, `jest` and file paths in task descriptions.

**Good task description:**
```
Add retry logic to RabbitMQ publisher with exponential backoff.
Test: pytest tests/test_publisher.py — verify retry count, backoff timing, max retries exceeded.
Acceptance: all tests pass, no regressions in existing test suite.
```

**Bad task description:**
```
Fix RabbitMQ publisher.
```

### 5.2 Dispatcher Verification

The `verify_task_completion` MCP tool checks whether dispatched tasks meet completion criteria.
When a task specifies test files or test commands, the dispatcher runs them and checks exit codes.

To leverage this:
1. Include a `Test:` line in the backlog task description
2. Specify the exact command (e.g., `python -m pytest tests/ -v`)
3. The dispatcher will run the command post-implementation and report pass/fail

### 5.3 Sandbox TDD Loop

When dispatching to the sandbox environment (`scripts/sandbox.sh`), the agent follows this loop:

1. **Read** the spec file and existing tests
2. **Write** a failing test that captures the required behavior
3. **Implement** the minimum code to make the test pass
4. **Run** the full test suite (`pytest` / `npm test`)
5. **Refactor** if the suite is green
6. **Repeat** until all acceptance criteria are met

The sandbox entrypoint should detect test runners automatically:
- `pytest.ini` or `pyproject.toml` with `[tool.pytest]` → `python -m pytest`
- `package.json` with `scripts.test` → `npm test`
- `jest.config.*` → `npx jest`

---

## 6. Test Categories

### Unit Tests
- Test a single function or class in isolation
- Mock all external dependencies (DB, HTTP, filesystem, message queues)
- Fast: entire suite runs in seconds
- **When:** Every new function with logic (branching, calculations, transformations)

### Integration Tests
- Test multiple components working together
- Use real (or containerized) external services where practical
- Slower: may require Docker containers or test databases
- **When:** API endpoints, database queries, message queue consumers

### Contract Tests
- Verify message schemas between services (e.g., RabbitMQ message formats)
- Ensure producer and consumer agree on the shape of data
- **When:** Any inter-service communication (SpotFusion ↔ backend, VisionKing ↔ RabbitMQ)

### Smoke Tests
- Verify the application starts and responds to basic health checks
- Minimal assertions: HTTP 200 on `/health`, process exits cleanly
- **When:** After deployment or Docker image build

---

## 7. What NOT to Test

- **docker-compose files** — Validate structure with `docker-compose config`, don't unit test
- **Environment variable loading** — Trust the framework (dotenv, NestJS ConfigModule)
- **Third-party library internals** — Test your usage of the library, not the library itself
- **CSS/styling** — Visual regression testing is a separate discipline; don't assert class names
- **Generated code** — If code is auto-generated (protobuf, OpenAPI), test the generator config
- **Trivial getters/setters** — If it has no logic, it doesn't need a test
- **Private methods** — Test the public API that calls them; refactor if the private method is complex enough to need its own tests

---

## 8. Coverage Expectations

Target ranges per workspace type. These are guidelines, not enforcement gates.

| Workspace Type | Target Range | Rationale |
|---|---|---|
| SDK libraries | 70–85% | High reuse, stable APIs, few side effects |
| Backend services (NestJS) | 50–70% | Business logic + API endpoints; skip DI wiring |
| Frontend apps (Angular) | 30–50% | Focus on services/pipes; templates are brittle |
| MCP servers | 60–80% | Tool handlers are pure logic; test the handlers |
| Scripts/automation | 20–40% | Test core logic functions; skip CLI glue |
| Legacy (no existing tests) | 0→20% | Cover only the code you modify; grow over time |

**How to measure:**
- Python: `python -m pytest --cov=src --cov-report=term-missing`
- Node.js: `c8 node --test test/*.test.ts` (c8 for V8 native coverage)
- Jest: `npx jest --coverage`

---

## 9. Quick Reference Card

```
+----------------------------------------------------+
|  JARVIS TDD Quick Reference                        |
+----------------------------------------------------+
|                                                    |
|  NEW FEATURE?  → Write test first, then implement  |
|  BUG FIX?      → Reproduce with test, then fix     |
|  REFACTOR?     → Ensure tests exist, then change   |
|  CONFIG/DOCS?  → No tests needed                   |
|                                                    |
|  PYTHON:   pytest + conftest.py + fixtures/        |
|            python -m pytest tests/ -v              |
|                                                    |
|  NODE.JS:  node:test + node:assert/strict          |
|            node --test test/*.test.ts              |
|                                                    |
|  NESTJS:   Jest + @nestjs/testing                  |
|            npm test                                |
|                                                    |
|  ANGULAR:  Jasmine + TestBed (services > templates)|
|            ng test                                 |
|                                                    |
|  BACKLOG:  Include "Test: <command>" in task desc  |
|  SANDBOX:  Read spec → write test → implement →    |
|            run suite → refactor → repeat           |
|                                                    |
|  COVERAGE: SDK 70-85% | Backend 50-70%            |
|            Frontend 30-50% | Scripts 20-40%        |
+----------------------------------------------------+
```

---

## Future Work (not implemented here)

These items are tracked in the orchestrator backlog for future implementation:

- **Sandbox entrypoint enhancement:** Auto-detect test runner from project config and run
  the full suite after each implementation step
- **Dispatcher `test_criteria` field:** Structured test command + expected results in dispatch
  payload, replacing free-text parsing
- **Coverage trend tracking:** Store coverage percentages per workspace in `data/coverage/`
  and surface them in the PMO dashboard
