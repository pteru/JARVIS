/**
 * Shared `claude --print` invocation for JARVIS chat bots.
 * Prompt is piped via stdin (never as a CLI arg — house rule).
 */
import { spawn } from 'child_process';

/**
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.model]     model id/alias (default claude-sonnet-4-6)
 * @param {number} [opts.maxTurns]  --max-turns value (default 1)
 * @returns {Promise<string>} trimmed stdout
 */
export function runClaudePrint(prompt, { model = 'claude-sonnet-4-6', maxTurns = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '--print',
      '--model', model,
      '--max-turns', String(maxTurns),
    ], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(err));
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`claude --print exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
