// === Git Graph Renderer (D3.js) ===

const LANE_WIDTH = 24;
const ROW_HEIGHT = 32;
const NODE_RADIUS = 5;
const MERGE_RADIUS = 7;
const GRAPH_PADDING = { top: 40, left: 20, right: 200 };

function assignLanes(nodes) {
  // Build SHA->node index
  const bysha = new Map();
  for (const node of nodes) bysha.set(node.sha, node);

  // Track which lane each branch tip occupies
  let nextLane = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // If node already has a lane assigned (from a child), keep it
    if (node.lane === undefined) {
      // Check if any child assigned a lane to this parent
      let assignedLane = null;

      // Look through earlier (newer) nodes to find children pointing to this node
      for (let j = 0; j < i; j++) {
        const child = nodes[j];
        if (child.parents.includes(node.sha)) {
          if (child.parents[0] === node.sha) {
            // First parent = same branch, inherit lane
            assignedLane = child.lane;
            break;
          }
        }
      }

      node.lane = assignedLane !== null ? assignedLane : nextLane++;
    }

    // For merge commits, assign lanes to non-first parents
    if (node.parents.length > 1) {
      for (let p = 1; p < node.parents.length; p++) {
        const parent = bysha.get(node.parents[p]);
        if (parent && parent.lane === undefined) {
          parent.lane = nextLane++;
        }
      }
    }

    // First parent inherits our lane
    if (node.parents.length > 0) {
      const firstParent = bysha.get(node.parents[0]);
      if (firstParent && firstParent.lane === undefined) {
        firstParent.lane = node.lane;
      }
    }
  }

  return nextLane; // total lanes used
}

function renderCommitGraph(data) {
  const container = document.getElementById('commit-graph');
  container.innerHTML = '';

  const nodes = data.nodes;
  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-sm text-center py-20">No commits found</div>';
    return;
  }

  // Clear any stale lane assignments
  for (const node of nodes) delete node.lane;

  // Assign lanes
  const totalLanes = Math.max(assignLanes(nodes), 1);

  // Compute dimensions
  const graphWidth = GRAPH_PADDING.left + totalLanes * LANE_WIDTH + GRAPH_PADDING.right + 400;
  const graphHeight = GRAPH_PADDING.top + nodes.length * ROW_HEIGHT + 40;

  // Create SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', Math.max(graphWidth, container.clientWidth))
    .attr('height', graphHeight)
    .style('font-family', 'ui-monospace, monospace');

  // Build SHA->index map
  const shaIndex = new Map();
  nodes.forEach((n, i) => shaIndex.set(n.sha, i));

  // Position function
  function nodeX(node) { return GRAPH_PADDING.left + (node.lane || 0) * LANE_WIDTH + LANE_WIDTH / 2; }
  function nodeY(idx) { return GRAPH_PADDING.top + idx * ROW_HEIGHT; }

  // Lane colors based on branch
  const laneColors = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#a855f7'];

  function laneColor(node) {
    const ref = (node.refs || []).find(r => !r.startsWith('tag:'));
    if (ref) {
      const branchName = ref.replace('HEAD -> ', '').replace(/^origin\//, '').split(',')[0].trim();
      return branchColor(branchName);
    }
    // No ref — use generic lane color
    return laneColors[(node.lane || 0) % laneColors.length];
  }

  // Draw edges (lines from child to parent)
  const edgeGroup = svg.append('g').attr('class', 'edges');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const cx = nodeX(node);
    const cy = nodeY(i);
    const color = laneColor(node);

    for (const parentSha of node.parents) {
      const pi = shaIndex.get(parentSha);
      if (pi === undefined) continue;
      const parent = nodes[pi];
      const px = nodeX(parent);
      const py = nodeY(pi);

      if (cx === px) {
        // Same lane — straight line
        edgeGroup.append('line')
          .attr('x1', cx).attr('y1', cy)
          .attr('x2', px).attr('y2', py)
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.6);
      } else {
        // Cross-lane — curved path
        const midY = cy + (py - cy) * 0.3;
        edgeGroup.append('path')
          .attr('d', `M ${cx} ${cy} C ${cx} ${midY}, ${px} ${midY}, ${px} ${py}`)
          .attr('stroke', laneColor(parent))
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.4)
          .attr('fill', 'none');
      }
    }
  }

  // Draw nodes
  const nodeGroup = svg.append('g').attr('class', 'nodes');
  const tooltip = document.getElementById('tooltip');
  const textX = GRAPH_PADDING.left + totalLanes * LANE_WIDTH + 10;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const cx = nodeX(node);
    const cy = nodeY(i);
    const isMerge = node.parents.length > 1;
    const color = laneColor(node);
    const r = isMerge ? MERGE_RADIUS : NODE_RADIUS;

    // Node circle
    nodeGroup.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .attr('fill', color)
      .attr('stroke', '#242640')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', (event) => {
        const refs = node.refs.length > 0 ? `<div class="text-accent">${node.refs.join(', ')}</div>` : '';
        tooltip.innerHTML = `
          ${refs}
          <div class="font-mono text-gray-300">${node.sha.slice(0, 10)}</div>
          <div class="text-gray-400">${node.author} &middot; ${formatDate(node.date)}</div>
          <div class="text-gray-200 mt-1">${node.message}</div>
        `;
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
        tooltip.classList.remove('hidden');
      })
      .on('mousemove', (event) => {
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
      })
      .on('mouseout', () => {
        tooltip.classList.add('hidden');
      });

    // Short SHA text (right of the graph lanes)
    nodeGroup.append('text')
      .attr('x', textX).attr('y', cy + 4)
      .attr('fill', '#6b7280')
      .attr('font-size', '10px')
      .text(node.sha.slice(0, 7));

    // Message text
    nodeGroup.append('text')
      .attr('x', textX + 60).attr('y', cy + 4)
      .attr('fill', '#9ca3af')
      .attr('font-size', '11px')
      .text(node.message.slice(0, 50) + (node.message.length > 50 ? '...' : ''));

    // Author + date
    nodeGroup.append('text')
      .attr('x', textX + 440).attr('y', cy + 4)
      .attr('fill', '#4b5563')
      .attr('font-size', '10px')
      .text(`${node.author} \u00B7 ${formatDate(node.date)}`);

    // Branch / tag labels at tips
    for (const ref of node.refs) {
      if (ref.startsWith('tag:')) {
        const tagName = ref.replace('tag: ', '');
        const labelWidth = tagName.length * 6.5 + 10;
        nodeGroup.append('rect')
          .attr('x', cx + r + 4).attr('y', cy - 9)
          .attr('width', labelWidth).attr('height', 16)
          .attr('rx', 8).attr('fill', 'rgba(245, 158, 11, 0.2)');
        nodeGroup.append('text')
          .attr('x', cx + r + 9).attr('y', cy + 3)
          .attr('fill', '#f59e0b').attr('font-size', '10px').attr('font-weight', '600')
          .text(tagName);
      } else {
        const branchName = ref.replace('HEAD -> ', '');
        const labelColor = branchColor(branchName.replace(/^origin\//, ''));
        const labelWidth = branchName.length * 5.5 + 10;
        nodeGroup.append('rect')
          .attr('x', cx - r - labelWidth - 4).attr('y', cy - 9)
          .attr('width', labelWidth).attr('height', 16)
          .attr('rx', 8).attr('fill', `${labelColor}30`);
        nodeGroup.append('text')
          .attr('x', cx - r - labelWidth + 1).attr('y', cy + 3)
          .attr('fill', labelColor).attr('font-size', '10px').attr('font-weight', '600')
          .text(branchName);
      }
    }
  }
}

