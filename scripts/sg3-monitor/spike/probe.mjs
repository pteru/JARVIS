#!/usr/bin/env node
// SG3 spike probe — temporary exploration script (Task 23).
// Will be deleted once selectors are populated in clients/gm.json and lib/sg3-client.mjs.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const command = process.argv[2] ?? 'inspect-login';
const arg = process.argv[3];
const credentialKey = (command === 'login' || command === 'gm') ? (arg ?? 'gm-lume') : 'gm-lume';
const targetUrl = command === 'inspect-page' ? arg : null;

const LOGIN_URL = 'https://sg3.executiva.adm.br/index.php?r=site/newlogin';
const SECRETS = JSON.parse(readFileSync(resolve(homedir(), '.secrets/sg3-credentials.json'), 'utf-8'));
const STORAGE_DIR = resolve('/home/teruel/JARVIS/data/sg3-monitor/auth');
const SPIKE_OUT = resolve('/home/teruel/JARVIS/data/sg3-monitor/spike');
mkdirSync(STORAGE_DIR, { recursive: true });
mkdirSync(SPIKE_OUT, { recursive: true });

function storagePath(key) { return resolve(STORAGE_DIR, `${key}-storage-state.json`); }

// Selectors of overlays/popups known in the SG3 portal.
const POPUP_OVERLAY_SELECTORS = [
  '#banner_propaganda',
  '#banner_versao',
  '.fundo-banner-propaganda',
  '.fundo-banner-versao',
  '.popup_box_propaganda',
  '.popup_box_versao',
  '.texto-title-rnote',
  '.modal-backdrop',
  '.modal.in',
  '.modal.show',
  '[id*=psicossocial]',
  '[id*=risco]',
  '[class*=banner]',
  '[class*=popup]',
];
const POPUP_CLOSE_SELECTORS = [
  '#banner_propaganda button[type=submit]',
  '#banner_propaganda button.close',
  '#banner_propaganda .close',
  '#banner_versao button[type=submit]',
  '#banner_versao button.close',
  '#banner_versao .close',
  '#btn-alterar-senha-depois',
  '.modal.in .close',
  '.modal.show .close',
  '.modal [data-dismiss=modal]',
  'button[aria-label=Close]',
];

// Generic heuristic: any fixed-position overlay with z-index ≥ 1000 and a name suggesting popup/banner/modal/aviso/risco/psico is removed.
async function nukeGenericOverlays(page) {
  await page.evaluate(() => {
    const PATTERN = /banner|popup|modal|alert|notif|aviso|risco|psico|propaganda|versao/i;
    document.querySelectorAll('div, section, aside').forEach(el => {
      try {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
        const z = parseInt(cs.zIndex) || 0;
        if (z < 100) return;
        const sig = (el.id + ' ' + (el.className?.toString?.() ?? '') + ' ' + (el.getAttribute?.('class') ?? '')).slice(0, 200);
        if (!PATTERN.test(sig)) return;
        if (el.offsetParent === null && cs.display === 'none') return;
        el.remove();
      } catch {}
    });
  }).catch(() => {});
}

async function dismissPopups(page) {
  // First: try clicking all known close buttons
  for (const sel of POPUP_CLOSE_SELECTORS) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 1500, force: true }).catch(() => {});
          await page.waitForTimeout(150);
        }
      }
    } catch {}
  }
  // Then: hide explicit overlays via DOM
  await page.evaluate((overlays) => {
    for (const sel of overlays) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    }
  }, POPUP_OVERLAY_SELECTORS).catch(() => {});
  // Finally: heuristic nuke of any matching generic overlays
  await nukeGenericOverlays(page);
  await page.waitForTimeout(150);
}

async function dumpPopups(page) {
  const els = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('div, section, aside').forEach(el => {
      try {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
        const z = parseInt(cs.zIndex) || 0;
        if (z < 100) return;
        if (el.offsetParent === null && cs.display === 'none') return;
        out.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: el.className?.toString?.().slice(0, 200) ?? '',
          zIndex: z,
          rect: el.getBoundingClientRect ? (() => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, t: r.top, l: r.left }; })() : null,
          text: (el.innerText || '').slice(0, 200),
          html: el.outerHTML.slice(0, 400),
        });
      } catch {}
    });
    return out;
  });
  return els;
}

