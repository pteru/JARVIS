import { runClaudePrint } from '../../lib/chat-bot/claude-print.mjs';

/**
 * Generate an answer using claude --print with KB context
 * @param {string} question - User's question
 * @param {Array<{relPath, title, content}>} kbPages - Relevant KB pages
 * @param {object} config - Chat bot config
 * @returns {Promise<string>} - Generated answer
 */
export async function generateAnswer(question, kbPages, config) {
  // Build context from KB pages
  let context = '';
  let totalLines = 0;
  for (const page of kbPages) {
    const lines = page.content.split('\n').length;
    if (totalLines + lines > config.max_context_lines) break;
    context += `\n\n--- ${page.relPath} ---\n${page.content}`;
    totalLines += lines;
  }

  const prompt = `${config.system_prompt}

## Base de Conhecimento (contexto para responder)
${context}

## Pergunta do usuario
${question}

## Instrucoes
- Responda SOMENTE com base no conteudo acima
- Se nao encontrar a resposta, diga "Nao encontrei essa informacao na base de conhecimento"
- Seja conciso (maximo 500 palavras)
- Use markdown para formatacao
- Inclua referencia a pagina da KB quando relevante (ex: "Ver: produtos/visionking/arquitetura.md")`;

  return runClaudePrint(prompt, { model: config.model || 'sonnet' });
}
