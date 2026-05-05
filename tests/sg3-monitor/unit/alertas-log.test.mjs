import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertasLog } from '../../../scripts/sg3-monitor/lib/alertas-log.mjs';

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sg3-')); });

describe('AlertasLog', () => {
  it('records and detects duplicates', () => {
    const log = new AlertasLog(join(tmp, 'log.json'));
    const key = log.keyFor({ linhaId: 'aso-pedro-2026', diasRestantes: 7, dia: '2026-05-05' });
    assert.equal(log.has(key), false);
    log.record(key, { messageId: 'm1' });
    assert.equal(log.has(key), true);
  });

  it('persists across instances', () => {
    const path = join(tmp, 'log.json');
    const a = new AlertasLog(path);
    a.record(a.keyFor({ linhaId: 'x', diasRestantes: 0, dia: '2026-05-05' }), {});
    a.save();
    const b = new AlertasLog(path);
    assert.equal(b.has(b.keyFor({ linhaId: 'x', diasRestantes: 0, dia: '2026-05-05' })), true);
  });
});
