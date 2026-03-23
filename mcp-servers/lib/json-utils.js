/**
 * Shared JSON file I/O utilities for MCP servers and Node.js scripts.
 * Usage: import { readJson, writeJson, readJsonSafe } from '../lib/json-utils.js';
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export async function readJson(filePath) {
  const data = await readFile(filePath, 'utf-8');
  return JSON.parse(data);
}

export async function writeJson(filePath, data, indent = 2) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, indent) + '\n', 'utf-8');
}

export async function readJsonSafe(filePath, defaultValue = null) {
  try {
    return await readJson(filePath);
  } catch {
    return defaultValue;
  }
}