async function inspectLogin() {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  console.log(`[spike] Navigating to ${LOGIN_URL}`);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);

  const inputs = await page.$$eval('input', els => els.map(e => ({
    name: e.name, id: e.id, type: e.type, placeholder: e.placeholder, required: e.required, visible: !!e.offsetParent,
  })));
  const buttons = await page.$$eval('button, input[type=submit]', els => els.map(e => ({
    tag: e.tagName.toLowerCase(), type: e.type, name: e.name, id: e.id, text: (e.innerText || e.value || '').slice(0, 60),
  })));
  const forms = await page.$$eval('form', els => els.map(e => ({
    id: e.id, name: e.name, action: e.action, method: e.method,
  })));

  const summary = { url: page.url(), title: await page.title(), forms, inputs, buttons };
  console.log('[spike] Login page structure:');
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync(resolve(SPIKE_OUT, 'login-page.json'), JSON.stringify(summary, null, 2));
  console.log('[spike] Browser stays open 60s.');
  await page.waitForTimeout(60_000);
  await browser.close();
}

async function attemptLogin() {
  const creds = SECRETS[credentialKey];
  if (!creds) { console.error(`No credentials for key ${credentialKey}`); process.exit(1); }
  console.log(`[spike] Login as ${creds.username} (key=${credentialKey})`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ storageState: undefined, viewport: null });
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  await dismissPopups(page);
  await page.fill('#loginform-username', creds.username);
  await page.fill('#loginform-password', creds.password);
  await dismissPopups(page);

  console.log('[spike] Clicking #submit-btn...');
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
    page.click('#submit-btn', { force: true }),
  ]);
  await page.waitForTimeout(2000);
  await dismissPopups(page);
  await page.waitForTimeout(1500);
  await dismissPopups(page);

  const postUrl = page.url();
  const postTitle = await page.title();
  console.log(`[spike] After submit: url=${postUrl} title=${postTitle}`);

  const links = await page.$$eval('a', els => els.slice(0, 200).map(e => ({
    href: e.href, text: (e.innerText || e.textContent || '').trim().slice(0, 80),
  })).filter(l => l.text && l.href && !l.href.startsWith('javascript:')));

  const summary = { url: postUrl, title: postTitle, links };
  writeFileSync(resolve(SPIKE_OUT, `post-login-${credentialKey}.json`), JSON.stringify(summary, null, 2));
  console.log(`[spike] ${links.length} links captured. First 20:`);
  for (const l of links.slice(0, 20)) console.log(`  ${l.text} → ${l.href}`);

  await context.storageState({ path: storagePath(credentialKey) });
  console.log(`[spike] Storage saved.`);
  console.log('[spike] Browser stays open 120s for manual exploration.');
  await page.waitForTimeout(120_000);
  await browser.close();
}

async function enterGm() {
  const creds = SECRETS[credentialKey];
  console.log(`[spike] Entering GM portal as ${creds.username} (key=${credentialKey})`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ storageState: storagePath(credentialKey), viewport: null });
  const page = await context.newPage();

  // Navigate via the master portal first to ensure fresh session
  await page.goto('https://sg3.executiva.adm.br/index.php');
  await page.waitForLoadState('networkidle');
  await dismissPopups(page);
  await page.waitForTimeout(500);
  await dismissPopups(page);

  // Click GM link
  const gmLink = await page.$('a[href*="/gm/index.php"][href*="site/login"]');
  if (!gmLink) {
    // try by visible text
    const altLink = await page.$('a:has-text("GM - GENERAL MOTORS")');
    if (!altLink) {
      console.error('[spike] GM portal link not found. Available links:');
      const links = await page.$$eval('a', els => els.slice(0, 50).map(e => ({ href: e.href, text: e.innerText.trim().slice(0,40) })));
      console.log(JSON.stringify(links, null, 2));
      await page.waitForTimeout(60_000);
      await browser.close();
      return;
    }
    await altLink.click();
  } else {
    await gmLink.click();
  }

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissPopups(page);
  await page.waitForTimeout(1000);
  await dismissPopups(page);

  const postUrl = page.url();
  const postTitle = await page.title();
  console.log(`[spike] In GM portal: url=${postUrl} title=${postTitle}`);

  // Capture nav links and any side-menu items
  const links = await page.$$eval('a', els => els.slice(0, 400).map(e => ({
    href: e.href, text: (e.innerText || e.textContent || '').trim().slice(0, 100),
  })).filter(l => l.text && l.href && !l.href.startsWith('javascript:')));

  // Try to find menu items (common Yii2/AdminLTE structure)
  const menuItems = await page.$$eval('aside a, nav a, .sidebar-menu a, .main-sidebar a, ul.nav a', els => els.map(e => ({
    href: e.href, text: (e.innerText || '').trim().slice(0, 100),
  })).filter(l => l.text)).catch(() => []);

  const summary = { url: postUrl, title: postTitle, links, menuItems };
  writeFileSync(resolve(SPIKE_OUT, `gm-home-${credentialKey}.json`), JSON.stringify(summary, null, 2));
  console.log(`[spike] ${links.length} links, ${menuItems.length} menu items.`);
  console.log('[spike] Menu items (first 40):');
  for (const m of menuItems.slice(0, 40)) console.log(`  ${m.text.padEnd(50)} → ${m.href}`);

  await context.storageState({ path: storagePath(credentialKey) });
  console.log('[spike] Browser stays open 240s — navigate to relevant screens (cadastros/alocações) and report URLs back.');
  await page.waitForTimeout(240_000);
  await browser.close();
}

