---
type: Implementation Plan
title: Knowledge Hub — Plan 2: Interactive Dashboard
description: Entity type colors used throughout the dashboard:
timestamp: 2026-04-17
---

# Knowledge Hub — Plan 2: Interactive Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive D3.js knowledge graph dashboard with dark theme, product filters, search, and entity detail panel.

**Architecture:** Static SPA (vanilla HTML/JS/CSS) served by the knowledge-hub server. D3.js v7 force simulation for graph layout. Fetches data from REST API endpoints.

**Tech Stack:** D3.js v7 (CDN), vanilla JS, CSS custom properties, native fetch API

---

## File Structure

### Created

```
services/knowledge-hub/dashboard/
├── index.html          # SPA entry point — HTML shell + layout
├── style.css           # Dark theme, layout grid, responsive
├── graph.js            # D3.js force simulation + rendering
├── panel.js            # Side panel — entity details + relations
└── search.js           # Search bar + results overlay
```

### Modified

```
services/knowledge-hub/lib/server.mjs    # Add static file serving for dashboard
```

---

## Color Palette (from Mermaid skill)

Entity type colors used throughout the dashboard:

| Entity Type | Fill (node bg) | Stroke (border/glow) |
|---|---|---|
| `product` | `#0d2b4e` | `#00d2ff` |
| `project` | `#1b3a1b` | `#00e676` |
| `person` | `#2a2a3d` | `#aa00ff` |
| `client` | `#4a2c0f` | `#ff9800` |
| `equipment` | `#333333` | `#b0b0b0` |
| `deploy` | `#3a1b1b` | `#ff1744` |
| `service` | `#1f1f1f` | `#666666` |

Background: `#121212`. Text: `#ffffff`. Muted text: `#999999`. Panel bg: `#1a1a1a`. Border: `#333333`.

---

## API Endpoints Consumed

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /graph/view?product=...` | `graph.js` | Full node+edge data for D3 rendering |
| `GET /graph/entity/:id` | `panel.js` | Entity detail for side panel |
| `GET /graph/neighbors/:id?depth=2` | `graph.js` | Subgraph expansion on double-click |
| `GET /graph/stats` | `index.html` | Stats footer (entity/relation counts) |
| `GET /search?q=...` | `search.js` | Search results overlay |
| `GET /health` | `index.html` | Connection status indicator |

---

## Phase 1 — HTML Shell + Dark Theme

### Task 1: HTML shell + CSS dark theme + layout structure

**Files:**
- Create: `services/knowledge-hub/dashboard/index.html`
- Create: `services/knowledge-hub/dashboard/style.css`

**Why:** Foundation for all subsequent tasks. Establishes the layout grid, dark theme via CSS custom properties, and placeholder regions for graph canvas, side panel, header bar.

**Test:** Open `index.html` directly in browser. Dark background, header visible, graph area fills viewport, side panel hidden by default.

**Steps:**
- [ ] Create `services/knowledge-hub/dashboard/` directory
- [ ] Create `index.html` with the following structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Hub — Strokmatic</title>
  <link rel="stylesheet" href="/dashboard/style.css">
</head>
<body>
  <header class="header">
    <div class="header-left">
      <h1 class="logo">Knowledge Hub</h1>
      <div class="filter-pills" id="filter-pills">
        <button class="pill active" data-product="all">All</button>
        <button class="pill" data-product="visionking">VK</button>
        <button class="pill" data-product="diemaster">DM</button>
        <button class="pill" data-product="spotfusion">SF</button>
      </div>
    </div>
    <div class="header-right">
      <div class="search-container" id="search-container">
        <input type="text" class="search-input" id="search-input"
               placeholder="Search entities..." autocomplete="off">
        <div class="search-results" id="search-results"></div>
      </div>
      <div class="stats" id="stats"></div>
      <div class="health-dot" id="health-dot" title="API status"></div>
    </div>
  </header>

  <main class="main">
    <div class="graph-container" id="graph-container">
      <svg id="graph-svg"></svg>
      <div class="graph-controls">
        <button class="control-btn" id="zoom-in" title="Zoom in">+</button>
        <button class="control-btn" id="zoom-out" title="Zoom out">&minus;</button>
        <button class="control-btn" id="zoom-reset" title="Reset view">&#8634;</button>
      </div>
      <div class="legend" id="legend"></div>
    </div>
    <aside class="side-panel" id="side-panel">
      <button class="panel-close" id="panel-close">&times;</button>
      <div class="panel-content" id="panel-content">
        <!-- Populated by panel.js -->
      </div>
    </aside>
  </main>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="/dashboard/graph.js"></script>
  <script src="/dashboard/panel.js"></script>
  <script src="/dashboard/search.js"></script>
</body>
</html>
```

