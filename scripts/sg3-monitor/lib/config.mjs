import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SG3_HOME ?? resolve(__dirname, '../../..');

export function loadConfig() {
  const path = resolve(ROOT, 'config/sg3-monitor/config.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function loadEmailRules() {
  const path = resolve(ROOT, 'config/sg3-monitor/email-rules.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function loadClientConfig(clientId) {
  const path = resolve(ROOT, `config/sg3-monitor/clients/${clientId}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function dataDir(date) {
  return resolve(ROOT, 'data/sg3-monitor', date);
}

export const ROOT_DIR = ROOT;