async function inspectPage() {
  if (!targetUrl) { console.error('Usage: probe.mjs inspect-page <url> [credentialKey]'); process.exit(1); }
  const credKey = process.argv[4] ?? 'gm-lume';

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ storageState: storagePath(credKey), viewport: null });
  const page = await context.newPage();
  await page.goto(targetUrl);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(800);
  await dismissPopups(page);

  const tables = await page.$$eval('table', els => els.map(t => ({
    id: t.id,
    classes: t.className,
    headers: Array.from(t.querySelectorAll('thead th, thead td')).map(h => h.innerText.trim()),
    firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map(c => c.innerText.trim().slice(0, 80)),
    rowCount: t.querySelectorAll('tbody tr').length,
  })));
  const links = await page.$$eval('a', els => els.slice(0, 200).map(e => ({
    href: e.href, text: (e.innerText || '').trim().slice(0, 100),
  })).filter(l => l.text && l.href && !l.href.startsWith('javascript:')));
  const forms = await page.$$eval('form', els => els.map(f => ({ id: f.id, action: f.action, method: f.method })));

  const summary = { url: page.url(), title: await page.title(), forms, tables, links };
  console.log(JSON.stringify(summary, null, 2));
  const safe = page.url().replace(/[^a-z0-9]/gi, '_').slice(-100);
  writeFileSync(resolve(SPIKE_OUT, `page-${safe}.json`), JSON.stringify(summary, null, 2));
  console.log('[spike] Browser stays open 120s.');
  await page.waitForTimeout(120_000);
  await browser.close();
}

async function tryExportExcel() {
  const route = process.argv[3]; // e.g., 'alocacao' or 'instancia-documento/index'
  const credKey = process.argv[4] ?? 'gm-lume';
  if (!route) { console.error('Usage: probe.mjs export-excel <route> [credKey]   (e.g., alocacao, colaborador, instancia-documento/index)'); process.exit(1); }
  // Base route (drop trailing /index for matching form action like /<route>/export-excel)
  const baseRoute = route.replace(/\/index$/, '');

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ storageState: storagePath(credKey), viewport: null, acceptDownloads: true });
  const page = await context.newPage();
  const indexUrl = `https://sg3.executiva.adm.br/gm/index.php?r=${encodeURIComponent(route)}`;
  console.log(`[spike] Loading ${indexUrl}`);
  await page.goto(indexUrl);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(800);
  await dismissPopups(page);

  // Look for the export button or form submitting to /export-excel
  const formInfo = await page.evaluate((route) => {
    const forms = document.querySelectorAll('form');
    for (const f of forms) {
      if (f.action && (f.action.includes(`r=${route}/export-excel`) || f.action.includes(`r=${route}%2Fexport-excel`) || f.action.includes(`r=${baseRoute}/export-excel`) || f.action.includes(`r=${baseRoute}%2Fexport-excel`))) {
        const inputs = Array.from(f.querySelectorAll('input,select,textarea')).map(i => ({ name: i.name, type: i.type, value: i.value }));
        return { id: f.id, action: f.action, method: f.method, inputs };
      }
    }
    return null;
  }, route);

  if (!formInfo) {
    console.error('[spike] export-excel form not found on page');
    await page.waitForTimeout(60_000);
    await browser.close();
    return;
  }
  console.log('[spike] Found export form:', JSON.stringify(formInfo, null, 2));

  // Try to submit it via Playwright form interaction (will trigger download)
  console.log('[spike] Submitting export-excel form (waiting for download)...');
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.evaluate((route) => {
    const forms = document.querySelectorAll('form');
    for (const f of forms) {
      if (f.action.includes(`r=${route}/export-excel`) || f.action.includes(`r=${route}%2Fexport-excel`) || f.action.includes(`r=${baseRoute}/export-excel`) || f.action.includes(`r=${baseRoute}%2Fexport-excel`)) {
        f.submit();
        return;
      }
    }
  }, route);
  let download;
  try {
    download = await downloadPromise;
  } catch (err) {
    console.error('[spike] No download event:', err.message);
    await page.waitForTimeout(30_000);
    await browser.close();
    return;
  }
  const filename = download.suggestedFilename();
  const dest = resolve(SPIKE_OUT, `export-${route}-${Date.now()}-${filename}`);
  await download.saveAs(dest);
  console.log(`[spike] Saved download → ${dest}`);

  await page.waitForTimeout(5000);
  await browser.close();
}

