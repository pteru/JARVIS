import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('evaluate_checks: disk ok/crit, gpu warn, unknown for missing field', () => {
  const snap = 'tests/health/fixtures/snapshot-vk.json';
  const cfg  = 'tests/health/fixtures/config-vk.json';
  const cmd  = `source scripts/health/lib/checks.sh; evaluate_checks '${snap}' '${cfg}'`;
  const raw  = execFileSync('bash', ['-c', cmd], { encoding: 'utf8' });

  // Parse TSV into objects: severity, label, metric_key, value, threshold
  const rows = raw.split('\n').filter(line => line.startsWith('ok\t') || line.startsWith('warn\t') || line.startsWith('crit\t') || line.startsWith('unknown\t')).map(line => {
    const [severity, label, metric_key, value, threshold] = line.split('\t');
    return { severity, label, metric_key, value, threshold };
  });

  // vk01 disk.root.pct = 89 → high 90/95 → ok
  const vk01disk = rows.find(r => r.metric_key === 'node.vk01.disk.root.pct');
  assert.ok(vk01disk, 'row for node.vk01.disk.root.pct must exist');
  assert.equal(vk01disk.severity, 'ok');
  assert.equal(vk01disk.label, 'Root disk');
  assert.equal(vk01disk.value, '89');

  // vk02 disk.root.pct = 95 → high 90/95 → crit (>=crit)
  const vk02disk = rows.find(r => r.metric_key === 'node.vk02.disk.root.pct');
  assert.ok(vk02disk, 'row for node.vk02.disk.root.pct must exist');
  assert.equal(vk02disk.severity, 'crit');
  assert.equal(vk02disk.label, 'Root disk');
  assert.equal(vk02disk.value, '95');

  // vk01 gpu.0.mem.pct = 91 → high 90/95 → warn (>=warn but <crit)
  const vk01gpu = rows.find(r => r.metric_key === 'node.vk01.gpu.0.mem.pct');
  assert.ok(vk01gpu, 'row for node.vk01.gpu.0.mem.pct must exist');
  assert.equal(vk01gpu.severity, 'warn');
  assert.equal(vk01gpu.label, 'GPU memory');
  assert.equal(vk01gpu.value, '91');

  // service.does_not_exist.up → no match → exactly one unknown line
  const unknowns = rows.filter(r => r.severity === 'unknown');
  assert.equal(unknowns.length, 1, 'exactly one unknown row');
  assert.equal(unknowns[0].label, 'Nonexistent');
  assert.equal(unknowns[0].metric_key, 'service.does_not_exist.up');
  assert.equal(unknowns[0].value, '', 'value must be empty string for unknown');
});
