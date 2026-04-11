import { spawn } from 'child_process';

const SYSTEM_PROMPT = `Você é o JARVIS, assistente do Pedro e do time Strokmatic.
Responda SEMPRE em português brasileiro, mesmo que a pergunta venha em outro idioma.
Use APENAS o contexto fornecido. Se não houver informação suficiente, diga que não sabe.
Se uma informação vier de outro projeto/espaço, mencione a origem explicitamente entre parênteses, ex: (de espaço VK 03001 — Stellantis).
Seja conciso e direto. Use markdown leve. Evite preâmbulos como "claro" ou "ótima pergunta".`;

function buildUserPrompt({ question, projectContext, facts, projectCode, spaceLabel }) {
  const parts = [];
  parts.push(`# Pergunta no espaço ${spaceLabel} (projeto ${projectCode})`);
  parts.push(question);
  parts.push('');
  parts.push('# Contexto do projeto');
  if (projectContext.sources.length === 0) {
    parts.push('_(sem fontes estáticas disponíveis)_');
  } else {
    for (const s of projectContext.sources) {
      parts.push(`## ${s.label}`);
      parts.push(s.content);
      parts.push('');
    }
  }
  parts.push('# Fatos relevantes da memória de chat');
  if (facts.length === 0) {
    parts.push('_(nenhum fato relevante encontrado)_');
  } else {
    facts.forEach((entry, i) => {
      const f = entry.fact;
      parts.push(`${i + 1}. [${f.type}] ${f.summary}`);
      parts.push(`   _origem: ${f.source.space_label} — extraído em ${f.extracted_at.substring(0, 10)}_`);
    });
  }
  return parts.join('\n');
}

export async function generateAnswer({ question, projectContext, facts, projectCode, spaceLabel, model }) {
  const userPrompt = buildUserPrompt({ question, projectContext, facts, projectCode, spaceLabel });
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', model || 'claude-sonnet-4-6',
      '--max-turns', '1',
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude --print exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

export { buildUserPrompt };
