---
name: gslides
description: Create, read, or edit a Google Slides presentation via the google-workspace MCP server
argument-hint: "<url-or-title> [action]"
---

# Google Slides Skill

Interact with Google Slides using the `google-workspace` MCP server tools.

## Available MCP Tools

- `create_presentation` — Create a new presentation
- `add_slide` — Add a slide with layout, title, and body content
- `read_presentation` — Read presentation structure and text content

## How to Parse Arguments

1. **URL or Presentation ID** (contains `presentation/d/` or `slides.google.com`):
   - Default action: call `read_presentation`, display slide-by-slide summary (slide number, layout, title, body excerpt)
   - If followed by `add <title>`: call `add_slide` with that title, ask for body content and layout

2. **Plain title** (no URL pattern):
   - Call `create_presentation` with that title
   - Optionally accept a `template_id` if user specifies one

3. **"add slide"** after a URL/ID:
   - Call `add_slide` with the presentation ID
   - Ask for layout if not specified. Common layouts: `TITLE`, `TITLE_AND_BODY`, `TITLE_AND_TWO_COLUMNS`, `SECTION_HEADER`, `BLANK`

## Presentation Display

- Show each slide as a numbered section:
  ```
  ### Slide 1 — [Title]
  Layout: TITLE_AND_BODY
  > Body text excerpt...
  ```
- Note total slide count and presentation title

## Defaults

- `auth_mode`: `"service_account"`
- Default layout for new slides: `TITLE_AND_BODY`

## Examples

```
/gslides "Product Demo Q1 2026"
→ Creates a new presentation

/gslides https://docs.google.com/presentation/d/1abc.../edit
→ Reads and summarizes all slides

/gslides 1abc... add "Architecture Overview"
→ Adds a new slide with that title, prompts for body content
```
