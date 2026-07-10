---
type: Implementation Plan
title: Weld Inspection Grouping Viewer — Implementation Plan
description: Run: `cd viewer && npm install && npm run dev` Expected: Vite dev server at http://localhost:5173, dark page with 'Inspection Grouping Viewer' header
timestamp: 2026-04-09
---

# Weld Inspection Grouping Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based 3D viewer for browsing weld grouping optimization results — showing welds on the car body colored by group/status, camera positions with FOV cones, data tables, and camera POV simulation.

**Architecture:** Standalone TypeScript app using Three.js for 3D rendering and vanilla web components for UI. Served by a lightweight Express backend that loads the optimizer JSON results and mesh files. No framework dependency (Angular/React) — keeps it portable and fast to build. Follows Strokmatic Design System colors and typography.

**Tech Stack:** Three.js (3D), Express (API), TypeScript, Vite (bundler), STL/GLTF mesh loading

---

## File Structure

```
workspaces/strokmatic/sdk/sdk-inspection-grouping-optimizer/viewer/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html                          # Entry point
├── src/
│   ├── main.ts                         # App bootstrap
│   ├── types.ts                        # Shared interfaces
│   ├── theme.ts                        # Strokmatic design tokens
│   ├── api.ts                          # Data loading (fetch JSON/mesh)
│   ├── scene/
│   │   ├── scene-manager.ts            # Three.js scene setup, camera, controls
│   │   ├── body-mesh.ts                # Load and render STL/GLTF body mesh
│   │   ├── weld-points.ts              # Render weld spheres with group colors
│   │   ├── camera-cones.ts             # Render camera position cones + FOV rects
│   │   └── raycaster.ts               # Click picking for welds and cameras
│   ├── panels/
│   │   ├── sidebar.ts                  # Left sidebar: layer toggles + legend
│   │   ├── weld-table.ts              # Weld data table (bottom panel)
│   │   ├── camera-table.ts            # Camera positions table
│   │   ├── camera-pov-modal.ts        # Camera POV simulation modal
│   │   └── info-panel.ts              # Selected item detail panel
│   └── styles/
│       ├── reset.css                   # CSS reset
│       ├── theme.css                   # Strokmatic variables
│       └── layout.css                  # App layout grid
├── server/
│   ├── index.ts                        # Express server
│   └── data-loader.ts                 # Load and merge optimizer results
├── public/
│   └── models/                        # Mesh files (GLTF/STL)
└── tests/
    ├── types.test.ts
    ├── data-loader.test.ts
    └── weld-points.test.ts
```

---

### Task 1: Project scaffold and dev server

**Files:**
- Create: `viewer/package.json`
- Create: `viewer/tsconfig.json`
- Create: `viewer/vite.config.ts`
- Create: `viewer/index.html`
- Create: `viewer/src/main.ts`
- Create: `viewer/src/types.ts`
- Create: `viewer/src/theme.ts`
- Create: `viewer/src/styles/reset.css`
- Create: `viewer/src/styles/theme.css`
- Create: `viewer/src/styles/layout.css`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "inspection-grouping-viewer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "server": "tsx server/index.ts"
  },
  "dependencies": {
    "three": "^0.172.0",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/three": "^0.172.0",
    "@types/express": "^5.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*", "server/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3900',
    },
  },
});
```

- [ ] **Step 4: Create theme.css with Strokmatic design tokens**

```css
/* viewer/src/styles/theme.css */
:root {
  /* Strokmatic primary palette */
  --sk-primary: #003f6b;
  --sk-primary-light: #4d7979;
  --sk-primary-dark: #001b3c;
  --sk-accent: #45d8ac;
  --sk-accent-light: #a2ecd6;

  /* Status colors */
  --sk-success: #11c56e;
  --sk-warning: #f0b23d;
  --sk-error: #ea4435;

  /* Weld group colors (20 distinct) */
  --weld-g0: #1f77b4; --weld-g1: #ff7f0e; --weld-g2: #2ca02c;
  --weld-g3: #d62728; --weld-g4: #9467bd; --weld-g5: #8c564b;
  --weld-g6: #e377c2; --weld-g7: #bcbd22; --weld-g8: #17becf;
  --weld-g9: #7f7f7f; --weld-g10: #aec7e8; --weld-g11: #ffbb78;
  --weld-g12: #98df8a; --weld-g13: #ff9896; --weld-g14: #c5b0d5;
  --weld-g15: #c49c94; --weld-g16: #f7b6d2; --weld-g17: #dbdb8d;
  --weld-g18: #9edae5; --weld-g19: #b3b3b3;

  /* Weld status colors */
  --weld-accessible: #45d8ac;
  --weld-blocked-one: #f0b23d;
  --weld-blocked-both: #ea4435;
  --weld-ungrouped: #ff6666;

  /* Surfaces */
  --bg-dark: #1a1a2e;
  --bg-panel: #16213e;
  --bg-card: #0f3460;
  --bg-input: #1a1a3e;
  --text-primary: #e8e8e8;
  --text-secondary: #a0a0b0;
  --text-muted: #666680;
  --border: #2a2a4a;
  --border-hover: #3a3a6a;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Spacing */
  --sp-xs: 4px; --sp-sm: 8px; --sp-md: 16px; --sp-lg: 24px; --sp-xl: 32px;

  /* Radius */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
}
```

- [ ] **Step 5: Create layout.css**

```css
/* viewer/src/styles/layout.css */
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg-dark);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
}

