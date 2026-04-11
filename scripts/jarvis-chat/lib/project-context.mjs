import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || `${process.env.HOME}/JARVIS`;
const MAX_BUNDLE_CHARS = 16000;

export function loadStaticProjectContext(projectCode, product) {
  const sources = [];
  let totalChars = 0;

  const tryAdd = (label, content) => {
    if (!content) return;
    const remaining = MAX_BUNDLE_CHARS - totalChars;
    if (remaining <= 0) return;
    const trimmed = content.length > remaining
      ? content.slice(0, remaining) + '\n…[truncated]'
      : content;
    sources.push({ label, content: trimmed });
    totalChars += trimmed.length;
  };

  if (product === 'visionking') {
    const vkLatest = join(ORCHESTRATOR_HOME, 'reports/vk-health', projectCode, 'latest.md');
    if (existsSync(vkLatest)) {
      tryAdd(`reports/vk-health/${projectCode}/latest.md`, readFileSync(vkLatest, 'utf-8'));
    }
  }

  const pmoMdDir = join(ORCHESTRATOR_HOME, 'workspaces/strokmatic/pmo', projectCode, 'reports/md');
  if (existsSync(pmoMdDir)) {
    try {
      const files = readdirSync(pmoMdDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ f, mtime: statSync(join(pmoMdDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        tryAdd(`pmo/${projectCode}/reports/${files[0].f}`, readFileSync(join(pmoMdDir, files[0].f), 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  return { sources, totalChars, remainingChars: MAX_BUNDLE_CHARS - totalChars };
}