- [ ] Create `style.css` with CSS custom properties and full dark theme:

```css
/* ===== CSS Custom Properties ===== */
:root {
  --bg-primary: #121212;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #242424;
  --border-color: #333333;
  --text-primary: #ffffff;
  --text-secondary: #999999;
  --text-muted: #666666;

  /* Entity type colors — fill / stroke */
  --color-product-fill: #0d2b4e;
  --color-product-stroke: #00d2ff;
  --color-project-fill: #1b3a1b;
  --color-project-stroke: #00e676;
  --color-person-fill: #2a2a3d;
  --color-person-stroke: #aa00ff;
  --color-client-fill: #4a2c0f;
  --color-client-stroke: #ff9800;
  --color-equipment-fill: #333333;
  --color-equipment-stroke: #b0b0b0;
  --color-deploy-fill: #3a1b1b;
  --color-deploy-stroke: #ff1744;
  --color-service-fill: #1f1f1f;
  --color-service-stroke: #666666;

  --header-height: 56px;
  --panel-width: 360px;
  --transition-speed: 0.2s;
}

/* ===== Reset ===== */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
}

/* ===== Header ===== */
.header {
  height: var(--header-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 100;
  position: relative;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* ===== Filter Pills ===== */
.filter-pills {
  display: flex;
  gap: 6px;
}

.pill {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 4px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-speed);
  font-family: inherit;
}

.pill:hover {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.pill.active {
  background: var(--color-product-fill);
  border-color: var(--color-product-stroke);
  color: var(--text-primary);
}

/* ===== Search ===== */
.search-container {
  position: relative;
}

.search-input {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 6px 12px;
  font-size: 13px;
  width: 240px;
  outline: none;
  font-family: inherit;
  transition: border-color var(--transition-speed);
}

.search-input:focus {
  border-color: var(--color-product-stroke);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-results {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  width: 360px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-top: 4px;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.search-results.visible {
  display: block;
}

.search-result-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
  transition: background var(--transition-speed);
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: var(--bg-tertiary);
}

.search-result-item .result-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
}

.search-result-item .result-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

.search-result-item .result-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

/* ===== Stats ===== */
.stats {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ===== Health Dot ===== */
.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.health-dot.ok {
  background: var(--color-project-stroke);
}

.health-dot.error {
  background: var(--color-deploy-stroke);
}

/* ===== Main Layout ===== */
.main {
  display: flex;
  height: calc(100vh - var(--header-height));
  position: relative;
}

/* ===== Graph Container ===== */
.graph-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

#graph-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ===== Graph Controls ===== */
.graph-controls {
  position: absolute;
  bottom: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-btn {
  width: 36px;
  height: 36px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-speed);
  font-family: inherit;
}

.control-btn:hover {
  background: var(--bg-tertiary);
}

/* ===== Legend ===== */
.legend {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid;
}

/* ===== Side Panel ===== */
.side-panel {
  width: 0;
  overflow: hidden;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  transition: width var(--transition-speed);
  flex-shrink: 0;
  position: relative;
}

.side-panel.open {
  width: var(--panel-width);
}

.panel-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 22px;
  cursor: pointer;
  z-index: 10;
  line-height: 1;
}

.panel-close:hover {
  color: var(--text-primary);
}

.panel-content {
  padding: 16px;
  width: var(--panel-width);
  height: 100%;
  overflow-y: auto;
}

/* ===== Panel Sections ===== */
.panel-header {
  margin-bottom: 20px;
}

.panel-entity-name {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 4px;
}

.panel-entity-type {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 2px 8px;
  border-radius: 4px;
  display: inline-block;
}

.panel-section {
  margin-bottom: 20px;
}

.panel-section-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}

.panel-property {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.panel-property-key {
  color: var(--text-secondary);
}

.panel-property-value {
  color: var(--text-primary);
  text-align: right;
  max-width: 60%;
  word-break: break-word;
}

.panel-relation {
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  cursor: pointer;
  transition: color var(--transition-speed);
}

.panel-relation:hover {
  color: var(--color-product-stroke);
}

.panel-relation:last-child {
  border-bottom: none;
}

.panel-relation-predicate {
  color: var(--text-muted);
  font-size: 11px;
}

.panel-relation-target {
  color: var(--text-primary);
}

.panel-relation-date {
  color: var(--text-muted);
  font-size: 11px;
  float: right;
}

/* ===== Loading State ===== */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  z-index: 50;
  transition: opacity 0.3s;
}

.loading-overlay.hidden {
  opacity: 0;
  pointer-events: none;
}

.loading-text {
  color: var(--text-secondary);
  font-size: 14px;
}

/* ===== Tooltip ===== */
.tooltip {
  position: absolute;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  pointer-events: none;
  z-index: 300;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  max-width: 250px;
}

.tooltip-name {
  font-weight: 600;
  margin-bottom: 2px;
}

.tooltip-type {
  color: var(--text-secondary);
  font-size: 11px;
  text-transform: uppercase;
}

/* ===== Responsive ===== */
@media (max-width: 768px) {
  .header {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 12px;
    gap: 8px;
  }

  .header-left, .header-right {
    width: 100%;
    justify-content: space-between;
  }

  .search-input {
    width: 160px;
  }

  .search-results {
    width: calc(100vw - 24px);
    right: -12px;
  }

  .side-panel.open {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    z-index: 150;
    width: 100%;
    max-width: var(--panel-width);
  }

  .legend {
    display: none;
  }

  .stats {
    display: none;
  }
}
```

