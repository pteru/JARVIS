import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Fixture config — mirrors tests/health/fixtures/config-vk.json structure
// ---------------------------------------------------------------------------
const VK_CONFIG = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/config-vk.json', import.meta.url),
    'utf8',
  ),
);

// ---------------------------------------------------------------------------
// makeHome — hermetic ORCHESTRATOR_HOME with VK config + report dir
// ---------------------------------------------------------------------------
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-'));
  const cfgDir = path.join(home, 'config/health/vk');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, '03002.json'), JSON.stringify(VK_CONFIG, null, 2));

  const reportDir = path.join(home, 'reports/vk-health/03002');
  fs.mkdirSync(reportDir, { recursive: true });

  return { home, reportDir };
}

// ---------------------------------------------------------------------------
// runCleanup — executes the script under test
// ---------------------------------------------------------------------------
function runCleanup(home) {
  return spawnSync(
    'bash',
    ['scripts/health/core/cleanup-reports.sh', 'vk', '03002'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ORCHESTRATOR_HOME: home,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Case 1 — gate closed: no consolidation-state.json
// ALL files must be preserved (script must be fully inert)
// ---------------------------------------------------------------------------
test('cleanup is fully inert when consolidation-state.json is absent', () => {
  const { home, reportDir } = makeHome();

  // Seed old files using a future timestamp trick — set mtime 10 years in the past
  const oldConsolidated = path.join(reportDir, 'consolidated-2020-01-01.md');
  const oldAnalysis    = path.join(reportDir, 'analysis-2020-01-01_00-00-00.md');
  const oldMonthly     = path.join(reportDir, 'monthly-2020-01.md');

  fs.writeFileSync(oldConsolidated, '# old consolidated\n');
  fs.writeFileSync(oldAnalysis,     '# old analysis\n');
  fs.writeFileSync(oldMonthly,      '# old monthly\n');

  // Touch mtime to 2020-01-01 (well outside any retention window)
  const oldDate = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(oldConsolidated, oldDate, oldDate);
  fs.utimesSync(oldAnalysis,     oldDate, oldDate);
  fs.utimesSync(oldMonthly,      oldDate, oldDate);

  try {
    const result = runCleanup(home);
    assert.equal(
      result.status,
      0,
      `script must exit 0 (early exit), got ${result.status}\nstderr: ${result.stderr}`,
    );

    assert.ok(
      fs.existsSync(oldConsolidated),
      `consolidated-2020-01-01.md must NOT be deleted when gate is closed`,
    );
    assert.ok(
      fs.existsSync(oldAnalysis),
      `analysis-2020-01-01_00-00-00.md must NOT be deleted when gate is closed`,
    );
    assert.ok(
      fs.existsSync(oldMonthly),
      `monthly-2020-01.md must NOT be deleted when gate is closed`,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Case 2 — gate open: consolidation-state.json present with last_consolidated
// Old consolidated-*.md (>30d) MUST be deleted; monthly-*.md must be preserved
// ---------------------------------------------------------------------------
test('cleanup deletes old consolidated report but preserves monthly when gate is open', () => {
  const { home, reportDir } = makeHome();

  // Write consolidation state
  const stateFile = path.join(reportDir, 'consolidation-state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ last_consolidated: '2026-06-17T00:00:00Z' }, null, 2),
  );

  const oldConsolidated = path.join(reportDir, 'consolidated-2020-01-01.md');
  const oldMonthly      = path.join(reportDir, 'monthly-2020-01.md');

  fs.writeFileSync(oldConsolidated, '# old consolidated\n');
  fs.writeFileSync(oldMonthly,      '# old monthly\n');

  // Set mtime to 2020-01-01 — definitely older than 30 days
  const oldDate = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(oldConsolidated, oldDate, oldDate);
  fs.utimesSync(oldMonthly,      oldDate, oldDate);

  try {
    const result = runCleanup(home);
    assert.equal(
      result.status,
      0,
      `script must exit 0, got ${result.status}\nstderr: ${result.stderr}`,
    );

    assert.ok(
      !fs.existsSync(oldConsolidated),
      `consolidated-2020-01-01.md MUST be deleted (older than consolidated_retention_days=30)`,
    );
    assert.ok(
      fs.existsSync(oldMonthly),
      `monthly-2020-01.md must NOT be deleted (permanent retention)`,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
