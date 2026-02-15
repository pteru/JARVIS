#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME || path.join(process.env.HOME, "claude-orchestrator");

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
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
    if (await fileExists(path.join(workspacePath, f))) {
      stack.push("Python");
      break;
    }
  }

  if (await fileExists(path.join(workspacePath, "Cargo.toml"))) stack.push("Rust");
  if (await fileExists(path.join(workspacePath, "go.mod"))) stack.push("Go");
  if (await fileExists(path.join(workspacePath, "pom.xml"))) stack.push("Java");

  if (await fileExists(path.join(workspacePath, "Makefile"))) {
    try {
      const { stdout } = await execAsync(
        `find . -maxdepth 2 -name "*.c" -o -name "*.cpp" -o -name "*.h" | head -1`,
        { cwd: workspacePath },
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
    let heading = "";
    let paragraph = "";
    let foundHeading = false;

    for (const line of lines) {
      if (!foundHeading && line.startsWith("#")) {
        heading = line.replace(/^#+\s*/, "").trim();
        foundHeading = true;
        continue;
      }
      if (foundHeading && line.trim() && !line.startsWith("#")) {
        paragraph = line.trim();
        break;
      }
    }

    if (heading || paragraph) {
      return [heading, paragraph].filter(Boolean).join(" - ");
    }
  } catch { /* no README */ }
  return "No description available (add README.md or update this field)";
}

async function main() {
  const configPath = path.join(ORCHESTRATOR_HOME, "config", "orchestrator", "workspaces.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to read workspaces.json: ${err.message}`);
    process.exit(1);
  }

  const results = { created: [], skipped: [], errors: [] };

  for (const [name, ws] of Object.entries(config.workspaces)) {
    const wsPath = ws.path;

    // Check if workspace path is accessible
    if (!(await fileExists(wsPath))) {
      results.errors.push({ name, path: wsPath, reason: "path not accessible" });
      continue;
    }

    const contextPath = path.join(wsPath, ".claude", "context.md");
    if (await fileExists(contextPath)) {
      results.skipped.push({ name, path: contextPath });
      continue;
    }

    try {
      const techStack = await detectTechStack(wsPath);
      const purpose = await extractPurpose(wsPath);

      const content = `# Workspace Context

## Purpose
${purpose}

## Tech Stack
${techStack.map(t => `- ${t}`).join("\n")}

## Active Goals
<!-- Current development priorities for this workspace -->
- (none yet -- add goals here)

## Constraints
<!-- Important constraints or rules for this workspace -->
- (none yet -- add constraints here)

## Related Workspaces
<!-- Other workspaces this one depends on or interacts with -->
- (none yet -- add related workspaces here)
`;

      await fs.mkdir(path.join(wsPath, ".claude"), { recursive: true });
      await fs.writeFile(contextPath, content, "utf-8");
      results.created.push({ name, path: contextPath, techStack });
    } catch (err) {
      results.errors.push({ name, path: wsPath, reason: err.message });
    }
  }

  console.log("\n=== Bootstrap Context Files Report ===\n");
  console.log(`Created: ${results.created.length}`);
  for (const r of results.created) {
    console.log(`  + ${r.name} [${r.techStack.join(", ")}]`);
  }
  console.log(`\nSkipped (already exists): ${results.skipped.length}`);
  for (const r of results.skipped) {
    console.log(`  ~ ${r.name}`);
  }
  console.log(`\nErrors: ${results.errors.length}`);
  for (const r of results.errors) {
    console.log(`  ! ${r.name}: ${r.reason}`);
  }
}

main().catch(console.error);
