import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";

/**
 * Verify that a file exists at the specified path.
 * criterion: { type: "file_exists", path: string }
 */
export async function verifyFileExists(criterion, workspacePath) {
  const filePath = path.isAbsolute(criterion.path)
    ? criterion.path
    : path.join(workspacePath, criterion.path);
  try {
    await fs.access(filePath);
    return { passed: true, message: `File exists: ${criterion.path}` };
  } catch {
    return { passed: false, message: `File not found: ${criterion.path}` };
  }
}

/**
 * Verify that a command exits successfully.
 * criterion: { type: "command_success", command: string }
 */
export async function verifyCommandSuccess(criterion, workspacePath) {
  return new Promise((resolve) => {
    exec(
      criterion.command,
      { cwd: workspacePath, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            passed: false,
            message: `Command failed: ${criterion.command}\n${stderr || error.message}`,
          });
        } else {
          resolve({
            passed: true,
            message: `Command succeeded: ${criterion.command}`,
          });
        }
      },
    );
  });
}

/**
 * Verify that a file contains content matching a regex pattern.
 * criterion: { type: "content_match", path: string, pattern: string }
 */
export async function verifyContentMatch(criterion, workspacePath) {
  const filePath = path.isAbsolute(criterion.path)
    ? criterion.path
    : path.join(workspacePath, criterion.path);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const regex = new RegExp(criterion.pattern);
    if (regex.test(content)) {
      return {
        passed: true,
        message: `Content match found in ${criterion.path} for pattern: ${criterion.pattern}`,
      };
    } else {
      return {
        passed: false,
        message: `Content match not found in ${criterion.path} for pattern: ${criterion.pattern}`,
      };
    }
  } catch (err) {
    return {
      passed: false,
      message: `Could not read ${criterion.path}: ${err.message}`,
    };
  }
}

/**
 * Dispatch verification to the appropriate handler based on criterion type.
 */
export async function verifyCriterion(criterion, workspacePath) {
  switch (criterion.type) {
    case "file_exists":
      return verifyFileExists(criterion, workspacePath);
    case "command_success":
      return verifyCommandSuccess(criterion, workspacePath);
    case "content_match":
      return verifyContentMatch(criterion, workspacePath);
    case "test_pass":
      return verifyCommandSuccess(
        { ...criterion, command: criterion.command || "npm test" },
        workspacePath,
      );
    default:
      return {
        passed: false,
        message: `Unknown criterion type: ${criterion.type}`,
      };
  }
}
