import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { readFile as fsReadFile } from 'node:fs/promises';
import { makeLogger } from './logger.mjs';

// xlsx is a CommonJS module; use createRequire for ESM compatibility
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const log = makeLogger('sg3-client');

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

// ─── Popup dismissal ──────────────────────────────────────────────────────────

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
      } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }
  // Then: hide explicit overlays via DOM
  await page.evaluate((overlays) => {
    for (const sel of overlays) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch { /* ignore */ }
    }
  }, POPUP_OVERLAY_SELECTORS).catch(() => {});
  // Finally: heuristic nuke of any matching generic overlays
  await nukeGenericOverlays(page);
  await page.waitForTimeout(150);
}

// ─── GM sub-portal entry ─────────────────────────────────────────────────────

async function enterGmSubportal(page, masterUrl) {
  const url = masterUrl ?? 'https://sg3.executiva.adm.br/index.php';
  log.info('entering GM sub-portal', { from: url });
  await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(500);
  await dismissPopups(page);

  // Try href selector first, then visible text
  const gmLink =
    (await page.$('a[href*="/gm/index.php"][href*="site/login"]')) ||
    (await page.$('a:has-text("GM - GENERAL MOTORS")'));

  if (!gmLink) {
    // Log available links to aid debugging
    const links = await page.$$eval('a', els =>
      els.slice(0, 60).map(e => ({ href: e.href, text: (e.innerText || '').trim().slice(0, 60) }))
    ).catch(() => []);
    log.error('GM portal link not found', { available: links });
    throw new Error('GM portal link not found on master portal page');
  }

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
    gmLink.click(),
  ]);
  await page.waitForTimeout(2000);
  await dismissPopups(page);
  await page.waitForTimeout(1000);
  await dismissPopups(page);

  const currentUrl = page.url();
  if (!currentUrl.includes('/gm/')) {
    throw new Error(`Expected /gm/ in URL after clicking GM link, got: ${currentUrl}`);
  }
  log.info('entered GM sub-portal', { url: currentUrl });
}

// ─── Excel export download ────────────────────────────────────────────────────

async function downloadExportXlsx(page, route) {
  const pageUrl = `https://sg3.executiva.adm.br/gm/index.php?r=${route}`;
  log.info('loading export page', { route, pageUrl });
  await page.goto(pageUrl);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(800);
  await dismissPopups(page);

  // Verify the form is present
  const formFound = await page.evaluate((route) => {
    const forms = document.querySelectorAll('form');
    for (const f of forms) {
      if (
        f.action && (
          f.action.includes(`r=${route}/export-excel`) ||
          f.action.includes(`r=${route}%2Fexport-excel`)
        )
      ) {
        return true;
      }
    }
    return false;
  }, route);

  if (!formFound) {
    // Might be redirected to login — check URL
    const currentUrl = page.url();
    throw new Error(`export-excel form not found for route=${route}. Current URL: ${currentUrl}`);
  }

  log.info('submitting export-excel form', { route });
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });

  await page.evaluate((route) => {
    const forms = document.querySelectorAll('form');
    for (const f of forms) {
      if (
        f.action.includes(`r=${route}/export-excel`) ||
        f.action.includes(`r=${route}%2Fexport-excel`)
      ) {
        f.submit();
        return;
      }
    }
  }, route);

  const download = await downloadPromise;
  const filename = download.suggestedFilename() || `${route}-export.xlsx`;
  const dest = resolve(tmpdir(), `sg3-${route}-${Date.now()}-${filename}`);
  await download.saveAs(dest);
  log.info('download saved', { route, dest });
  return dest;
}

// ─── Date and slug helpers ────────────────────────────────────────────────────

