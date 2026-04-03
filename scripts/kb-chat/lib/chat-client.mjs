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
      '--max-turns', '1',
      '--allowedTools', `mcp__google-workspace__${toolName}`
    ], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`MCP tool ${toolName} failed`));
      else resolve(stdout.trim());
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
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
  // Parse result — format depends on MCP server output
  try {
    const parsed = JSON.parse(result);
    return (parsed.messages || []).filter(m => {
      if (!sinceTimestamp) return true;
      return new Date(m.createTime) > new Date(sinceTimestamp);
    });
  } catch {
    return [];
  }
}

/**
 * Send a reply to a Chat space (optionally in a thread)
 * @param {string} spaceName - Space ID
 * @param {string} text - Message text (markdown supported)
 * @param {string} threadName - Optional thread ID for threaded reply
 */
export async function sendReply(spaceName, text, threadName) {
  const args = { space_name: spaceName, text };
  if (threadName) args.thread_name = threadName;
  await callMcpTool('send_chat_message', args);
}

/**
 * List all available Chat spaces
 * @returns {Promise<Array>} - Spaces
 */
export async function listSpaces() {
  const result = await callMcpTool('list_chat_spaces', {});
  try {
    return JSON.parse(result).spaces || [];
  } catch {
    return [];
  }
}
