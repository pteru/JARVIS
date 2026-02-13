# Spec: Changelog Reviewer

**Status:** Idea
**Type:** New MCP Server / Skill
**ClickUp ID:** _(not yet created)_

## Overview

A skill that reads pending changelog entries and generates a structured report proposing how the recorded changes should be organized into branches and commits. The report must be reviewed and **explicitly authorized by the user** before any changes are deployed.

Acts as a gate between "changes recorded" and "changes deployed".

---

## Required Capabilities

- Read pending (unreleased) entries from workspace changelogs
- Analyze the changes and group them into logical commits and branches
- Output a human-readable branching and commit strategy report
- Await explicit user approval before any git operations are performed
- Once approved, optionally execute or guide the deployment of the approved plan

---

## Implementation Notes

- The approval gate is non-negotiable: no branch or commit is created without user sign-off
- Report format TBD — likely Markdown with proposed branch names, commit messages, and file groupings
- Details to be expanded before implementation
