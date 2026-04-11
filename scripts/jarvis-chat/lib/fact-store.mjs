import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const STOPWORDS_PT = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'que', 'e', 'é', 'para', 'pra', 'com', 'sem', 'por', 'se', 'sua',
  'seu', 'suas', 'seus', 'ao', 'aos', 'à', 'às', 'ou', 'mas',
  'qual', 'quais', 'quando', 'como', 'onde', 'quem', 'quanto',
]);

export function tokenize(text) {
  if (typeof text !== 'string') return [];
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúç ]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !STOPWORDS_PT.has(t));
  return [...new Set(raw)];
}

export function scoreFact(fact, queryTokens, { projectCode, nowIso } = {}) {
  if (queryTokens.length === 0) return 0;
  const haystackText = [
    fact.summary || '',
    ...(fact.entities || []),
    ...(fact.people || []),
  ].join(' ');
  const factTokens = new Set(tokenize(haystackText));
  let overlap = 0;
  for (const t of queryTokens) {
    if (factTokens.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  let score = overlap;

  const ageDays = (new Date(nowIso) - new Date(fact.extracted_at)) / 86400000;
  if (ageDays < 7) score *= 1.5;
  else if (ageDays < 30) score *= 1.2;

  if (fact.source?.project_code === projectCode) score *= 1.3;

  return score;
}

export function searchFacts(facts, query, { projectCode, k = 10, nowIso }) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored = facts
    .map(f => ({ fact: f, score: scoreFact(f, tokens, { projectCode, nowIso }) }))
    .filter(x => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.fact.extracted_at) - new Date(a.fact.extracted_at);
    });
  return scored.slice(0, k);
}

function monthShardName(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
}

export function appendFact(factsDir, factRecord) {
  if (!existsSync(factsDir)) mkdirSync(factsDir, { recursive: true });
  const shardPath = join(factsDir, monthShardName(factRecord.extracted_at));
  appendFileSync(shardPath, JSON.stringify(factRecord) + '\n');
}

export function loadRecentFacts(factsDir, monthsBack = 3, now = new Date()) {
  if (!existsSync(factsDir)) return [];
  const shards = [];
  for (let i = 0; i < monthsBack; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    shards.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.jsonl`);
  }
  const out = [];
  for (const name of shards) {
    const p = join(factsDir, name);
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  }
  return out;
}
