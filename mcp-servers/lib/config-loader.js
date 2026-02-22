/**
 * Central configuration for all JARVIS MCP servers and dashboard parsers.
 * Usage: import { ORCHESTRATOR_HOME, getConfigPath } from '../lib/config-loader.js';
 */
import path from "path";

export const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, "JARVIS");

/** Resolve a file inside config/orchestrator/ */
export const getConfigPath = (filename) =>
  path.join(ORCHESTRATOR_HOME, "config", "orchestrator", filename);