async function inspectAfterFilter() {
  const url = process.argv[3];
  const credKey = process.argv[4] ?? 'gm-lume';
  if (!url) { console.error('Usage: probe.mjs inspect-after-filter <url> [credKey]'); process.exit(1); }

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ storageState: storagePath(credKey), viewport: null });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(800);
  await dismissPopups(page);

  // Try to submit any filter form (look for "Pesquisar"/"Filtrar"/"Buscar" button or click main form submit)
  const submitInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button[type=submit], input[type=submit]'));
    for (const b of buttons) {
      const t = (b.innerText || b.value || '').trim().toLowerCase();
      if (/pesquisar|filtrar|buscar|consultar|aplicar/.test(t)) {
        return { tag: b.tagName, type: b.type, id: b.id, name: b.name, text: t };
      }
    }
    return null;
  });
  if (submitInfo) {
    console.log('[spike] submit button found:', submitInfo);
    const btnSel = submitInfo.id ? `#${submitInfo.id}` : `${submitInfo.tag.toLowerCase()}[type=submit]`;
    try {
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
        page.click(btnSel, { force: true }),
      ]);
      await page.waitForTimeout(2000);
      await dismissPopups(page);
    } catch (err) {
      console.log('[spike] submit click failed', err.message);
    }
  } else {
    console.log('[spike] no obvious filter button — trying first POST form submit');
    try {
      await page.evaluate(() => {
        for (const f of document.querySelectorAll('form')) {
          if (f.method.toLowerCase() === 'post' && /index|pesquisar/i.test(f.action)) { f.submit(); return; }
        }
      });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await dismissPopups(page);
    } catch {}
  }

  const tables = await page.$$eval('table', els => els.map(t => ({
    id: t.id, classes: t.className,
    headers: Array.from(t.querySelectorAll('thead th, thead td')).map(h => h.innerText.trim()),
    firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map(c => c.innerText.trim().slice(0, 80)),
    rowCount: t.querySelectorAll('tbody tr').length,
  })));
  const forms = await page.$$eval('form', els => els.map(f => ({ id: f.id, action: f.action, method: f.method })));
  const summary = { url: page.url(), title: await page.title(), forms, tables };
  console.log(JSON.stringify(summary, null, 2));
  const safe = page.url().replace(/[^a-z0-9]/gi, '_').slice(-100);
  writeFileSync(resolve(SPIKE_OUT, `after-filter-${safe}.json`), JSON.stringify(summary, null, 2));
  await page.waitForTimeout(120_000);
  await browser.close();
}

const handlers = { 'inspect-login': inspectLogin, 'login': attemptLogin, 'gm': enterGm, 'inspect-page': inspectPage, 'export-excel': tryExportExcel, 'inspect-after-filter': inspectAfterFilter };
const fn = handlers[command];
if (!fn) {
  console.error(`Unknown command: ${command}. Use: inspect-login | login [key] | gm [key] | inspect-page <url> [key]`);
  process.exit(1);
}
await fn();