function parseDate(dmy) {
  if (!dmy || typeof dmy !== 'string') return null;
  const s = dmy.trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function slugify(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Map SG3-formatted empresa names to canonical empresa_id (matches empresas.id).
// SG3 appends " SUB <PRINCIPAL>" suffix to subcontractor names; canonical id ignores it.
function empresaNomeToId(nomeSg3) {
  if (!nomeSg3) return '';
  const upper = nomeSg3.toUpperCase();
  if (upper.includes('STROKMATIC AUTOMACAO')) return 'strokmatic';
  if (upper.includes('LUME TECNOLOGIA')) return 'lume';
  // Fallback: strip trailing " SUB <X>" and slugify
  return slugify(nomeSg3.replace(/\s+SUB\s+.+$/i, ''));
}

// ─── Status derivation ────────────────────────────────────────────────────────

function deriveStatusSg3(situacao, aprovacao) {
  const sit = (situacao ?? '').toString().trim().toUpperCase();
  const apr = (aprovacao ?? '').toString().trim();
  if (sit === 'ATIVA' && apr === 'Sim') return 'liberada';
  if (apr === 'Não') return 'pendente_aprovacao';
  if (sit === 'INATIVA') return 'vencida';
  return 'docs_pendentes';
}

// ─── XLSX row parsing ─────────────────────────────────────────────────────────

function parseXlsx(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ─── Session management ───────────────────────────────────────────────────────

// Module-level variable: set by withSg3Session so scrape functions can access config
let _currentClientConfig = null;

export async function withSg3Session(clientConfig, credentialsKey, work) {
  const cfg = clientConfig.playwright;
  const sessionPath = resolve(expandHome(cfg.auth_session_dir), `${credentialsKey}-storage-state.json`);
  mkdirSync(dirname(sessionPath), { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.SG3_HEADLESS !== '0',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    storageState: existsSync(sessionPath) ? sessionPath : undefined,
    acceptDownloads: true,
  });

  _currentClientConfig = clientConfig;
  try {
    const page = await context.newPage();

    const result = await tryOrLogin(page, cfg, credentialsKey, async () => {
      // After login, enter the GM sub-portal
      await enterGmSubportal(page, 'https://sg3.executiva.adm.br/index.php');
      return work(page);
    });

    await context.storageState({ path: sessionPath });
    return result;
  } finally {
    _currentClientConfig = null;
    await browser.close();
  }
}

async function tryOrLogin(page, cfg, credentialsKey, fn) {
  // First attempt without login (use saved session)
  if (existsSync(resolve(expandHome(cfg.auth_session_dir), `${credentialsKey}-storage-state.json`))) {
    try {
      return await fn();
    } catch (err) {
      // If it looks like an auth failure, fall through to login
      if (!/login|auth|unauth|redirect|GM portal link not found/i.test(err.message)) throw err;
      log.warn('first attempt failed; trying login flow', { err: err.message, credentialsKey });
    }
  }
  await doLogin(page, cfg, credentialsKey);
  return await fn();
}

async function doLogin(page, cfg, credentialsKey) {
  const credsPath = expandHome(cfg.credentials_secret_path);
  if (!existsSync(credsPath)) {
    throw new Error(`credentials file not found at ${credsPath}; cannot auto-login`);
  }
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))[credentialsKey];
  if (!creds) throw new Error(`credentials missing key ${credentialsKey}`);

  const loginUrl = cfg.master_login_url ?? 'https://sg3.executiva.adm.br/index.php?r=site/newlogin';
  log.info('logging in', { credentialsKey, loginUrl });

  await page.goto(loginUrl);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);

  await page.fill(cfg.selectors.login_user, creds.username);
  await dismissPopups(page);
  await page.fill(cfg.selectors.login_pass, creds.password);
  await dismissPopups(page);

  log.info('submitting login form', { credentialsKey });
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
    page.click(cfg.selectors.login_submit, { force: true }),
  ]);
  await page.waitForTimeout(2000);
  await dismissPopups(page);
  await page.waitForTimeout(1500);
  await dismissPopups(page);

  // Detect MFA
  if (await page.locator('input[name=mfa]').count() > 0) {
    throw new Error('MFA required — re-run with SG3_HEADLESS=0 and complete the challenge manually');
  }

  const postUrl = page.url();
  log.info('login complete', { postUrl });
}

// ─── Scrape alocações ─────────────────────────────────────────────────────────

