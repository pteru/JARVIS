import { execFileSync } from 'node:child_process';

const RE_CONTRATO_ID = /\b(5000\d{6,7})\b/;
const RE_VIGENCIA_INICIO = /(?:Início|Inicio|Data de Início)[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_VIGENCIA_FIM    = /(?:Término|Termino|Data de Término|Fim|Data de Fim)[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i;
const RE_RESPONSAVEL_NOME = /(?:Responsável(?: Técnico)?(?: GM)?|Gestor(?: GM)?)[:\s]+([A-Z][A-Za-zÀ-ÿ]+(?:\s+[A-Z][A-Za-zÀ-ÿ]+)+)/i;
const RE_RESPONSAVEL_EMAIL = /(?:E-?mail)[:\s]+([^\s<>()]+@[^\s<>()]+)/i;
const RE_OBJETO_BLOCK = /Objeto[:\s]+([\s\S]+?)(?=\n\s*\n|\bVigência\b|\bResponsável\b)/i;

function dmyToIso(dd, mm, yyyy) {
  return `${yyyy}-${mm}-${dd}`;
}

export function extractFieldsFromText(text) {
  const warnings = [];
  const out = { warnings, extracaoStatus: 'auto' };

  const id = text.match(RE_CONTRATO_ID);
  out.contratoId = id?.[1] ?? null;
  if (!out.contratoId) warnings.push('contrato_id não encontrado');

  const ini = text.match(RE_VIGENCIA_INICIO);
  out.dataInicio = ini ? dmyToIso(ini[1], ini[2], ini[3]) : null;
  if (!out.dataInicio) warnings.push('data_inicio não encontrada');

  const fim = text.match(RE_VIGENCIA_FIM);
  out.dataFim = fim ? dmyToIso(fim[1], fim[2], fim[3]) : null;
  if (!out.dataFim) warnings.push('data_fim não encontrada');

  const nome = text.match(RE_RESPONSAVEL_NOME);
  out.responsavelGmNome = nome?.[1] ?? null;
  if (!out.responsavelGmNome) warnings.push('responsavel_gm_nome não encontrado');

  const email = text.match(RE_RESPONSAVEL_EMAIL);
  out.responsavelGmEmail = email?.[1] ?? null;
  if (!out.responsavelGmEmail) warnings.push('responsavel_gm_email não encontrado');

  const obj = text.match(RE_OBJETO_BLOCK);
  out.objeto = obj?.[1].trim().replace(/\s+/g, ' ') ?? null;
  if (!out.objeto) warnings.push('objeto não encontrado');

  return out;
}

export function extractTextFromPdf(pdfPath) {
  try {
    const text = execFileSync('pdftotext', [pdfPath, '-layout', '-'], { encoding: 'utf-8' });
    return text;
  } catch (err) {
    return '';
  }
}

export async function parseContractPdf({ pdfPath, claudePrintFallback }) {
  const text = extractTextFromPdf(pdfPath);
  if (text.length >= 500) {
    const r = extractFieldsFromText(text);
    if (r.warnings.length === 0 || !claudePrintFallback) return r;

    // partial extraction: ask claude --print for missing fields
    const filled = await claudePrintFallback({ text, knownFields: r });
    return { ...r, ...filled, extracaoStatus: 'auto' };
  }

  if (claudePrintFallback) {
    const filled = await claudePrintFallback({ pdfPath });
    return { ...filled, extracaoStatus: 'auto' };
  }

  return { warnings: ['pdftotext returned no usable text'], extracaoStatus: 'manual' };
}
