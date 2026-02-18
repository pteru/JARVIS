---
name: mermaid
description: Apply Strokmatic color themes to Mermaid diagrams (Gantt, flowchart, sequence, etc.)
---

# Mermaid Diagram Styling

When creating or editing Mermaid diagrams for Strokmatic projects, apply the standard color themes below.

## Dark Theme — Flowcharts & Topology Diagrams

```
classDef default fill:#1f1f1f,stroke:#fff,stroke-width:1px,color:#fff;
classDef weld fill:#333333,stroke:#b0b0b0,stroke-width:2px,color:#fff;
classDef camBlue fill:#0d2b4e,stroke:#00d2ff,stroke-width:2px,color:#fff;
classDef camYellow fill:#4a2c0f,stroke:#ff9800,stroke-width:4px,color:#fff;
classDef success fill:#1b3a1b,stroke:#00e676,stroke-width:2px,color:#fff;
classDef danger fill:#3a1b1b,stroke:#ff1744,stroke-width:2px,color:#fff;
linkStyle default stroke:#666,stroke-width:1px;
```

Subgraph styling:
```
style SUBGRAPH_NAME fill:#121212,stroke:#666,stroke-width:2px,color:#fff
```

Accent borders for key subgraphs:
- Green (`stroke:#00e676`) — main production line / spine
- Purple (`stroke:#aa00ff`) — framing / assembly
- Default grey (`stroke:#666`) — standard grouping

## Dark Theme — Gantt Charts

Use `%%{init}` block at the top of the Gantt definition:

```
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#0d2b4e',
    'primaryTextColor': '#ffffff',
    'primaryBorderColor': '#00d2ff',
    'secondaryColor': '#333333',
    'secondaryTextColor': '#ffffff',
    'secondaryBorderColor': '#b0b0b0',
    'tertiaryColor': '#1f1f1f',
    'tertiaryTextColor': '#ffffff',
    'tertiaryBorderColor': '#666666',
    'lineColor': '#666666',
    'textColor': '#ffffff',
    'todayLineColor': '#ff9800',
    'gridColor': '#333333',
    'doneColor': '#1b3a1b',
    'doneBorderColor': '#00e676',
    'critColor': '#3a1b1b',
    'critBorderColor': '#ff1744',
    'activeColor': '#2a2a3d',
    'activeBorderColor': '#aa00ff',
    'sectionBkgColor': '#121212',
    'sectionBkgColor2': '#1a1a1a',
    'altSectionBkgColor': '#243b6a',
    'taskBkgColor': '#0d2b4e',
    'taskBorderColor': '#00d2ff',
    'taskTextColor': '#ffffff',
    'activeTaskBkgColor': '#2a2a3d',
    'activeTaskBorderColor': '#aa00ff',
    'doneTaskBkgColor': '#1b3a1b',
    'doneTaskBorderColor': '#00e676',
    'critBkgColor': '#3a1b1b',
    'critBorderColor': '#ff1744',
    'milestoneColor': '#ff9800',
    'milestoneBorderColor': '#ff9800'
  }
}}%%
```

## Color Palette Reference

| Token | Hex | Usage |
|---|---|---|
| `#121212` | Near-black | Background, section fill (odd) |
| `#243b6a` | Slate blue | Section fill (even), alternating background |
| `#1f1f1f` | Dark grey | Default node fill |
| `#333333` | Mid-dark grey | Secondary elements, grid |
| `#0d2b4e` | Deep blue | Primary nodes, active tasks, camera stations |
| `#00d2ff` | Cyan | Primary borders, active borders |
| `#ff9800` | Orange | Highlights, today line, milestones, camera-yellow accent |
| `#4a2c0f` | Dark amber | Yellow-accent node fill |
| `#00e676` | Green | Success, done tasks, main line accent |
| `#1b3a1b` | Dark green | Done task fill |
| `#ff1744` | Red | Critical path, danger |
| `#3a1b1b` | Dark red | Critical task fill |
| `#aa00ff` | Purple | Framing/assembly accent, TBD items (dashed border) |
| `#2a2a3d` | Dark purple | TBD/unconfirmed item fill |
| `#b0b0b0` | Light grey | Secondary borders, weld nodes |
| `#666666` | Grey | Links, tertiary borders |
| `#ffffff` | White | Text |

## Gantt Dependency Flowchart Convention

Mermaid Gantt charts do not render dependency arrows. **Every Gantt chart must be accompanied by a dependency flowchart** (`graph LR`) placed directly below it, showing task relationships explicitly.

### Structure
- Use `graph LR` (left-to-right) for readability
- Group tasks into subgraphs matching the Gantt sections
- Apply alternating subgraph backgrounds (`#121212` / `#243b6a`) matching the Gantt
- Use class styles to color-code by category:
  - `acq` (grey) — procurement/acquisition tasks
  - `dev` (blue) — software development tasks
  - `mec` (amber) — mechanical assembly tasks
  - `integ` (green) — integration/commissioning tasks
  - `crit` (red) — critical path items
  - `tbd` (purple dashed) — items with unconfirmed estimates or pending specification
  - `mile` (orange border) — milestones (use `(("label"))` for double-circle shape)
- Draw arrows for all `after` dependencies from the Gantt, including **cross-section dependencies**
- Place cross-section dependency arrows after all subgraphs, under a `%% CROSS-SECTION DEPENDENCIES` comment

### Example classDefs
```
classDef default fill:#1f1f1f,stroke:#fff,stroke-width:1px,color:#fff;
classDef acq fill:#333333,stroke:#b0b0b0,stroke-width:2px,color:#fff;
classDef dev fill:#0d2b4e,stroke:#00d2ff,stroke-width:2px,color:#fff;
classDef mec fill:#4a2c0f,stroke:#ff9800,stroke-width:2px,color:#fff;
classDef integ fill:#1b3a1b,stroke:#00e676,stroke-width:2px,color:#fff;
classDef crit fill:#3a1b1b,stroke:#ff1744,stroke-width:2px,color:#fff;
classDef tbd fill:#2a2a3d,stroke:#aa00ff,stroke-width:2px,stroke-dasharray:5 3,color:#ccc;
classDef mile fill:#1f1f1f,stroke:#ff9800,stroke-width:3px,color:#ff9800;
linkStyle default stroke:#666,stroke-width:1px;
```

## Gantt Chart Rules

- **After any Gantt chart edit, re-validate all `crit` flags.** Trace the actual critical path (longest chain to the final milestone) by summing durations along each dependency chain. Only tasks on the true critical path should have `:crit`. Tasks that are high-risk or important but not schedule-critical should use their section's default style, not `crit`. If a companion dependency flowchart exists, update its `:::crit` classes to match.

## Usage Notes

- Always use `'theme': 'base'` to override Mermaid defaults completely
- These colors are optimized for dark backgrounds (GitHub dark mode, Mermaid Live dark, etc.)
- For light-background rendering, invert text colors and lighten fills as needed
- The palette is derived from the SpotFusion deploy toolkit production charts
