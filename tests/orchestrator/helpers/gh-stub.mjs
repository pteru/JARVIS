import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Installs a fake `gh` on PATH that records argv and emits canned output.
 * Returns { dir, logFile, env, readArgs(), cleanup() }.
 * Control the stub via the returned env object (merge into process.env or child env):
 *   GH_STUB_LIST_JSON  — file path whose contents are emitted for `gh issue list`
 *   GH_STUB_CREATE_URL — URL emitted for `gh issue create`
 *   GH_STUB_EXIT       — exit code (default 0; use 1 to simulate failure)
 */
export function installGhStub(prefix = 'gh-stub-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const logFile = path.join(dir, 'argv.log');
  const ghPath = path.join(dir, 'gh');
  fs.writeFileSync(ghPath, `#!/usr/bin/env bash
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo '==='; } >> "\${GH_STUB_LOG:-/dev/null}"
sub="$1 $2"
case "$sub" in
  "issue list")   if [[ -n "\${GH_STUB_LIST_JSON:-}" ]]; then cat "\${GH_STUB_LIST_JSON}"; else echo '[]'; fi ;;
  "issue create") echo "\${GH_STUB_CREATE_URL:-https://github.com/o/r/issues/1}" ;;
  *) : ;;
esac
exit "\${GH_STUB_EXIT:-0}"
`, { mode: 0o755 });
  const env = { GH_STUB_LOG: logFile, PATH: `${dir}:${process.env.PATH}` };
  return {
    dir, logFile, env,
    readArgs() {
      if (!fs.existsSync(logFile)) return [];
      return fs.readFileSync(logFile, 'utf-8').split('===\n').map(s => s.trim().split('\n').filter(Boolean)).filter(a => a.length);
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
