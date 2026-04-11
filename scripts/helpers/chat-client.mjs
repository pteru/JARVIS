import { spawn } from 'child_process';

/**
 * Call a Google Workspace MCP tool via claude --print
 * @param {string} toolName - MCP tool name (e.g., 'list_chat_messages')
 * @param {object} args - Tool arguments
 * @returns {Promise<string>} - Tool output
 */
async function callMcpTool(toolName, args) {
  const prompt = `Call the MCP tool ${toolName} with these exact arguments: ${JSON.stringify(args)}. Return ONLY the raw tool output, nothing else.`;

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', 'haiku',
      '--max-turns', '3',
      '--allowedTools', `mcp__google-workspace__${toolName}`
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`MCP tool ${toolName} failed (exit ${code}): ${stderr.trim() || stdout.trim().slice(0, 200)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// claude --print sometimes wraps JSON tool output in ```json ... ``` fences;
// strip those before parsing.
function stripJsonFences(text) {
  if (typeof text !== 'string') return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

function parseJsonOrEmpty(raw) {
  try {
    return JSON.parse(stripJsonFences(raw));
  } catch {
    return null;
  }
}

/**
 * List recent messages in a Chat space
 * @param {string} spaceName - Space ID (spaces/XXXXX)
 * @param {string} sinceTimestamp - ISO timestamp to filter from
 * @returns {Promise<Array>} - Messages
 */
export async function listRecentMessages(spaceName, sinceTimestamp) {
  const result = await callMcpTool('list_chat_messages', {
    space_name: spaceName,
    page_size: 25
  });
  const parsed = parseJsonOrEmpty(result);
  if (!parsed || !Array.isArray(parsed.messages)) return [];
  return parsed.messages.filter(m => {
    if (!sinceTimestamp) return true;
    return new Date(m.createTime) > new Date(sinceTimestamp);
  });
}

/**
 * Send a reply to a Chat space (optionally in a thread).
 * Returns the new message metadata when available, or null on parse failure.
 * Callers should record the returned `name` to dedupe on the next poll —
 * the google-workspace MCP impersonates the operator user, so bot replies
 * are indistinguishable from human messages by sender alone.
 * @param {string} spaceName - Space ID
 * @param {string} text - Message text (markdown supported)
 * @param {string} threadName - Optional thread ID for threaded reply
 * @returns {Promise<{name: string}|null>}
 */
export async function sendReply(spaceName, text, threadName) {
  const args = { space_name: spaceName, text };
  if (threadName) args.thread_name = threadName;
  const result = await callMcpTool('send_chat_message', args);
  return parseJsonOrEmpty(result);
}

/**
 * List all available Chat spaces
 * @returns {Promise<Array>} - Spaces
 */
export async function listSpaces() {
  const result = await callMcpTool('list_chat_spaces', {});
  const parsed = parseJsonOrEmpty(result);
  return parsed?.spaces || [];
}
