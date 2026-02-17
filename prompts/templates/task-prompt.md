You are working on the **{{WORKSPACE_NAME}}** workspace.

## Task
{{TASK_DESCRIPTION}}

## Complexity
{{COMPLEXITY}}

## Instructions
1. Read the workspace's CLAUDE.md for project-specific guidelines
2. Read `.claude/context.md` for product architecture, pipeline details, and conventions
3. If this workspace is a service within a monorepo, read the monorepo's `.claude/backlog.md` for task context and priorities
4. For architecture-related tasks, check the `architecture/` directory for diagrams and documentation
5. Understand the existing code before making changes
6. Implement the task with minimal, focused changes
7. Run tests if a test framework is configured
8. Update the changelog using the changelog-writer MCP tool
9. Mark the backlog task as complete using the backlog-manager MCP tool

## Quality Checklist
- [ ] Changes are minimal and focused
- [ ] Existing tests still pass
- [ ] No new linting or type errors
- [ ] Changelog entry added
- [ ] Backlog updated
- [ ] Verified correct git branch before committing (never commit directly to develop/main)