export async function scrapeAlocacoes(page, _urlOrSelector) {
  const clientConfig = _currentClientConfig;
  const xlsxPath = await downloadExportXlsx(page, 'alocacao');
  const rows = parseXlsx(xlsxPath);
  log.info('alocacoes xlsx parsed', { rows: rows.length });

  const alocacoes = [];
  const plantasMap = new Map();  // id → obj
  const pessoasGmMap = new Map();  // id → obj
  const cadastrosSg3Map = new Map();  // id → obj

  for (const row of rows) {
    const colaboradorNome = String(row['COLABORADOR'] ?? '').trim();
    const empresaTerceiraNome = String(row['EMPRESA TERCEIRA'] ?? '').trim();
    const estabelecimentoNome = String(row['ESTABELECIMENTO'] ?? '').trim();
    const tipoTerceiro = String(row['TIPO DE TERCEIRO'] ?? '').trim();
    const gestorPrestacaoNome = String(row['GESTOR DA PRESTAÇÃO DE SERVIÇO'] ?? row['GESTOR DA PRESTACAO DE SERVICO'] ?? '').trim();
    const gestorAlocacaoNome = String(row['GESTOR DA ALOCAÇÃO'] ?? row['GESTOR DA ALOCACAO'] ?? '').trim();
    const aprovacao = String(row['APROVAÇÃO'] ?? row['APROVACAO'] ?? '').trim();
    const situacao = String(row['SITUAÇÃO DA ALOCAÇÃO'] ?? row['SITUACAO DA ALOCACAO'] ?? '').trim();

    const colaboradorId = slugify(colaboradorNome);
    const plantaId = slugify(estabelecimentoNome);
    const empresaId = empresaNomeToId(empresaTerceiraNome);

    // Derive cadastro_sg3 key from the triplet
    const cadastroKey = `${empresaTerceiraNome}|${estabelecimentoNome}|${tipoTerceiro}`;
    const cadastroId = slugify(`${empresaTerceiraNome}-${estabelecimentoNome}-${tipoTerceiro}`);

    // Build planta
    if (estabelecimentoNome && !plantasMap.has(plantaId)) {
      plantasMap.set(plantaId, {
        id: plantaId,
        cliente: 'GM',
        nome: estabelecimentoNome,
        _origem: 'sg3',
      });
    }

    // Build pessoas_gm from gestores
    for (const nome of [gestorPrestacaoNome, gestorAlocacaoNome]) {
      if (!nome) continue;
      const id = slugify(nome);
      if (!pessoasGmMap.has(id)) {
        pessoasGmMap.set(id, {
          id,
          nome,
          papeis: 'responsavel_planta',
          tem_user_sg3: true,
          _origem: 'sg3',
        });
      }
    }

    // Build cadastro_sg3
    if (!cadastrosSg3Map.has(cadastroKey)) {
      cadastrosSg3Map.set(cadastroKey, {
        id: cadastroId,
        planta_id: plantaId,
        empresa_terceira_id: empresaId,
        tipo_terceiro: tipoTerceiro,
        contrato_id: '',
        responsavel_planta_id: gestorPrestacaoNome ? slugify(gestorPrestacaoNome) : '',
        status_aprovacao: aprovacao === 'Sim' ? 'aprovado' : aprovacao === 'Não' ? 'pendente' : '',
        data_vencimento: '',
        _origem: 'sg3',
      });
    }

    const statusSg3 = deriveStatusSg3(situacao, aprovacao);

    alocacoes.push({
      id: String(row['ID'] ?? '').trim(),
      colaborador_id: colaboradorId,
      colaborador_nome: colaboradorNome,
      empresa_terceira_nome: empresaTerceiraNome,
      empresa_terceira_id: empresaId,
      estabelecimento_nome: estabelecimentoNome,
      planta_id: plantaId,
      tipo_terceiro: tipoTerceiro,
      data_inicio: parseDate(String(row['DATA DE INÍCIO DAS ATIVIDADES'] ?? row['DATA DE INICIO DAS ATIVIDADES'] ?? '')),
      data_vencimento_propria: parseDate(String(row['DATA DE FINALIZAÇÃO DAS ATIVIDADES'] ?? row['DATA DE FINALIZACAO DAS ATIVIDADES'] ?? '')),
      aprovacao,
      situacao,
      status_sg3: statusSg3,
      gestor_prestacao_nome: gestorPrestacaoNome,
      gestor_alocacao_nome: gestorAlocacaoNome,
      cadastro_sg3_id: cadastroId,
      _origem: 'sg3',
    });
  }

  const plantas = Array.from(plantasMap.values());
  const pessoas_gm = Array.from(pessoasGmMap.values());
  const cadastros_sg3 = Array.from(cadastrosSg3Map.values());

  log.info('alocacoes parsed', {
    alocacoes: alocacoes.length,
    plantas: plantas.length,
    pessoas_gm: pessoas_gm.length,
    cadastros_sg3: cadastros_sg3.length,
  });

  return { alocacoes, plantas, pessoas_gm, cadastros_sg3 };
}

// ─── Excel export download (with prior Buscar/search submit) ─────────────────

