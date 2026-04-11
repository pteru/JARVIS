import { readFileSync, existsSync } from 'fs';

export function loadRegistry(configPath) {
  if (!existsSync(configPath)) return { spaces: {} };
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return { spaces: {} };
  }
}

export function lookupSpace(registry, spaceId) {
  return registry.spaces?.[spaceId] || null;
}

export function isWarned(state, spaceId) {
  return Boolean(state.warned_unmapped?.[spaceId]);
}

export function markWarned(state, spaceId) {
  if (!state.warned_unmapped) state.warned_unmapped = {};
  state.warned_unmapped[spaceId] = new Date().toISOString();
}
