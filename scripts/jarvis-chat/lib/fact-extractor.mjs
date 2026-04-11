import { spawn } from 'child_process';

const SYSTEM_PROMPT = `Você é um extrator estruturado de fatos a partir de conversas de chat de times de engenharia em português brasileiro.
Sua tarefa: ler uma thread de mensagens e extrair fatos estruturados úteis para memória de longo prazo do projeto.

Tipos de fato permitidos (use exatamente estes valores no campo "type"):
- decision: uma decisão tomada
- action_item: uma ação atribuída ou combinada
- blocker: um impedimento mencionado
- open_question: uma dúvida em aberto, sem resposta ainda
- observation: uma observação técnica ou status relevante
- risk: um risco identificado
- commitment: um compromisso assumido com alguém (data, entrega)
- metric: um valor numérico relevante mencionado (KPI, medida, contagem)

Saída: JSON puro, um array de objetos, sem texto fora do JSON. Cada objeto deve ter:
{
  "type": "...",
  "summary": "frase curta em PT-BR",
  "entities": ["..."],
  "people": ["..."]
}

Se nenhuma informação relevante for encontrada, retorne array vazio [].
Não invente fatos. Não inclua small talk.`;

function buildUserPrompt(threadMessages, sourceMeta) {
  const lines = [];
  lines.push(`# Thread no espaço ${sourceMeta.space_label} (projeto ${sourceMeta.project_code})`);
  lines.push('');
  for (const m of threadMessages) {
    lines.push(`[${m.ts}] ${m.sender?.name || 'desconhecido'}: ${m.text}`);
  }
  lines.push('');
  lines.push('Extraia os fatos estruturados desta thread.');
  return lines.join('\n');
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', 'claude-sonnet-4-6',
      '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function parseJsonArray(raw) {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let factCounter = 0;
function nextFactId(extractedAt) {
  factCounter += 1;
  return `f_${extractedAt.substring(0, 10)}_${String(factCounter).padStart(3, '0')}`;
}

export async function extractFactsFromThread(threadMessages, sourceMeta) {
  if (threadMessages.length < 2) return [];
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(threadMessages, sourceMeta)}`;
  const raw = await callClaude(prompt);
  const items = parseJsonArray(raw);
  const extractedAt = new Date().toISOString();
  return items.map(item => ({
    id: nextFactId(extractedAt),
    extracted_at: extractedAt,
    source: {
      space_id: sourceMeta.space_id,
      space_label: sourceMeta.space_label,
      project_code: sourceMeta.project_code,
      product: sourceMeta.product,
      thread_id: threadMessages[0].thread_id,
      message_ids: threadMessages.map(m => m.message_id),
    },
    type: item.type,
    summary: item.summary,
    entities: Array.isArray(item.entities) ? item.entities : [],
    people: Array.isArray(item.people) ? item.people : [],
  }));
}

export { buildUserPrompt as _buildExtractionPrompt, parseJsonArray as _parseJsonArray };