async function downloadExportXlsxAfterSearch(page, route) {
  const baseRoute = route.replace(/\/index$/, '');
  const pageUrl = `https://sg3.executiva.adm.br/gm/index.php?r=${encodeURIComponent(route)}`;
  log.info('loading documentos page for buscar→export flow', { route, pageUrl });
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(800);
  await dismissPopups(page);

  // Click submit button matching /^buscar|^pesquisar|^filtrar|^consultar/i
  log.info('clicking Buscar to populate results', { route });
  const buscarHandle = await page.evaluateHandle(() => {
    for (const b of document.querySelectorAll('button[type=submit], input[type=submit]')) {
      const t = (b.innerText || b.value || '').trim().toLowerCase();
      if (/^buscar|^pesquisar|^filtrar|^consultar/.test(t)) return b;
    }
    return null;
  });
  const hasBuscar = await buscarHandle.evaluate(b => !!b);
  if (hasBuscar) {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {}),
      buscarHandle.evaluate(b => b.click()),
    ]);
    await page.waitForTimeout(2500);
  } else {
    log.warn('no Buscar button found — proceeding without it', { route });
  }
  await dismissPopups(page);

  // Find export form
  const formFound = await page.evaluate(({ route, baseRoute }) => {
    for (const f of document.querySelectorAll('form')) {
      if (!f.action) continue;
      if (
        f.action.includes(`r=${route}/export-excel`) ||
        f.action.includes(`r=${route}%2Fexport-excel`) ||
        f.action.includes(`r=${baseRoute}/export-excel`) ||
        f.action.includes(`r=${baseRoute}%2Fexport-excel`)
      ) return true;
    }
    return false;
  }, { route, baseRoute });

  if (!formFound) {
    const currentUrl = page.url();
    throw new Error(`export-excel form not found after Buscar for route=${route}. Current URL: ${currentUrl}`);
  }

  log.info('submitting export-excel form after Buscar', { route });
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });

  await page.evaluate(({ route, baseRoute }) => {
    for (const f of document.querySelectorAll('form')) {
      if (!f.action) continue;
      if (
        f.action.includes(`r=${route}/export-excel`) ||
        f.action.includes(`r=${route}%2Fexport-excel`) ||
        f.action.includes(`r=${baseRoute}/export-excel`) ||
        f.action.includes(`r=${baseRoute}%2Fexport-excel`)
      ) { f.submit(); return; }
    }
  }, { route, baseRoute });

  const download = await downloadPromise;
  const filename = download.suggestedFilename() || `${baseRoute}-export.xlsx`;
  const dest = resolve(tmpdir(), `sg3-${baseRoute.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}-${filename}`);
  await download.saveAs(dest);
  log.info('download saved', { route, dest });
  return dest;
}

// ─── Document tipo mapper ─────────────────────────────────────────────────────

function mapDocumentTipo(documento, tipoDoc) {
  const d = (documento || '').toUpperCase();
  if (d.includes('DECLARACAO DE RESPONSABILIDADES')) return { target: 'declaracoes_responsabilidade' };
  if (tipoDoc === 'FUNCIONAL') {
    if (d.includes('ASO')) return { target: 'docs_colaborador', tipo: 'aso' };
    if (d.includes('NR 10') || d.includes('NR-10') || d.includes('NR10')) return { target: 'docs_colaborador', tipo: 'nr10' };
    if (d.includes('NR 35') || d.includes('NR-35') || d.includes('NR35')) return { target: 'docs_colaborador', tipo: 'nr35' };
    if (d.includes('NR 12') || d.includes('NR-12') || d.includes('NR12')) return { target: 'docs_colaborador', tipo: 'nr12' };
    return { target: 'docs_colaborador', tipo: 'outro' };
  }
  // PATRONAL or unknown TIPO
  if (d.includes('PGR')) return { target: 'docs_empresa', tipo: 'pgr' };
  if (d.includes('PCMSO')) return { target: 'docs_empresa', tipo: 'pcmso' };
  if (d.includes('CND') && d.includes('FEDERAL')) return { target: 'docs_empresa', tipo: 'cnd_federal' };
  if (d.includes('CNDT') || (d.includes('CND') && d.includes('TRABALH'))) return { target: 'docs_empresa', tipo: 'cnd_trabalhista' };
  if (d.includes('CRF') || d.includes('FGTS')) return { target: 'docs_empresa', tipo: 'cnd_fgts' };
  return { target: 'docs_empresa', tipo: 'outro' };
}

// ─── Scrape documentos ────────────────────────────────────────────────────────

