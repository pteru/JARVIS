# Autonomous Task Execution

You are running inside an isolated JARVIS sandbox container. You have full
permissions to execute any command, edit any file, and install any package.
Work autonomously until the task is complete.

## Task
{{TASK}}

## Specification
{{SPEC_CONTENTS}}

## Working Directory
/workspace (a fresh clone of the JARVIS repository on a feature branch)

## Guidelines
1. Read CLAUDE.md first to understand project conventions
2. Implement the task following existing code patterns
3. Run tests after implementing changes (if a test framework exists)
4. Run linters if available (ruff for Python, eslint for Node.js)
5. Commit your changes with descriptive messages (use Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>)
6. If you create new files, make sure they follow the existing directory structure
7. When done, verify your work with `git log --oneline` and `git diff --stat` against the base branch

## Constraints
- Do NOT push to any remote
- Do NOT modify files outside /workspace (except /output/ for the report)
- Do NOT run destructive git commands (reset --hard, clean -f)
- Commit all meaningful changes before finishing
- If you encounter blockers you cannot resolve, document them in the report

## Implementation Report (MANDATORY)

After completing your work (or if you get stuck), you MUST write a detailed implementation
report to `/output/REPORT.md` as your FINAL action before exiting. This is the primary
deliverable alongside your code — the person reviewing your work will read this report
to understand what happened.

The report must follow this structure:

```markdown
# Implementation Report

## Task
<What was asked — one sentence summary>

## Approach
<How you decided to tackle this. What did you read/explore first? What patterns did you follow?>

## Exploration & Findings
<What you discovered about the codebase that informed your decisions.
Existing patterns, relevant files, conventions you followed or deviated from.>

## Implementation
<What you built/changed. Describe each file and why.
Include code snippets for key decisions.>

## Tests & Validation
<What checks did you run? Linter results, test results, manual verification.
If something failed, what was it and how did you fix it?>

## Issues & Resolutions
<Problems you hit during implementation. Error messages, wrong assumptions,
things that didn't work on first try. How you resolved each one.
If anything remains unresolved, say so clearly.>

## Files Changed
<List every file added/modified/deleted with a one-line description of the change>

## Lessons Learned
<What would be useful to know for future tasks in this codebase?
Patterns to follow, pitfalls to avoid, things that surprised you.>
```

Write this report AFTER committing your code changes but BEFORE saying "Task complete".
Do NOT commit the report to git — write it directly to `/output/REPORT.md`.