#app {
  display: grid;
  grid-template-columns: 280px 1fr;
  grid-template-rows: 48px 1fr 280px;
  grid-template-areas:
    "sidebar header"
    "sidebar viewport"
    "sidebar tables";
  height: 100vh;
}

#header {
  grid-area: header;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 var(--sp-md);
  gap: var(--sp-md);
}

#sidebar {
  grid-area: sidebar;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: var(--sp-md);
}

#viewport {
  grid-area: viewport;
  position: relative;
  overflow: hidden;
}

#tables {
  grid-area: tables;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  display: flex;
  gap: 1px;
  overflow: hidden;
}

.table-panel {
  flex: 1;
  overflow: auto;
  padding: var(--sp-sm);
}

/* Header */
#header h1 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

#header .stats {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* Sidebar sections */
.sidebar-section {
  margin-bottom: var(--sp-lg);
}

.sidebar-section h3 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin: 0 0 var(--sp-sm) 0;
}

/* Layer toggle */
.layer-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-xs) 0;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}

.layer-toggle input[type="checkbox"] {
  accent-color: var(--sk-accent);
}

.color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}

/* Data tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: var(--font-mono);
}

.data-table th {
  text-align: left;
  padding: var(--sp-xs) var(--sp-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-weight: 600;
  position: sticky;
  top: 0;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: var(--sp-xs) var(--sp-sm);
  border-bottom: 1px solid var(--border);
}

.data-table tr:hover td {
  background: var(--bg-input);
}

.data-table tr.selected td {
  background: rgba(69, 216, 172, 0.15);
}

/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 80vw;
  height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-md);
  border-bottom: 1px solid var(--border);
}

.modal-body {
  flex: 1;
  overflow: hidden;
}

/* Info panel (floating, top-right of viewport) */
.info-panel {
  position: absolute;
  top: var(--sp-md);
  right: var(--sp-md);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-md);
  min-width: 240px;
  font-size: 12px;
  z-index: 10;
  backdrop-filter: blur(8px);
  background: rgba(22, 33, 62, 0.9);
}

