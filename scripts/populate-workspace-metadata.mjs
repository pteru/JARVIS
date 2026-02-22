#!/usr/bin/env node
/**
 * Populate workspace metadata — auto-detect types and update stub context.md files.
 * Phase 9 of the JARVIS system cleanup.
 *
 * What it does:
 * 1. For each workspace with type="unknown": detect type from file markers, update workspaces.json
 * 2. For each context.md with "No description available": re-extract purpose and tech stack
 */
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, "JARVIS");

async function fileExists(filepath) {
  try { await fs.access(filepath); return true; } catch { return false; }
}

/** Detect the primary workspace type from file markers. */
function inferType(techStack) {
  if (techStack.includes("Angular")) return "angular";
  if (techStack.includes("React") || techStack.includes("Vue") || techStack.includes("Next.js")) return "frontend";
  if (techStack.includes("NestJS") || techStack.includes("Node.js (Express)")) return "backend";
  if (techStack.includes("Python")) return "python";
  if (techStack.includes("Rust")) return "rust";
  if (techStack.includes("Go")) return "go";
  if (techStack.includes("Java")) return "java";
  if (techStack.includes("C/C++")) return "native";
  if (techStack.includes("Node.js")) return "nodejs";
  if (techStack.includes("Docker")) return "infra";
  return "unknown";
}

async function detectTechStack(workspacePath) {
  const stack = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    let framework = "Node.js";
    if (allDeps["@angular/core"]) framework = "Angular";
    else if (allDeps["react"]) framework = "React";
    else if (allDeps["vue"]) framework = "Vue";
    else if (allDeps["express"]) framework = "Node.js (Express)";
    else if (allDeps["next"]) framework = "Next.js";
    else if (allDeps["nestjs"] || allDeps["@nestjs/core"]) framework = "NestJS";
    stack.push(framework);
  } catch { /* no package.json */ }
  for (const f of ["requirements.txt", "pyproject.toml", "setup.py"]) {
    if (await fileExists(path.join(workspacePath, f))) { stack.push("Python"); break; }
  }
  if (await fileExists(path.join(workspacePath, "Cargo.toml"))) stack.push("Rust");
  if (await fileExists(path.join(workspacePath, "go.mod"))) stack.push("Go");
  if (await fileExists(path.join(workspacePath, "pom.xml"))) stack.push("Java");
  if (await fileExists(path.join(workspacePath, "Makefile"))) {
    try {
      const { stdout } = await execAsync(
        `find . -maxdepth 2 -name "*.c" -o -name "*.cpp" -o -name "*.h" | head -1`,
        { cwd: workspacePath, timeout: 5000 },
      );
      if (stdout.trim()) stack.push("C/C++");
    } catch { /* ignore */ }
  }
  if (await fileExists(path.join(workspacePath, "Dockerfile")) ||
      await fileExists(path.join(workspacePath, "docker-compose.yml"))) {
    stack.push("Docker");
  }
  return stack.length > 0 ? stack : ["Unknown"];
}

async function extractPurpose(workspacePath) {
  try {
    const readme = await fs.readFile(path.join(workspacePath, "README.md"), "utf-8");
    const lines = readme.split("\n");
    let heading = "", paragraph = "", foundHeading = false;
    for (const line of lines) {
      if (!foundHeading && line.startsWith("#")) { heading = line.replace(/^#+\s*/, "").trim(); foundHeading = true; continue; }
      if (foundHeading && line.trim() && !line.startsWith("#")) { paragraph = line.trim(); break; }
    }
    if (heading || paragraph) return [heading, paragraph].filter(Boolean).join(" - ");
  } catch { /* no README */ }

  // Fallback: try package.json description
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf-8"));
    if (pkg.description) return pkg.description;
  } catch { /* ignore */ }

  return null;
}

async function main() {
  const configPath = path.join(ORCHESTRATOR_HOME, "config", "orchestrator", "workspaces.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf-8"));

  const stats = { typesUpdated: 0, contextUpdated: 0, inaccessible: 0 };

  for (const [name, ws] of Object.entries(config.workspaces)) {
    if (!(await fileExists(ws.path))) {
      stats.inaccessible++;
      continue;
    }

    const techStack = await detectTechStack(ws.path);
    const purpose = await extractPurpose(ws.path);

    // 1. Update type if "unknown"
    if (ws.type === "unknown") {
      const detected = inferType(techStack);
      if (detected !== "unknown") {
        config.workspaces[name].type = detected;
        stats.typesUpdated++;
        console.log(`  [type] ${name}: unknown → ${detected} (${techStack.join(", ")})`);
      }
    }

    // 2. Update stub context.md
    const contextPath = path.join(ws.path, ".claude", "context.md");
    if (await fileExists(contextPath)) {
      const content = await fs.readFile(contextPath, "utf-8");
      if (content.includes("No description available") && purpose) {
        const updated = content.replace(
          /No description available.*$/m,
          purpose,
        );
        if (updated !== content) {
          const updatedWithStack = updated.replace(
            /- \(none yet -- add goals here\)/,
            techStack.map(t => `- ${t}`).join("\n"),
          );
          // Only update Purpose and Tech Stack sections
          const finalContent = updated.replace(
            /## Tech Stack\n[\s\S]*?(?=\n## )/,
            `## Tech Stack\n${techStack.map(t => `- ${t}`).join("\n")}\n\n`,
          );
          await fs.writeFile(contextPath, finalContent, "utf-8");
          stats.contextUpdated++;
          console.log(`  [context] ${name}: updated purpose + tech stack`);
        }
      }
    }
  }

  // Write updated workspaces.json
  if (stats.typesUpdated > 0) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`\nUpdated workspaces.json with ${stats.typesUpdated} type changes`);
  }

  console.log(`\n=== Metadata Population Summary ===`);
  console.log(`  Types updated:    ${stats.typesUpdated}`);
  console.log(`  Contexts updated: ${stats.contextUpdated}`);
  console.log(`  Inaccessible:     ${stats.inaccessible}`);

  // Show remaining unknowns
  const remaining = Object.entries(config.workspaces).filter(([, ws]) => ws.type === "unknown");
  if (remaining.length > 0) {
    console.log(`\n  Still unknown (${remaining.length}):`);
    for (const [n] of remaining) { console.log(`    - ${n}`); }
  }
}

main().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
