import { test } from 'node:test'; import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
test('load_health_config exports resolved fields', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'hm-'));
  fs.mkdirSync(path.join(home,'config/health/vk'),{recursive:true});
  fs.copyFileSync('tests/health/fixtures/config-vk.json', path.join(home,'config/health/vk/03002.json'));
  const probe = `source scripts/health/lib/config.sh; load_health_config vk 03002; echo "$HEALTH_NAME|$DATA_DIR|$ALERT_COOLDOWN_MINUTES|${'${CONNECTIVITY_NODES[*]}'}"`;
  const out = execFileSync('bash',['-c',probe],{encoding:'utf8',env:{...process.env,ORCHESTRATOR_HOME:home}}).trim();
  assert.equal(out, `ArcelorMittal TL1 (03002)|${home}/data/vk-health/03002|60|vk01 vk02 vk03`);
});

test('ALERT_COOLDOWN_MINUTES defaults to 60 when absent from config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'hm-cooldown-'));
  fs.mkdirSync(path.join(home,'config/health/vk'),{recursive:true});
  const minimalConfig = {
    name: 'Test Deployment',
    data_root: 'data/vk-health',
    reports_root: 'reports/vk-health',
    assembler: 'scripts/health/assemblers/vk.py',
    connectivity: { label: 'test', nodes: ['node1'] },
    secrets: { ssh: '~/.secrets/ssh-pass', rabbit: '~/.secrets/rabbit-pass' },
  };
  fs.writeFileSync(
    path.join(home,'config/health/vk/03002.json'),
    JSON.stringify(minimalConfig),
  );
  const probe = `source scripts/health/lib/config.sh; load_health_config vk 03002; echo "$ALERT_COOLDOWN_MINUTES"`;
  const out = execFileSync('bash',['-c',probe],{encoding:'utf8',env:{...process.env,ORCHESTRATOR_HOME:home}}).trim();
  assert.equal(out, '60', 'ALERT_COOLDOWN_MINUTES should default to 60 when field is absent');
});