export async function scrapeDocumentos(page) {
  const xlsxPath = await downloadExportXlsxAfterSearch(page, 'instancia-documento/index');
  const rows = parseXlsx(xlsxPath);
  log.info('documentos xlsx parsed', { rows: rows.length });

  const docs_empresa = [];
  const docs_colaborador = [];
  const declaracoes_responsabilidade = [];

  for (const row of rows) {
    const rawId = String(row['ID'] ?? '').trim();
    const tipoDoc = String(row['TIPO DE DOCUMENTO'] ?? '').trim().toUpperCase();
    const statusDoc = String(row['STATUS DOCUMENTO'] ?? '').trim();
    const documento = String(row['DOCUMENTO'] ?? '').trim();
    const colaboradorNome = String(row['COLABORADOR'] ?? '').trim();
    const empresaTerceiraNome = String(row['EMPRESA TERCEIRA'] ?? '').trim();
    const estabelecimentoNome = String(row['ESTABELECIMENTO'] ?? '').trim();
    const vigencia = String(row['VIGÊNCIA'] ?? row['VIGENCIA'] ?? '').trim();
    const dataEnvio = String(row['DATA ENVIO'] ?? '').trim();

    const id = `sg3-doc-${rawId}`;
    const { target, tipo } = mapDocumentTipo(documento, tipoDoc);
    const statusUpper = statusDoc.toUpperCase();
    const notas = `SG3: ${statusDoc} — DOCUMENTO: ${documento}`;
    const data_emissao = parseDate(dataEnvio) ?? null;
    const data_vencimento = parseDate(vigencia) ?? null;

    if (target === 'declaracoes_responsabilidade') {
      const assinaturas = statusUpper === 'CONFORME' ? 'completa' : 'pendente';
      declaracoes_responsabilidade.push({
        id,
        colaborador_id: slugify(colaboradorNome) || '',
        planta_id: slugify(estabelecimentoNome) || '',
        data_emissao: data_emissao ?? '',
        assinaturas,
        arquivo_url: '',
        versao: '',
        notas,
        _origem: 'sg3',
      });
    } else if (target === 'docs_colaborador') {
      docs_colaborador.push({
        id,
        colaborador_id: slugify(colaboradorNome) || '',
        tipo: tipo ?? 'outro',
        data_emissao: data_emissao ?? '',
        data_vencimento: data_vencimento ?? '',
        arquivo_url: '',
        notas,
        _origem: 'sg3',
      });
    } else {
      // docs_empresa
      docs_empresa.push({
        id,
        empresa_id: empresaNomeToId(empresaTerceiraNome) || '',
        tipo: tipo ?? 'outro',
        data_emissao: data_emissao ?? '',
        data_vencimento: data_vencimento ?? '',
        arquivo_url: '',
        notas,
        _origem: 'sg3',
      });
    }
  }

  log.info('documentos categorized', {
    docs_empresa: docs_empresa.length,
    docs_colaborador: docs_colaborador.length,
    declaracoes_responsabilidade: declaracoes_responsabilidade.length,
  });

  return { docs_empresa, docs_colaborador, declaracoes_responsabilidade };
}

// ─── Scrape cadastros (colaboradores) ─────────────────────────────────────────

export async function scrapeCadastros(page, _urlOrSelector) {
  const xlsxPath = await downloadExportXlsx(page, 'colaborador');
  const rows = parseXlsx(xlsxPath);
  log.info('colaboradores xlsx parsed', { rows: rows.length });

  const colaboradores = rows.map(row => {
    const nome = String(row['Nome Completo'] ?? '').trim();
    const empresaNome = String(row['Empresa Terceira'] ?? '').trim();
    return {
      id: nome ? slugify(nome) : '',
      nome_completo: nome,
      cpf: String(row['CPF'] ?? '').trim(),
      pis: String(row['PIS'] ?? '').trim(),
      empresa_id: empresaNomeToId(empresaNome),
      empresa_terceira_nome: empresaNome,
      data_admissao: parseDate(String(row['Data de Admissão'] ?? row['Data de Admissao'] ?? '')),
      data_demissao: parseDate(String(row['Data de Demissão'] ?? row['Data de Demissao'] ?? '')),
      tipo_atividade: String(row['Tipo de Atividade'] ?? '').trim(),
      sg3_id: String(row['ID'] ?? '').trim(),
      _origem: 'sg3',
    };
  });

  log.info('colaboradores parsed', { count: colaboradores.length });
  return { colaboradores };
}
