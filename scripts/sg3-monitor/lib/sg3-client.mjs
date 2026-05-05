import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';
import { makeLogger } from './logger.mjs';

const log = makeLogger('sg3-client');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export async function withSg3Session(clientConfig, credentialsKey, work) {
  const cfg = clientConfig.playwright;
  const sessionPath = resolve(expandHome(cfg.auth_session_dir), `${credentialsKey}-storage-state.json`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.SG3_HEADLESS !== '0',
  });

  const context = await browser.newContext({
    storageState: existsSync(sessionPath) ? sessionPath : undefined,
  });

  try {
    const page = await context.newPage();

    const result = await tryOrLogin(page, cfg, credentialsKey, async () => work(page));

    await context.storageState({ path: sessionPath });
    return result;
  } finally {
    await browser.close();
  }
}

async function tryOrLogin(page, cfg, credentialsKey, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!/login|auth|unauth|redirect/i.test(err.message)) throw err;
    log.warn('first attempt failed; trying login flow', { err: err.message, credentialsKey });
    await login(page, cfg, credentialsKey);
    return await fn();
  }
}

async function login(page, cfg, credentialsKey) {
  const credsPath = expandHome(cfg.credentials_secret_path);
  if (!existsSync(credsPath)) {
    throw new Error(`credentials file not found at ${credsPath}; cannot auto-login`);
  }
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))[credentialsKey];
  if (!creds) throw new Error(`credentials missing key ${credentialsKey}`);

  await page.goto(cfg.login_url);
  await page.fill(cfg.selectors.login_user, creds.username);
  await page.fill(cfg.selectors.login_pass, creds.password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click(cfg.selectors.login_submit),
  ]);

  // detect MFA placeholder
  if (await page.locator('input[name=mfa]').count() > 0) {
    throw new Error('MFA required — re-run with SG3_HEADLESS=0 and complete the challenge manually');
  }
}

export async function scrapeCadastros(page, urlOrSelector) {
  // Placeholder: real selectors come from spike (Task 23).
  // Returns { cadastros_sg3: [], colaboradores: [], plantas: [], pessoas_gm: [] }
  log.warn('scrapeCadastros: not yet configured — bootstrap spike must populate selectors');
  return { cadastros_sg3: [], colaboradores: [], plantas: [], pessoas_gm: [] };
}

export async function scrapeAlocacoes(page, urlOrSelector) {
  log.warn('scrapeAlocacoes: not yet configured');
  return { alocacoes: [] };
}
