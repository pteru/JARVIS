#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT_DIR } from './lib/config.mjs';

const date = new Date().toISOString().slice(0, 10);
for (const script of ['collect-sg3.mjs', 'collect-drive-contratos.mjs', 'collect-emails.mjs']) {
  spawnSync('node', [resolve(ROOT_DIR, 'scripts/sg3-monitor', script), date], { stdio: 'inherit' });
}
