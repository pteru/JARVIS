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
