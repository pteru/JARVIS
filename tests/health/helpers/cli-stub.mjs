import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Installs a fake binary on PATH that records argv and emits canned output.
 * Returns { dir, logFile, env, readArgs(), cleanup() }.
 *
 * Control the stub via the returned env object (merge into process.env or child env):
 *   <NAME>_STUB_OUT   — text printed to stdout on each invocation
 *   <NAME>_STUB_EXIT  — exit code (default 0; use 1 to simulate failure)
 *   <NAME>_STUB_LOG   — automatically set to the internal log file
 *
 * <NAME> is the binary name uppercased (e.g. "sshpass" → "SSHPASS").
 *
 * @param {string} name  - The binary name to install (e.g. "sshpass", "gh", "ping")
 * @param {string} [prefix] - Optional tmpdir prefix for the sandbox directory
 */
export function installCliStub(name, prefix) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const nameUpper = safeName.toUpperCase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix ?? `${safeName}-stub-`));
  const logFile = path.join(dir, 'argv.log');
  const binPath = path.join(dir, name);

  fs.writeFileSync(binPath, `#!/usr/bin/env bash
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo '==='; } >> "\${${nameUpper}_STUB_LOG:-/dev/null}"
[[ -n "\${${nameUpper}_STUB_OUT:-}" ]] && printf '%s\\n' "\${${nameUpper}_STUB_OUT}"
exit "\${${nameUpper}_STUB_EXIT:-0}"
`, { mode: 0o755 });

  const env = {
    [`${nameUpper}_STUB_LOG`]: logFile,
    PATH: `${dir}:${process.env.PATH}`,
  };

  return {
    dir,
    logFile,
    env,
    /**
     * Returns an array of invocations; each invocation is an array of argument strings.
     */
    readArgs() {
      if (!fs.existsSync(logFile)) return [];
      return fs
        .readFileSync(logFile, 'utf-8')
        .split('===\n')
        .map(s => s.trim().split('\n').filter(Boolean))
        .filter(a => a.length);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
