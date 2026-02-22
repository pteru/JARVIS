# Product Context Loader — Shared Template

All product skills (diemaster, spotfusion, visionking, strokmatic) follow this pattern:

## Loading Steps

1. Read `{PRODUCT_PATH}/.claude/context.md` — architecture, tech stack, known issues
2. Read `{PRODUCT_PATH}/.claude/CLAUDE.md` — project conventions, coding guidelines
3. Read `{PRODUCT_PATH}/.claude/backlog.md` — current task backlog with priorities (if exists)
4. Optionally explore `{PRODUCT_PATH}/architecture/` for diagrams

## After Loading

Provide a brief summary confirming:
- Pipeline architecture type and key services
- Current backlog priorities (if loaded)
- Confirm readiness to work on tasks

## Creating a New Product Skill

Copy an existing skill (e.g., `diemaster/SKILL.md`) and update:
- `name` and `description` in YAML frontmatter
- File paths to point to the new product workspace
- Summary bullet points with product-specific architecture details