// === Timeline Renderer ===
function renderTimeline(data, container) {
  container.innerHTML = '';

  const commits = data.commits;
  if (!commits || commits.length === 0) return;

  const products = [...new Set(commits.map(c => c.product))].sort();
  const laneHeight = 80;
  const margin = { top: 40, right: 30, bottom: 40, left: 100 };
  const width = Math.max(container.clientWidth - margin.left - margin.right, 800);
  const height = margin.top + products.length * laneHeight + margin.bottom;

  // Time scale
  const dates = commits.map(c => new Date(c.date));
  const xScale = d3.scaleTime()
    .domain(d3.extent(dates))
    .range([0, width]);

  // Product Y positions
  const yScale = (product) => {
    const idx = products.indexOf(product);
    return margin.top + (idx >= 0 ? idx : products.length) * laneHeight + laneHeight / 2;
  };

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height);

  const g = svg.append('g').attr('transform', `translate(${margin.left},0)`);

  // Time axis
  const axisGroup = g.append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.timeFormat('%b %d')));
  axisGroup.selectAll('text').attr('fill', '#6b7280').attr('font-size', '10px');
  axisGroup.selectAll('.domain, .tick line').attr('stroke', '#374151');

  // Swim lane backgrounds and labels
  for (const product of products) {
    const y = yScale(product) - laneHeight / 2;
    g.append('rect')
      .attr('x', 0).attr('y', y)
      .attr('width', width).attr('height', laneHeight)
      .attr('fill', products.indexOf(product) % 2 === 0 ? 'rgba(36, 38, 64, 0.3)' : 'transparent');

    svg.append('text')
      .attr('x', margin.left - 10).attr('y', yScale(product) + 4)
      .attr('text-anchor', 'end')
      .attr('fill', PRODUCT_COLORS[product] || '#6b7280')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(product);
  }

  // Commit dots
  const tooltip = document.getElementById('tooltip');

  for (const commit of commits) {
    const cx = xScale(new Date(commit.date));
    const cy = yScale(commit.product);
    const color = PRODUCT_COLORS[commit.product] || '#6b7280';

    g.append('circle')
      .attr('cx', cx).attr('cy', cy)
      .attr('r', 4)
      .attr('fill', color)
      .attr('fill-opacity', 0.7)
      .style('cursor', 'pointer')
      .on('mouseover', (event) => {
        tooltip.innerHTML = `
          <div class="font-mono text-[10px] text-gray-500">${commit.workspace}</div>
          <div class="text-xs text-gray-300">${commit.message.slice(0, 80)}</div>
          <div class="text-[10px] text-gray-400">${commit.author} &middot; ${new Date(commit.date).toLocaleDateString()}</div>
        `;
        tooltip.style.left = `${event.pageX + 12}px`;
        tooltip.style.top = `${event.pageY - 10}px`;
        tooltip.classList.remove('hidden');
      })
      .on('mouseout', () => tooltip.classList.add('hidden'));
  }
}