.info-panel .label {
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-panel .value {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
}

/* Buttons */
.btn {
  padding: var(--sp-xs) var(--sp-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-sans);
  transition: background 0.15s, border-color 0.15s;
}

.btn:hover {
  background: var(--bg-input);
  border-color: var(--border-hover);
}

.btn-primary {
  background: var(--sk-primary);
  border-color: var(--sk-primary);
}

.btn-primary:hover {
  background: var(--sk-primary-light);
}
```

- [ ] **Step 6: Create reset.css**

```css
/* viewer/src/styles/reset.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body { line-height: 1.5; -webkit-font-smoothing: antialiased; }
img, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg-dark); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
```

- [ ] **Step 7: Create types.ts**

```typescript
// viewer/src/types.ts

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WeldPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  zone: string;
  desc: string;
  panels: number;
  accessibleEol: boolean;
  accessiblePos: boolean;
  accessibleNeg: boolean;
  groupId: number | null;    // null = ungrouped
  cameraId: string | null;
}

export interface CameraView {
  groupId: number;
  cameraId: string;
  position: Vec3;
  direction: Vec3;
  workingDistance: number;
  fovWidth: number;
  fovHeight: number;
  weldIds: string[];
  weldDetails: WeldDetail[];
}

export interface WeldDetail {
  weldId: string;
  angleFromNormal: number;
  distanceFromFovBorder: number;
  pixelDiameter: number;
}

export interface GroupingResult {
  summary: {
    totalWelds: number;
    totalGroups: number;
    coveragePct: number;
    solver: string;
    camerasUsed: string[];
  };
  groups: CameraView[];
  ungrouped: { weldId: string; reason: string }[];
  weldPoints: Record<string, { x: number; y: number; z: number; nx: number; ny: number; nz: number }>;
}

export interface ObstructionInfo {
  dir: string;
  distMm: number;
  panelStation: string;
  addedAfterWeld: boolean;
}

export interface WeldObstruction {
  id: string;
  zone: string;
  desc: string;
  x: number;
  y: number;
  z: number;
  weldStation: string;
  accessiblePos: boolean;
  accessibleNeg: boolean;
  accessibleEol: boolean;
  obstructions: ObstructionInfo[];
}

export type WeldStatus = 'grouped' | 'ungrouped' | 'blocked-one' | 'blocked-both';

export interface LayerVisibility {
  mesh: boolean;
  groupedWelds: boolean;
  ungroupedWelds: boolean;
  blockedWelds: boolean;
  cameras: boolean;
  fovRects: boolean;
  normals: boolean;
}

export interface AppState {
  layers: LayerVisibility;
  selectedWeldId: string | null;
  selectedGroupId: number | null;
  highlightedGroupId: number | null;
}
```

- [ ] **Step 8: Create theme.ts**

```typescript
// viewer/src/theme.ts

export const GROUP_COLORS = [
  0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0xbcbd22, 0x17becf, 0x7f7f7f,
  0xaec7e8, 0xffbb78, 0x98df8a, 0xff9896, 0xc5b0d5,
  0xc49c94, 0xf7b6d2, 0xdbdb8d, 0x9edae5, 0xb3b3b3,
];

export const STATUS_COLORS = {
  grouped: 0x45d8ac,
  ungrouped: 0xff6666,
  blockedOne: 0xf0b23d,
  blockedBoth: 0xea4435,
  mesh: 0x888888,
  camera: 0xffffff,
  fov: 0xffcc00,
  normal: 0x00ff88,
};

export function groupColor(groupId: number): number {
  return GROUP_COLORS[groupId % GROUP_COLORS.length];
}

export function groupColorCss(groupId: number): string {
  const hex = GROUP_COLORS[groupId % GROUP_COLORS.length];
  return '#' + hex.toString(16).padStart(6, '0');
}
```

- [ ] **Step 9: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Inspection Grouping Viewer — Strokmatic</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="app">
    <div id="header">
      <h1>Inspection Grouping Viewer</h1>
      <span class="stats" id="header-stats"></span>
    </div>
    <div id="sidebar"></div>
    <div id="viewport">
      <canvas id="three-canvas"></canvas>
      <div class="info-panel" id="info-panel" style="display:none"></div>
    </div>
    <div id="tables">
      <div class="table-panel" id="weld-table-panel"></div>
      <div class="table-panel" id="camera-table-panel"></div>
    </div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 10: Create main.ts stub**

```typescript
// viewer/src/main.ts
import './styles/reset.css';
import './styles/theme.css';
import './styles/layout.css';

console.log('Inspection Grouping Viewer loaded');
```

- [ ] **Step 11: Install dependencies and verify dev server**

Run: `cd viewer && npm install && npm run dev`
Expected: Vite dev server at http://localhost:5173, dark page with "Inspection Grouping Viewer" header

- [ ] **Step 12: Commit**

```bash
git add viewer/
git commit -m "feat(viewer): scaffold project with Strokmatic design tokens"
```

---

### Task 2: Express data server

**Files:**
- Create: `viewer/server/index.ts`
- Create: `viewer/server/data-loader.ts`
- Test: `viewer/tests/data-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// viewer/tests/data-loader.test.ts
import { describe, it, expect } from 'vitest';
import { mergeResults } from '../server/data-loader';

describe('mergeResults', () => {
  it('merges obstruction and grouping data into unified weld list', () => {
    const obstruction = [{
      id: '1087', zone: 'Body Main Assy', desc: 'BodyMain Assy #660 R6601',
      x: 3781.23, y: -271.12, z: 230.4,
      weld_station: 'Body Main (#660)', accessible_eol: true,
      accessible_pos: true, accessible_neg: false,
      obstructions: [],
    }];
    const grouping = {
      summary: { total_welds: 1, total_groups: 1, coverage_pct: 100, solver: 'greedy', cameras_used: ['SC-16mm'] },
      groups: [{
        group_id: 0, camera_id: 'SC-16mm',
        camera_position: { x: 3800, y: -280, z: 260 },
        camera_direction: { x: -1, y: 0, z: 0 },
        working_distance_mm: 500, fov_width_mm: 160, fov_height_mm: 135,
        weld_ids: ['1087'], weld_details: [{ weld_id: '1087', angle_from_normal_deg: 5.2, distance_from_fov_border_mm: 40, pixel_diameter: 22 }],
      }],
      ungrouped: [],
      weld_points: { '1087': { x: 3781.23, y: -271.12, z: 230.4, nx: -1, ny: 0, nz: 0 } },
    };

    const result = mergeResults(obstruction, grouping);
    expect(result.welds).toHaveLength(1);
    expect(result.welds[0].groupId).toBe(0);
    expect(result.welds[0].accessibleEol).toBe(true);
    expect(result.cameras).toHaveLength(1);
    expect(result.cameras[0].weldIds).toContain('1087');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd viewer && npx vitest run tests/data-loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement data-loader.ts**

```typescript
// viewer/server/data-loader.ts
import type { WeldPoint, CameraView, GroupingResult, WeldObstruction, WeldStatus } from '../src/types';

interface MergedData {
  welds: WeldPoint[];
  cameras: CameraView[];
  summary: GroupingResult['summary'];
  ungrouped: { weldId: string; reason: string }[];
}

export function mergeResults(
  obstructions: WeldObstruction[],
  grouping: GroupingResult,
): MergedData {
  // Build weld→group lookup
  const weldToGroup = new Map<string, number>();
  const weldToCamera = new Map<string, string>();

  for (const g of grouping.groups) {
    for (const wid of g.weldIds ?? g.weld_ids ?? []) {
      weldToGroup.set(wid, g.groupId ?? g.group_id);
      weldToCamera.set(wid, g.cameraId ?? g.camera_id);
    }
  }

  const ungroupedSet = new Set(
    (grouping.ungrouped ?? []).map((u: any) => u.weldId ?? u.weld_id),
  );

  // Build obstruction lookup
  const obsMap = new Map<string, WeldObstruction>();
  for (const o of obstructions) {
    obsMap.set(o.id, o);
  }

  // Merge into unified weld list
  const welds: WeldPoint[] = [];
  const weldPoints = grouping.weldPoints ?? grouping.weld_points ?? {};

  for (const obs of obstructions) {
    const wp = weldPoints[obs.id];
    const groupId = weldToGroup.get(obs.id) ?? null;
    const cameraId = weldToCamera.get(obs.id) ?? null;

    welds.push({
      id: obs.id,
      x: obs.x,
      y: obs.y,
      z: obs.z,
      nx: wp?.nx ?? 0,
      ny: wp?.ny ?? 0,
      nz: wp?.nz ?? 0,
      zone: obs.zone,
      desc: obs.desc,
      panels: 0,
      accessibleEol: obs.accessibleEol ?? obs.accessible_eol,
      accessiblePos: obs.accessiblePos ?? obs.accessible_pos,
      accessibleNeg: obs.accessibleNeg ?? obs.accessible_neg,
      groupId,
      cameraId,
    });
  }

  // Normalize camera views
  const cameras: CameraView[] = (grouping.groups ?? []).map((g: any) => ({
    groupId: g.groupId ?? g.group_id,
    cameraId: g.cameraId ?? g.camera_id,
    position: g.cameraPosition ?? g.camera_position,
    direction: g.cameraDirection ?? g.camera_direction,
    workingDistance: g.workingDistanceMm ?? g.working_distance_mm,
    fovWidth: g.fovWidthMm ?? g.fov_width_mm,
    fovHeight: g.fovHeightMm ?? g.fov_height_mm,
    weldIds: g.weldIds ?? g.weld_ids ?? [],
    weldDetails: (g.weldDetails ?? g.weld_details ?? []).map((d: any) => ({
      weldId: d.weldId ?? d.weld_id,
      angleFromNormal: d.angleFromNormalDeg ?? d.angle_from_normal_deg,
      distanceFromFovBorder: d.distanceFromFovBorderMm ?? d.distance_from_fov_border_mm,
      pixelDiameter: d.pixelDiameter ?? d.pixel_diameter,
    })),
  }));

  const summary = {
    totalWelds: grouping.summary?.total_welds ?? grouping.summary?.totalWelds ?? welds.length,
    totalGroups: grouping.summary?.total_groups ?? grouping.summary?.totalGroups ?? cameras.length,
    coveragePct: grouping.summary?.coverage_pct ?? grouping.summary?.coveragePct ?? 0,
    solver: grouping.summary?.solver ?? 'greedy',
    camerasUsed: grouping.summary?.cameras_used ?? grouping.summary?.camerasUsed ?? [],
  };

  return {
    welds,
    cameras,
    summary,
    ungrouped: (grouping.ungrouped ?? []).map((u: any) => ({
      weldId: u.weldId ?? u.weld_id,
      reason: u.reason ?? 'unknown',
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd viewer && npx vitest run tests/data-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Create Express server**

```typescript
// viewer/server/index.ts
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { mergeResults } from './data-loader';

const app = express();
const PORT = 3900;

// Paths to data files (configurable via env)
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../results/nissan-p42q-eol-16mm');
const OBSTRUCTION_FILE = process.env.OBSTRUCTION_FILE ?? '/tmp/nissan-obstruction-analysis-v2.json';
const MESH_FILE = process.env.MESH_FILE ?? '/tmp/nissan-body-decimated.stl';

app.use(express.json());

// Serve static mesh files
app.get('/api/mesh', (_req, res) => {
  res.sendFile(path.resolve(MESH_FILE));
});

// Serve merged inspection data
app.get('/api/data', (_req, res) => {
  try {
    const grouping = JSON.parse(readFileSync(path.join(DATA_DIR, 'result.json'), 'utf-8'));
    const obstructions = JSON.parse(readFileSync(OBSTRUCTION_FILE, 'utf-8'));
    const merged = mergeResults(obstructions, grouping);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Inspection viewer API at http://localhost:${PORT}`);
});
```

- [ ] **Step 6: Run server and verify API**

Run: `cd viewer && npx tsx server/index.ts &`
Run: `curl -s http://localhost:3900/api/data | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Welds: {len(d[\"welds\"])}, Cameras: {len(d[\"cameras\"])}')" `
Expected: `Welds: 3330, Cameras: 284`

- [ ] **Step 7: Commit**

```bash
git add viewer/server/ viewer/tests/
git commit -m "feat(viewer): Express API serving merged inspection data"
```

---

### Task 3: Three.js scene with body mesh

**Files:**
- Create: `viewer/src/api.ts`
- Create: `viewer/src/scene/scene-manager.ts`
- Create: `viewer/src/scene/body-mesh.ts`
- Modify: `viewer/src/main.ts`

- [ ] **Step 1: Create api.ts**

```typescript
// viewer/src/api.ts
import type { WeldPoint, CameraView } from './types';

interface ApiData {
  welds: WeldPoint[];
  cameras: CameraView[];
  summary: { totalWelds: number; totalGroups: number; coveragePct: number; solver: string; camerasUsed: string[] };
  ungrouped: { weldId: string; reason: string }[];
}

let cachedData: ApiData | null = null;

export async function fetchData(): Promise<ApiData> {
  if (cachedData) return cachedData;
  const res = await fetch('/api/data');
  cachedData = await res.json();
  return cachedData!;
}

export async function fetchMesh(): Promise<ArrayBuffer> {
  const res = await fetch('/api/mesh');
  return res.arrayBuffer();
}
```

- [ ] **Step 2: Create scene-manager.ts**

```typescript
// viewer/src/scene/scene-manager.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;

  private animationId: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    const rect = canvas.parentElement!.getBoundingClientRect();
    this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 1, 50000);
    this.camera.position.set(6000, -3000, 3000);
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(rect.width, rect.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(1800, 0, 600);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.update();

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5000, -3000, 5000);
    this.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
    dir2.position.set(-3000, 2000, 1000);
    this.scene.add(dir2);

    // Axes helper
    const axes = new THREE.AxesHelper(500);
    this.scene.add(axes);

    // Grid
    const grid = new THREE.GridHelper(8000, 40, 0x333355, 0x222244);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Resize handler
    const onResize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      this.camera.aspect = r.width / r.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(r.width, r.height);
    };
    window.addEventListener('resize', onResize);

    this.animate();
  }

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  lookAt(target: THREE.Vector3, distance: number = 1000) {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.controls.target.copy(target);
    this.controls.update();
  }

  setCameraPOV(position: THREE.Vector3, direction: THREE.Vector3) {
    this.camera.position.copy(position);
    const target = position.clone().addScaledVector(direction, 500);
    this.controls.target.copy(target);
    this.controls.update();
  }
}
```

- [ ] **Step 3: Create body-mesh.ts**

```typescript
// viewer/src/scene/body-mesh.ts
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export function loadBodyMesh(
  buffer: ArrayBuffer,
  scene: THREE.Scene,
): THREE.Mesh {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  geometry.computeVertexNormals();

  // Clip to reasonable body range
  // (decimated mesh may have degenerate faces outside car bounds)

  const material = new THREE.MeshPhongMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'body-mesh';
  scene.add(mesh);
  return mesh;
}

export function setMeshVisibility(scene: THREE.Scene, visible: boolean) {
  const mesh = scene.getObjectByName('body-mesh');
  if (mesh) mesh.visible = visible;
}
```

- [ ] **Step 4: Wire up main.ts**

```typescript
// viewer/src/main.ts
import './styles/reset.css';
import './styles/theme.css';
import './styles/layout.css';

import { SceneManager } from './scene/scene-manager';
import { loadBodyMesh } from './scene/body-mesh';
import { fetchData, fetchMesh } from './api';

async function init() {
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
  const statsEl = document.getElementById('header-stats')!;

  // Size canvas to viewport
  const viewport = document.getElementById('viewport')!;
  canvas.width = viewport.clientWidth;
  canvas.height = viewport.clientHeight;

  const scene = new SceneManager(canvas);

  // Load data and mesh in parallel
  const [data, meshBuffer] = await Promise.all([fetchData(), fetchMesh()]);

  // Render body mesh
  loadBodyMesh(meshBuffer, scene.scene);

  // Update header stats
  const grouped = data.welds.filter(w => w.groupId !== null).length;
  const blocked = data.welds.filter(w => !w.accessibleEol).length;
  statsEl.textContent = `${data.welds.length} welds | ${data.cameras.length} cameras | ${grouped} grouped | ${blocked} blocked`;

  console.log('Scene initialized', data.summary);
}

init().catch(console.error);
```

- [ ] **Step 5: Verify 3D viewport renders body mesh**

Run: `cd viewer && npm run dev` (with server running)
Expected: Dark viewport with semi-transparent gray body mesh, orbit controls work

- [ ] **Step 6: Commit**

```bash
git add viewer/src/
git commit -m "feat(viewer): Three.js scene with STL body mesh"
```

---

### Task 4: Weld point rendering with status colors

**Files:**
- Create: `viewer/src/scene/weld-points.ts`
- Modify: `viewer/src/main.ts`

- [ ] **Step 1: Create weld-points.ts**

```typescript
// viewer/src/scene/weld-points.ts
import * as THREE from 'three';
import type { WeldPoint, WeldStatus } from '../types';
import { groupColor, STATUS_COLORS } from '../theme';

const SPHERE_RADIUS = 4;
const SPHERE_SEGMENTS = 8;

export function getWeldStatus(w: WeldPoint): WeldStatus {
  if (!w.accessibleEol) {
    if (!w.accessiblePos && !w.accessibleNeg) return 'blocked-both';
    return 'blocked-one';
  }
  if (w.groupId !== null) return 'grouped';
  return 'ungrouped';
}

function getWeldColor(w: WeldPoint): number {
  const status = getWeldStatus(w);
  if (status === 'grouped') return groupColor(w.groupId!);
  if (status === 'ungrouped') return STATUS_COLORS.ungrouped;
  if (status === 'blocked-one') return STATUS_COLORS.blockedOne;
  return STATUS_COLORS.blockedBoth;
}

export class WeldLayer {
  private groups = new Map<WeldStatus, THREE.Group>();
  private meshMap = new Map<string, THREE.Mesh>();
  private sphereGeo: THREE.SphereGeometry;

  constructor(private scene: THREE.Scene) {
    this.sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS, SPHERE_SEGMENTS);

    for (const status of ['grouped', 'ungrouped', 'blocked-one', 'blocked-both'] as WeldStatus[]) {
      const group = new THREE.Group();
      group.name = `welds-${status}`;
      this.scene.add(group);
      this.groups.set(status, group);
    }
  }

  addWelds(welds: WeldPoint[]) {
    for (const w of welds) {
      const status = getWeldStatus(w);
      const color = getWeldColor(w);
      const material = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
      const mesh = new THREE.Mesh(this.sphereGeo, material);
      mesh.position.set(w.x, w.y, w.z);
      mesh.userData = { weldId: w.id, type: 'weld' };
      mesh.name = `weld-${w.id}`;

      this.groups.get(status)!.add(mesh);
      this.meshMap.set(w.id, mesh);
    }
  }

  setStatusVisibility(status: WeldStatus, visible: boolean) {
    const group = this.groups.get(status);
    if (group) group.visible = visible;
  }

  highlightWeld(weldId: string) {
    // Reset all
    for (const [, mesh] of this.meshMap) {
      mesh.scale.setScalar(1);
    }
    const mesh = this.meshMap.get(weldId);
    if (mesh) {
      mesh.scale.setScalar(2.5);
    }
  }

  highlightGroup(groupId: number, welds: WeldPoint[]) {
    for (const [, mesh] of this.meshMap) {
      (mesh.material as THREE.MeshPhongMaterial).opacity = 0.2;
      (mesh.material as THREE.MeshPhongMaterial).transparent = true;
    }
    const groupWelds = welds.filter(w => w.groupId === groupId);
    for (const w of groupWelds) {
      const mesh = this.meshMap.get(w.id);
      if (mesh) {
        (mesh.material as THREE.MeshPhongMaterial).opacity = 1.0;
        (mesh.material as THREE.MeshPhongMaterial).transparent = false;
      }
    }
  }

  clearHighlight() {
    for (const [, mesh] of this.meshMap) {
      mesh.scale.setScalar(1);
      (mesh.material as THREE.MeshPhongMaterial).opacity = 1.0;
      (mesh.material as THREE.MeshPhongMaterial).transparent = false;
    }
  }

  getPickableObjects(): THREE.Object3D[] {
    return Array.from(this.meshMap.values());
  }
}
```

- [ ] **Step 2: Wire into main.ts**

Add after body mesh loading:

```typescript
import { WeldLayer } from './scene/weld-points';

// ... inside init():
const weldLayer = new WeldLayer(scene.scene);
weldLayer.addWelds(data.welds);
```

- [ ] **Step 3: Verify welds render on body with correct colors**

Expected: Body mesh with colored spheres — green (grouped), red (ungrouped), yellow/red (blocked)

- [ ] **Step 4: Commit**

```bash
git add viewer/src/scene/weld-points.ts viewer/src/main.ts
git commit -m "feat(viewer): weld point rendering with group/status colors"
```

---

### Task 5: Camera cones and FOV rectangles

**Files:**
- Create: `viewer/src/scene/camera-cones.ts`
- Modify: `viewer/src/main.ts`

- [ ] **Step 1: Create camera-cones.ts**

```typescript
// viewer/src/scene/camera-cones.ts
import * as THREE from 'three';
import type { CameraView } from '../types';
import { groupColor } from '../theme';

export class CameraLayer {
  private coneGroup: THREE.Group;
  private fovGroup: THREE.Group;
  private coneMap = new Map<number, THREE.Object3D[]>();

  constructor(private scene: THREE.Scene) {
    this.coneGroup = new THREE.Group();
    this.coneGroup.name = 'cameras';
    this.scene.add(this.coneGroup);

    this.fovGroup = new THREE.Group();
    this.fovGroup.name = 'fov-rects';
    this.fovGroup.visible = false; // hidden by default
    this.scene.add(this.fovGroup);
  }

  addCameras(cameras: CameraView[]) {
    for (const cam of cameras) {
      const color = groupColor(cam.groupId);
      const objects: THREE.Object3D[] = [];

      const pos = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z);
      const dir = new THREE.Vector3(cam.direction.x, cam.direction.y, cam.direction.z).normalize();

      // Camera cone
      const coneHeight = cam.workingDistance * 0.12;
      const coneRadius = coneHeight * 0.3;
      const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 8);
      const coneMat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.7 });
      const cone = new THREE.Mesh(coneGeo, coneMat);

      // Orient cone: default cone points along +Y, we want it along -dir
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().negate(),
      );
      cone.quaternion.copy(quat);
      cone.position.copy(pos).addScaledVector(dir, coneHeight * 0.5);
      cone.userData = { groupId: cam.groupId, type: 'camera' };
      this.coneGroup.add(cone);
      objects.push(cone);

      // Camera origin sphere
      const sphereGeo = new THREE.SphereGeometry(3, 6, 6);
      const sphereMat = new THREE.MeshPhongMaterial({ color });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.copy(pos);
      sphere.userData = { groupId: cam.groupId, type: 'camera' };
      this.coneGroup.add(sphere);
      objects.push(sphere);

      // FOV rectangle at working distance
      const center = pos.clone().addScaledVector(dir, cam.workingDistance);
      const upHint = new THREE.Vector3(0, 0, 1);
      if (Math.abs(dir.dot(upHint)) > 0.99) upHint.set(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, upHint).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();

      const hw = cam.fovWidth / 2;
      const hh = cam.fovHeight / 2;
      const corners = [
        center.clone().addScaledVector(right, -hw).addScaledVector(up, -hh),
        center.clone().addScaledVector(right, hw).addScaledVector(up, -hh),
        center.clone().addScaledVector(right, hw).addScaledVector(up, hh),
        center.clone().addScaledVector(right, -hw).addScaledVector(up, hh),
      ];

      // Wireframe rectangle
      const rectGeo = new THREE.BufferGeometry().setFromPoints([...corners, corners[0]]);
      const rectLine = new THREE.LineLoop(rectGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
      this.fovGroup.add(rectLine);
      objects.push(rectLine);

      // Frustum lines from camera to corners
      for (const corner of corners) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([pos, corner]);
        const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }));
        this.fovGroup.add(line);
        objects.push(line);
      }

      this.coneMap.set(cam.groupId, objects);
    }
  }

  setConeVisibility(visible: boolean) {
    this.coneGroup.visible = visible;
  }

  setFovVisibility(visible: boolean) {
    this.fovGroup.visible = visible;
  }

  highlightCamera(groupId: number) {
    for (const [gid, objects] of this.coneMap) {
      const dim = gid !== groupId;
      for (const obj of objects) {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineLoop) {
          const mat = obj.material as THREE.Material;
          mat.opacity = dim ? 0.1 : 1.0;
          mat.transparent = true;
          mat.needsUpdate = true;
        }
      }
    }
  }

  clearHighlight() {
    for (const [, objects] of this.coneMap) {
      for (const obj of objects) {
        if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.MeshPhongMaterial).opacity = 0.7;
        }
      }
    }
  }

  getPickableObjects(): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    for (const [, objects] of this.coneMap) {
      for (const obj of objects) {
        if (obj instanceof THREE.Mesh) result.push(obj);
      }
    }
    return result;
  }
}
```

- [ ] **Step 2: Wire into main.ts and verify**

- [ ] **Step 3: Commit**

```bash
git add viewer/src/scene/camera-cones.ts viewer/src/main.ts
git commit -m "feat(viewer): camera cones and FOV rectangle rendering"
```

---

### Task 6: Sidebar with layer toggles and legend

**Files:**
- Create: `viewer/src/panels/sidebar.ts`
- Modify: `viewer/src/main.ts`

_(Sidebar with checkboxes for: Mesh, Grouped Welds, Ungrouped Welds, Blocked Welds, Cameras, FOV Rects, Normals. Plus zone legend with counts.)_

---

### Task 7: Weld data table and camera data table

**Files:**
- Create: `viewer/src/panels/weld-table.ts`
- Create: `viewer/src/panels/camera-table.ts`
- Modify: `viewer/src/main.ts`

_(Bottom panel split: left = weld table (ID, X, Y, Z, zone, status, group), right = camera table (group ID, camera, position 6DOF, FOV, welds count). Click row → highlight in 3D + scroll to other table.)_

---

### Task 8: Click picking and info panel

**Files:**
- Create: `viewer/src/scene/raycaster.ts`
- Create: `viewer/src/panels/info-panel.ts`
- Modify: `viewer/src/main.ts`

_(Click weld → info panel shows: ID, coords, normal, zone, group, angle, pixel dia. Click camera → shows: 6DOF, FOV, covered welds count, working distance.)_

---

### Task 9: Camera POV modal

**Files:**
- Create: `viewer/src/panels/camera-pov-modal.ts`
- Modify: `viewer/src/main.ts`

_(Double-click camera or click "View POV" button → modal with a second Three.js renderer showing what the camera sees. Camera positioned at the exact camera_position, looking along camera_direction. FOV matches the camera spec. Body mesh + weld points visible. Welds in this group highlighted.)_

---

### Task 10: Polish and integration

**Files:**
- Modify: `viewer/src/main.ts`
- Create: `viewer/README.md`

_(Add: keyboard shortcuts (R=reset camera, G=toggle groups, F=toggle FOV), zone filter dropdown in header, export selected group data as CSV, responsive resize handling, loading spinner.)_

---

## Summary

| Task | Component | Estimate |
|------|-----------|----------|
| 1 | Project scaffold + design tokens | 15 min |
| 2 | Express data server | 15 min |
| 3 | Three.js scene + body mesh | 15 min |
| 4 | Weld point rendering | 15 min |
| 5 | Camera cones + FOV | 15 min |
| 6 | Sidebar toggles + legend | 15 min |
| 7 | Data tables | 20 min |
| 8 | Click picking + info panel | 15 min |
| 9 | Camera POV modal | 20 min |
| 10 | Polish + integration | 15 min |

Tasks 6-10 are described at high level above. The full code will be written during implementation. The first 5 tasks have complete code and are ready to execute.