- [ ] Verify the HTML file loads in a browser with correct dark styling, layout regions visible

---

## Phase 2 — D3.js Force Graph

### Task 2: D3.js force graph — fetch data + render nodes/edges

**Files:**
- Create: `services/knowledge-hub/dashboard/graph.js`

**Why:** Core visualization. Fetches graph data from the API endpoint and renders a force-directed layout with D3.js v7.

**Dependencies:** Task 1 (HTML shell must exist).

**Steps:**
- [ ] Create `graph.js` with the module pattern below. The file exposes a global `KnowledgeGraph` object that other modules (`panel.js`, `search.js`) can call into.

```javascript
// graph.js — D3.js force-directed knowledge graph
const KnowledgeGraph = (() => {
  // --- Entity type color map ---
  const TYPE_COLORS = {
    product:   { fill: '#0d2b4e', stroke: '#00d2ff' },
    project:   { fill: '#1b3a1b', stroke: '#00e676' },
    person:    { fill: '#2a2a3d', stroke: '#aa00ff' },
    client:    { fill: '#4a2c0f', stroke: '#ff9800' },
    equipment: { fill: '#333333', stroke: '#b0b0b0' },
    deploy:    { fill: '#3a1b1b', stroke: '#ff1744' },
    service:   { fill: '#1f1f1f', stroke: '#666666' },
  };
  const DEFAULT_COLOR = { fill: '#1f1f1f', stroke: '#666666' };

  // --- State ---
  let svg, container, simulation;
  let nodeElements, linkElements, labelElements;
  let graphData = { nodes: [], edges: [] };
  let currentProduct = 'all';
  let selectedNodeId = null;
  let zoomBehavior;

  // --- Sizing ---
  const MIN_RADIUS = 6;
  const MAX_RADIUS = 28;

  function getColor(type) {
    return TYPE_COLORS[type] || DEFAULT_COLOR;
  }

  // Compute node radius from relation count (log scale, clamped)
  function nodeRadius(d) {
    const count = d._relationCount || 1;
    const r = MIN_RADIUS + Math.log2(count + 1) * 3;
    return Math.min(r, MAX_RADIUS);
  }

  // --- Init ---
  function init() {
    svg = d3.select('#graph-svg');
    const width = svg.node().clientWidth;
    const height = svg.node().clientHeight;

    // Defs for glow filter
    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'blur');
    const merge = filter.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Main group (for zoom/pan transforms)
    container = svg.append('g').attr('class', 'graph-layer');

    // Link group (drawn first = behind nodes)
    container.append('g').attr('class', 'links');
    // Node group
    container.append('g').attr('class', 'nodes');
    // Label group
    container.append('g').attr('class', 'labels');

    // Simulation
    simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 4))
      .on('tick', ticked);

    // Zoom
    zoomBehavior = d3.zoom()
      .scaleExtent([0.1, 6])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });
    svg.call(zoomBehavior);

    // Zoom controls
    d3.select('#zoom-in').on('click', () => svg.transition().call(zoomBehavior.scaleBy, 1.4));
    d3.select('#zoom-out').on('click', () => svg.transition().call(zoomBehavior.scaleBy, 0.7));
    d3.select('#zoom-reset').on('click', resetZoom);

    // Build legend
    buildLegend();

    // Window resize handler
    window.addEventListener('resize', () => {
      const w = svg.node().clientWidth;
      const h = svg.node().clientHeight;
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.1).restart();
    });

    // Load initial data
    loadGraph(currentProduct);
    checkHealth();
  }

  function buildLegend() {
    const legend = d3.select('#legend');
    legend.html('');
    for (const [type, colors] of Object.entries(TYPE_COLORS)) {
      const item = legend.append('div').attr('class', 'legend-item');
      item.append('div')
        .attr('class', 'legend-dot')
        .style('background', colors.fill)
        .style('border-color', colors.stroke);
      item.append('span').text(type);
    }
  }

  // --- Data Loading ---
  async function loadGraph(product) {
    currentProduct = product;
    const url = product === 'all'
      ? '/graph/view'
      : `/graph/view?product=${encodeURIComponent(product)}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      graphData = await resp.json();
      // Pre-compute relation counts
      const counts = {};
      for (const edge of graphData.edges) {
        counts[edge.source] = (counts[edge.source] || 0) + 1;
        counts[edge.target] = (counts[edge.target] || 0) + 1;
      }
      for (const node of graphData.nodes) {
        node._relationCount = counts[node.id] || 0;
      }
      render();
    } catch (err) {
      console.error('Failed to load graph:', err);
    }
  }

  async function loadStats() {
    try {
      const resp = await fetch('/graph/stats');
      if (!resp.ok) return;
      const stats = await resp.json();
      const el = document.getElementById('stats');
      const entities = stats.total_entities || Object.values(stats.by_type || {}).reduce((a, b) => a + b, 0);
      const relations = stats.total_relations || 0;
      el.textContent = `${entities} entities / ${relations} relations`;
    } catch (_) { /* silent */ }
  }

  async function checkHealth() {
    const dot = document.getElementById('health-dot');
    try {
      const resp = await fetch('/health');
      dot.className = resp.ok ? 'health-dot ok' : 'health-dot error';
    } catch (_) {
      dot.className = 'health-dot error';
    }
    loadStats();
  }

  // --- Render ---
  function render() {
    const linkGroup = container.select('.links');
    const nodeGroup = container.select('.nodes');
    const labelGroup = container.select('.labels');

    // Links
    linkElements = linkGroup.selectAll('line')
      .data(graphData.edges, d => `${d.source}-${d.target}-${d.predicate}`)
      .join(
        enter => enter.append('line')
          .attr('stroke', '#444')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.5),
        update => update,
        exit => exit.remove()
      );

    // Nodes
    nodeElements = nodeGroup.selectAll('circle')
      .data(graphData.nodes, d => d.id)
      .join(
        enter => enter.append('circle')
          .attr('r', d => nodeRadius(d))
          .attr('fill', d => getColor(d.type).fill)
          .attr('stroke', d => getColor(d.type).stroke)
          .attr('stroke-width', 2)
          .attr('cursor', 'pointer')
          .call(drag(simulation))
          .on('click', (event, d) => onNodeClick(d))
          .on('dblclick', (event, d) => onNodeDblClick(event, d))
          .on('mouseenter', (event, d) => onNodeHover(d, true))
          .on('mouseleave', (event, d) => onNodeHover(d, false)),
        update => update
          .attr('r', d => nodeRadius(d))
          .attr('fill', d => getColor(d.type).fill)
          .attr('stroke', d => getColor(d.type).stroke),
        exit => exit.remove()
      );

    // Labels (only for nodes with enough relations to be visible)
    labelElements = labelGroup.selectAll('text')
      .data(graphData.nodes, d => d.id)
      .join(
        enter => enter.append('text')
          .text(d => d.name)
          .attr('font-size', d => Math.max(9, Math.min(13, nodeRadius(d))))
          .attr('fill', '#ccc')
          .attr('text-anchor', 'middle')
          .attr('dy', d => nodeRadius(d) + 14)
          .attr('pointer-events', 'none')
          .style('opacity', d => d._relationCount >= 2 ? 1 : 0),
        update => update
          .text(d => d.name)
          .attr('font-size', d => Math.max(9, Math.min(13, nodeRadius(d))))
          .attr('dy', d => nodeRadius(d) + 14)
          .style('opacity', d => d._relationCount >= 2 ? 1 : 0),
        exit => exit.remove()
      );

    // Update simulation
    simulation.nodes(graphData.nodes);
    simulation.force('link').links(graphData.edges);
    simulation.alpha(1).restart();
  }

  function ticked() {
    linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    labelElements
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  }

  // --- Drag ---
  function drag(sim) {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  // --- Zoom ---
  function resetZoom() {
    svg.transition().duration(500).call(
      zoomBehavior.transform,
      d3.zoomIdentity
    );
  }

  // --- Interactions (stubs, completed in later tasks) ---
  function onNodeClick(d) {
    selectedNodeId = d.id;
    highlightNode(d.id);
    // panel.js will hook into this
    if (typeof KnowledgePanel !== 'undefined') {
      KnowledgePanel.showEntity(d.id);
    }
  }

  function onNodeDblClick(event, d) {
    event.stopPropagation();
    // Future: expand neighbors
  }

  function onNodeHover(d, entering) {
    if (entering) {
      highlightConnected(d.id);
      showTooltip(d, d3.event || window.event);
    } else {
      clearHighlight();
      hideTooltip();
    }
  }

  // --- Highlight ---
  function highlightNode(nodeId) {
    selectedNodeId = nodeId;
    nodeElements
      .attr('opacity', d => d.id === nodeId ? 1 : 0.6)
      .attr('filter', d => d.id === nodeId ? 'url(#glow)' : null);
  }

  function highlightConnected(nodeId) {
    const connectedIds = new Set([nodeId]);
    graphData.edges.forEach(e => {
      const src = typeof e.source === 'object' ? e.source.id : e.source;
      const tgt = typeof e.target === 'object' ? e.target.id : e.target;
      if (src === nodeId) connectedIds.add(tgt);
      if (tgt === nodeId) connectedIds.add(src);
    });

    nodeElements.attr('opacity', d => connectedIds.has(d.id) ? 1 : 0.15);
    linkElements.attr('stroke-opacity', d => {
      const src = typeof d.source === 'object' ? d.source.id : d.source;
      const tgt = typeof d.target === 'object' ? d.target.id : d.target;
      return (src === nodeId || tgt === nodeId) ? 0.8 : 0.05;
    });
    labelElements.style('opacity', d => {
      if (connectedIds.has(d.id)) return 1;
      return 0;
    });
  }

  function clearHighlight() {
    if (selectedNodeId) {
      highlightNode(selectedNodeId);
    } else {
      nodeElements.attr('opacity', 1).attr('filter', null);
      linkElements.attr('stroke-opacity', 0.5);
      labelElements.style('opacity', d => d._relationCount >= 2 ? 1 : 0);
    }
  }

  // --- Tooltip ---
  let tooltipEl = null;

  function showTooltip(d, event) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'tooltip';
      document.body.appendChild(tooltipEl);
    }
    const colors = getColor(d.type);
    tooltipEl.innerHTML = `
      <div class="tooltip-name">${d.name}</div>
      <div class="tooltip-type" style="color:${colors.stroke}">${d.type}</div>
      ${d._relationCount ? `<div style="color:#999;font-size:11px;margin-top:2px">${d._relationCount} relation${d._relationCount !== 1 ? 's' : ''}</div>` : ''}
    `;
    tooltipEl.style.display = 'block';
    // Position near the mouse using the underlying pointer event
    const pointer = d3.pointer(event, document.body);
    tooltipEl.style.left = (pointer[0] + 14) + 'px';
    tooltipEl.style.top = (pointer[1] - 10) + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // --- Public API for focus from search ---
  function focusNode(nodeId) {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    selectedNodeId = nodeId;
    highlightNode(nodeId);
    // Pan to node
    const width = svg.node().clientWidth;
    const height = svg.node().clientHeight;
    svg.transition().duration(500).call(
      zoomBehavior.transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(1.5)
        .translate(-node.x, -node.y)
    );
    if (typeof KnowledgePanel !== 'undefined') {
      KnowledgePanel.showEntity(nodeId);
    }
  }

  function clearSelection() {
    selectedNodeId = null;
    clearHighlight();
  }

  function getNodes() {
    return graphData.nodes;
  }

  // Init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);

  return {
    loadGraph,
    focusNode,
    clearSelection,
    getNodes,
    getColor: getColor,
    TYPE_COLORS,
  };
})();
```

- [ ] Verify graph renders with test data from the API (or a mocked JSON response)

---

## Phase 3 — Interactions

### Task 3: Node styling — colors by type, sizing by relations

Already implemented inline in Task 2 (`getColor()`, `nodeRadius()`). This task is a **verification** step.

**Steps:**
- [ ] Confirm each entity type renders with the correct fill/stroke from the palette
- [ ] Confirm nodes with more relations appear larger (log scale, MIN_RADIUS=6, MAX_RADIUS=28)
- [ ] Confirm labels only appear for nodes with 2+ relations
- [ ] Confirm legend matches the TYPE_COLORS map

### Task 4: Interaction — hover highlight + click select + tooltip

Already implemented inline in Task 2 (`highlightConnected`, `onNodeClick`, tooltip). This task is a **verification** step.

**Steps:**
- [ ] Hover a node: connected nodes stay full opacity, unconnected fade to 0.15, connected edges brighten
- [ ] Hover shows tooltip near cursor with name, type, relation count
- [ ] Click a node: node gets glow filter, side panel opens (wired in Task 5)
- [ ] Click empty space or press Escape: selection clears
- [ ] Drag a node: node follows cursor, simulation adjusts, no panel opens

---

### Task 5: Side panel — entity details + relations list

**Files:**
- Create: `services/knowledge-hub/dashboard/panel.js`

**Why:** Clicking a node should reveal its properties and relations in the side panel. Fetches from `GET /graph/entity/:id`.

**Dependencies:** Tasks 1, 2.

**Steps:**
- [ ] Create `panel.js` with the module pattern:

```javascript
// panel.js — Side panel for entity details
const KnowledgePanel = (() => {
  let panelEl, contentEl, closeBtn;
  let currentEntityId = null;

  function init() {
    panelEl = document.getElementById('side-panel');
    contentEl = document.getElementById('panel-content');
    closeBtn = document.getElementById('panel-close');

    closeBtn.addEventListener('click', close);

    // Escape key closes panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        KnowledgeGraph.clearSelection();
      }
    });

    // Click on SVG background clears selection
    document.getElementById('graph-svg').addEventListener('click', (e) => {
      if (e.target.tagName === 'svg') {
        close();
        KnowledgeGraph.clearSelection();
      }
    });
  }

  async function showEntity(entityId) {
    currentEntityId = entityId;
    panelEl.classList.add('open');
    contentEl.innerHTML = '<div class="loading-text">Loading...</div>';

    try {
      const resp = await fetch(`/graph/entity/${encodeURIComponent(entityId)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderEntity(data);
    } catch (err) {
      contentEl.innerHTML = `<div class="loading-text">Failed to load entity</div>`;
      console.error('Panel fetch error:', err);
    }
  }

  function renderEntity(data) {
    const entity = data.entity || data;
    const relations = data.relations || [];
    const colors = KnowledgeGraph.getColor(entity.type);

    let html = '';

    // Header
    html += `
      <div class="panel-header">
        <div class="panel-entity-name">${escapeHtml(entity.name)}</div>
        <span class="panel-entity-type" style="background:${colors.fill};border:1px solid ${colors.stroke};color:${colors.stroke}">
          ${entity.type}
        </span>
        ${entity.product ? `<span style="color:#999;font-size:12px;margin-left:8px">${entity.product}</span>` : ''}
      </div>
    `;

    // Properties
    const props = entity.properties || {};
    const propKeys = Object.keys(props);
    if (propKeys.length > 0) {
      html += `
        <div class="panel-section">
          <div class="panel-section-title">Properties</div>
          ${propKeys.map(key => `
            <div class="panel-property">
              <span class="panel-property-key">${escapeHtml(key)}</span>
              <span class="panel-property-value">${escapeHtml(String(props[key]))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Relations — group by predicate
    if (relations.length > 0) {
      const grouped = {};
      for (const rel of relations) {
        const key = rel.predicate || 'related_to';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(rel);
      }

      html += `<div class="panel-section"><div class="panel-section-title">Relations (${relations.length})</div>`;

      for (const [predicate, rels] of Object.entries(grouped)) {
        html += `<div style="margin-bottom:8px">`;
        html += `<div style="color:#666;font-size:11px;text-transform:uppercase;margin-bottom:4px">${predicate.replace(/_/g, ' ')}</div>`;
        for (const rel of rels) {
          // Determine which end is the "other" entity
          const isSubject = rel.subject === currentEntityId;
          const otherId = isSubject ? rel.object : rel.subject;
          const otherName = rel._object_name || rel._subject_name || otherId.split(':').pop();
          const dateStr = rel.valid_from ? rel.valid_from.substring(0, 10) : '';

          html += `
            <div class="panel-relation" data-entity-id="${escapeHtml(otherId)}">
              <span class="panel-relation-target">${escapeHtml(otherName)}</span>
              ${dateStr ? `<span class="panel-relation-date">${dateStr}</span>` : ''}
            </div>
          `;
        }
        html += `</div>`;
      }
      html += `</div>`;
    } else {
      html += `
        <div class="panel-section">
          <div class="panel-section-title">Relations</div>
          <div style="color:#666;font-size:13px">No relations found</div>
        </div>
      `;
    }

    // Entity ID (small, muted)
    html += `
      <div class="panel-section">
        <div class="panel-section-title">ID</div>
        <div style="color:#666;font-size:12px;font-family:monospace;word-break:break-all">${escapeHtml(entity.id)}</div>
      </div>
    `;

    contentEl.innerHTML = html;

    // Wire up relation clicks to navigate to that entity
    contentEl.querySelectorAll('.panel-relation[data-entity-id]').forEach(el => {
      el.addEventListener('click', () => {
        const targetId = el.dataset.entityId;
        KnowledgeGraph.focusNode(targetId);
      });
    });
  }

  function close() {
    panelEl.classList.remove('open');
    currentEntityId = null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showEntity, close };
})();
```

- [ ] Click a node: panel slides open from right, shows entity name, type badge (colored), properties, grouped relations
- [ ] Click a relation in the panel: graph pans to that node, panel updates to show that entity
- [ ] Click X or press Escape: panel closes

---

## Phase 4 — Filters + Search

### Task 6: Product filter pills

**Files:**
- Modify: `services/knowledge-hub/dashboard/graph.js` (add filter pill event wiring in `init()`)

**Why:** Users need to filter the graph by product (VisionKing, DieMaster, SpotFusion) or see all.

**Dependencies:** Task 2.

**Steps:**
- [ ] Add the following code to the `init()` function in `graph.js`, after `buildLegend()`:

```javascript
    // Filter pills
    document.querySelectorAll('#filter-pills .pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#filter-pills .pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const product = btn.dataset.product;
        loadGraph(product);
        // Close panel on filter change
        if (typeof KnowledgePanel !== 'undefined') KnowledgePanel.close();
        selectedNodeId = null;
      });
    });
```

- [ ] Click "VK" pill: graph reloads with `?product=visionking`, pill highlights
- [ ] Click "All" pill: graph reloads without product filter
- [ ] Active pill has blue background + cyan border, others are grey

---

### Task 7: Search bar + results overlay

**Files:**
- Create: `services/knowledge-hub/dashboard/search.js`

**Why:** Users need to search entities by name or content, see results in a dropdown, and click to focus a node.

**Dependencies:** Tasks 1, 2.

**Steps:**
- [ ] Create `search.js`:

```javascript
// search.js — Search bar with results overlay
const KnowledgeSearch = (() => {
  let inputEl, resultsEl;
  let debounceTimer = null;

  function init() {
    inputEl = document.getElementById('search-input');
    resultsEl = document.getElementById('search-results');

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('focus', () => {
      if (resultsEl.children.length > 0) {
        resultsEl.classList.add('visible');
      }
    });

    // Close results on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-container')) {
        resultsEl.classList.remove('visible');
      }
    });

    // Keyboard navigation
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        resultsEl.classList.remove('visible');
        inputEl.blur();
      }
      if (e.key === 'Enter') {
        const first = resultsEl.querySelector('.search-result-item');
        if (first) first.click();
      }
    });
  }

  function onInput() {
    const query = inputEl.value.trim();
    if (query.length < 2) {
      resultsEl.classList.remove('visible');
      resultsEl.innerHTML = '';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(query), 250);
  }

  async function search(query) {
    // First: filter local nodes for instant match
    const localMatches = KnowledgeGraph.getNodes().filter(n =>
      n.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5);

    // Then: call search API for content matches
    let apiResults = [];
    try {
      const resp = await fetch(`/search?q=${encodeURIComponent(query)}&limit=10`);
      if (resp.ok) {
        const data = await resp.json();
        apiResults = data.results || [];
      }
    } catch (_) { /* silent */ }

    renderResults(localMatches, apiResults);
  }

  function renderResults(localMatches, apiResults) {
    let html = '';

    // Local node matches (graph entities)
    if (localMatches.length > 0) {
      html += '<div style="padding:8px 14px;font-size:11px;color:#666;text-transform:uppercase">Graph Entities</div>';
      for (const node of localMatches) {
        const colors = KnowledgeGraph.getColor(node.type);
        html += `
          <div class="search-result-item" data-node-id="${escapeHtml(node.id)}">
            <div class="result-title">
              <span style="color:${colors.stroke};margin-right:6px">&#9679;</span>
              ${escapeHtml(node.name)}
            </div>
            <div class="result-meta">${node.type}${node.product ? ' / ' + node.product : ''}</div>
          </div>
        `;
      }
    }

    // API content matches
    if (apiResults.length > 0) {
      html += '<div style="padding:8px 14px;font-size:11px;color:#666;text-transform:uppercase;border-top:1px solid #333">Search Results</div>';
      for (const r of apiResults) {
        const snippet = r.content ? r.content.substring(0, 120) + '...' : '';
        html += `
          <div class="search-result-item search-content-result" data-source="${escapeHtml(r.source_path || '')}">
            <div class="result-title">${escapeHtml(r.metadata?.section || r.source_path || 'Result')}</div>
            <div class="result-meta">${r.source_type || ''}${r.project_code ? ' / ' + r.project_code : ''} — score: ${(r.score * 100).toFixed(0)}%</div>
            ${snippet ? `<div class="result-snippet">${escapeHtml(snippet)}</div>` : ''}
          </div>
        `;
      }
    }

    if (!html) {
      html = '<div style="padding:14px;color:#666;font-size:13px">No results found</div>';
    }

    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');

    // Wire click handlers for graph entity results
    resultsEl.querySelectorAll('[data-node-id]').forEach(el => {
      el.addEventListener('click', () => {
        const nodeId = el.dataset.nodeId;
        KnowledgeGraph.focusNode(nodeId);
        resultsEl.classList.remove('visible');
        inputEl.value = '';
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', init);

  return { search };
})();
```

- [ ] Type 2+ chars in search bar: results dropdown appears after 250ms debounce
- [ ] "Graph Entities" section shows nodes matching the query name (local filter)
- [ ] "Search Results" section shows API content matches with score, source, snippet
- [ ] Click a graph entity result: graph pans + zooms to that node, search closes
- [ ] Press Escape: search results close
- [ ] Press Enter: selects first result
- [ ] Click outside: results close

---

## Phase 5 — Zoom, Pan, Reset

### Task 8: Zoom + pan + reset button

Already implemented inline in Task 2 (`zoomBehavior`, zoom controls, `resetZoom`). This task is a **verification** step.

**Steps:**
- [ ] Mouse wheel zooms in/out (scale 0.1x to 6x)
- [ ] Click and drag on background pans the view
- [ ] Click "+" button zooms in by 1.4x
- [ ] Click "-" button zooms out by 0.7x
- [ ] Click reset button (circular arrow) animates back to identity transform (500ms)
- [ ] Dragging a node does NOT trigger pan (drag events are separate from zoom)

---

## Phase 6 — Server Integration

### Task 9: Wire server to serve dashboard static files

**Files:**
- Modify: `services/knowledge-hub/lib/server.mjs`

**Why:** The knowledge-hub HTTP server must serve the dashboard as static files at `GET /` and `GET /dashboard/*`.

**Dependencies:** Plan 1 (server.mjs must exist). Dashboard files from Tasks 1-7.

**Steps:**
- [ ] Add static file serving to `server.mjs`. The server uses native `http` module (no Express). Add a route handler that:
  1. Maps `GET /` to `dashboard/index.html`
  2. Maps `GET /dashboard/*` to files under the `dashboard/` directory
  3. Sets correct `Content-Type` headers (`.html` = `text/html`, `.css` = `text/css`, `.js` = `text/javascript`)
  4. Returns 404 for missing files
  5. Prevents path traversal (`..` in the path)

```javascript
// Add to server.mjs — static file serving for dashboard

import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DASHBOARD_DIR = join(__dirname, '..', 'dashboard');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

async function serveDashboard(req, res) {
  let filePath;

  if (req.url === '/' || req.url === '/index.html') {
    filePath = join(DASHBOARD_DIR, 'index.html');
  } else if (req.url.startsWith('/dashboard/')) {
    const relative = req.url.slice('/dashboard/'.length).split('?')[0];
    const normalized = normalize(relative);
    // Prevent path traversal
    if (normalized.startsWith('..') || normalized.includes('/../')) {
      res.writeHead(403);
      res.end('Forbidden');
      return true;
    }
    filePath = join(DASHBOARD_DIR, normalized);
  } else {
    return false; // Not a dashboard route
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
  return true;
}

// In the main request handler, call serveDashboard first:
// async function handleRequest(req, res) {
//   if (await serveDashboard(req, res)) return;
//   // ... existing API route handling ...
// }
```

- [ ] `GET /` returns `dashboard/index.html` with `text/html` content type
- [ ] `GET /dashboard/style.css` returns CSS with correct MIME type
- [ ] `GET /dashboard/graph.js` returns JS with correct MIME type
- [ ] `GET /dashboard/../../../etc/passwd` returns 403
- [ ] `GET /dashboard/nonexistent.js` returns 404
- [ ] API routes (`/graph/view`, `/search`, etc.) still work unchanged

---

## Verification Checklist

After all tasks are complete, verify the full dashboard works end-to-end:

- [ ] Open `http://localhost:8091/` in browser — dark theme dashboard loads
- [ ] Graph renders with force-directed layout, nodes colored by type
- [ ] Node sizes vary based on relation count
- [ ] Hover a node: connected subgraph highlights, tooltip shows name/type
- [ ] Click a node: side panel opens with entity details + grouped relations
- [ ] Click a relation in panel: graph pans to that entity, panel updates
- [ ] Click filter pill "VK": graph reloads with VisionKing entities only
- [ ] Click filter pill "All": graph reloads with all entities
- [ ] Type in search bar: results dropdown appears with entity + content matches
- [ ] Click search result: graph pans to that node
- [ ] Zoom with mouse wheel, pan with drag, reset with button
- [ ] Health dot is green when API is healthy
- [ ] Stats footer shows entity/relation counts
- [ ] Legend shows all 7 entity types with correct colors
- [ ] Responsive: on narrow viewport, panel overlays, stats/legend hide
