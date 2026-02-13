# Claude Orchestrator - Self-Improvement Backlog

Ideas for new features, skills, and integrations. Details to be expanded before implementation.

---

## New Skills / MCP Servers

### ClickUp Connector

- **Status:** Idea
- **Description:** Integrate with ClickUp using their official MCP Server to sync tasks, backlogs, and status updates between the orchestrator and ClickUp workspaces.

#### ClickUp Structure

**Spaces in scope:**

| Space     | Purpose                                                        |
| --------- | -------------------------------------------------------------- |
| `TÉCNICO` | Low-level task tracking per product                            |
| `ROADMAP` | High-level project phase visualization across products (Gantt) |

Other spaces should be read and mapped for awareness but are not part of the active workflow.

---

**TÉCNICO — Structure:**

Each product has **two folders**: a regular folder and a sprint folder.

| Product     | Regular Folder     | Sprint Folder      |
| ----------- | ------------------ | ------------------ |
| Smart Die   | `[01] SMART DIE`   | `[01] SMART DIE`   |
| Spot Fusion | `[02] SPOT FUSION` | `[02] SPOT FUSION` |
| Vision King | `[03] VISION KING` | `[03] VISION KING` |

**Regular folder** contains:

- One list per **project**, named `[0X00X] Project Name` (e.g. `[01001] Project Alpha`)
- One list per **major product area**, e.g. `[01] Documentação`, `[02] Hardware`

**Sprint folder** contains sprint lists. Tasks are created in the regular folder lists and then **added to the corresponding sprint** in the sprint folder.

Task workflow: `Create in regular list → Add to active sprint list`

---

**ROADMAP — Structure:**

- No folders — flat structure with one **list per product**
- Each list item (task) = a **project**
- Subtasks of that item = **project phases**
- Primary visualization: **Gantt chart**

---

#### Implementation Notes

- Start by evaluating the official ClickUp MCP Server capabilities and mapping them to the structure above
- Key operations needed: read spaces/folders/lists, create/update tasks, add task to sprint, read/update Gantt subtasks
- The connector should respect the `TÉCNICO` task workflow (create in list, assign to sprint) and not bypass it

### Changelog Reviewer

- **Status:** Idea
- **Description:** A skill that reads pending changelog entries and generates a structured report showing how the changes should be organized into branches and commits. The report must be reviewed and explicitly authorized by the user before any changes are deployed.
- **Notes:** Acts as a gate between "changes recorded" and "changes deployed". Should output a proposed branching/commit strategy in a human-readable format for approval.

---

## Improvements

<!-- Add improvement ideas here -->
