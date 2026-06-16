import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ORCHESTRATOR_HOME, getConfigPath } from '../../../mcp-servers/lib/config-loader.js';

describe('mcp-servers/lib/config-loader', () => {
  it('ORCHESTRATOR_HOME resolves to an absolute path', () => {
    assert.ok(path.isAbsolute(ORCHESTRATOR_HOME), `expected absolute path, got: ${ORCHESTRATOR_HOME}`);
  });

  it('getConfigPath resolves filenames under config/orchestrator/', () => {
    assert.equal(
      getConfigPath('models.json'),
      path.join(ORCHESTRATOR_HOME, 'config', 'orchestrator', 'models.json'),
    );
  });

  it('honors the ORCHESTRATOR_HOME env var on a fresh module load', async () => {
    const prev = process.env.ORCHESTRATOR_HOME;
    process.env.ORCHESTRATOR_HOME = '/tmp/jarvis-test-home';
    try {
      // append a query so the ESM loader re-evaluates the module with the new env
      const mod = await import('../../../mcp-servers/lib/config-loader.js?fresh=' + Date.now());
      assert.equal(mod.ORCHESTRATOR_HOME, '/tmp/jarvis-test-home');
      assert.equal(mod.getConfigPath('x.json'), '/tmp/jarvis-test-home/config/orchestrator/x.json');
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATOR_HOME;
      else process.env.ORCHESTRATOR_HOME = prev;
    }
  });
});
