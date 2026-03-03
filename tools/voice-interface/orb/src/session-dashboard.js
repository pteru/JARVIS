// JARVIS Session Dashboard — 3D Carousel
// Elliptical ring of glass-panel cards around the orb, viewed from above
// Drag horizontally or scroll to rotate through cards

const STATE_COLORS = {
  active:     { dot: '#00ff88', border: 'rgba(0,255,136,0.3)',  iconBg: 'rgba(0,255,136,0.12)' },
  idle:       { dot: '#ffaa00', border: 'rgba(255,170,0,0.25)', iconBg: 'rgba(255,170,0,0.10)' },
  background: { dot: '#4488ff', border: 'rgba(68,136,255,0.25)',iconBg: 'rgba(68,136,255,0.10)' },
  complete:   { dot: '#00cc66', border: 'rgba(0,204,102,0.25)', iconBg: 'rgba(0,204,102,0.10)' },
  error:      { dot: '#ff4444', border: 'rgba(255,68,68,0.3)',  iconBg: 'rgba(255,68,68,0.12)' },
};

const STATE_ICONS = {
  active: '\u25B6', idle: '\u275A\u275A', background: '\u2699', complete: '\u2713', error: '\u2717'
};

const STATE_LABELS = {
  active: 'ACTIVE', idle: 'IDLE', background: 'BACKGROUND', complete: 'COMPLETE', error: 'ERROR'
};

function contextBarColor(pct) {
  if (pct <= 60) return '#00ff88';
  if (pct <= 85) return '#ffaa00';
  return '#ff4444';
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// Reference size — all dimensions are ratios of this base width
const BASE_W = 800;

function scalePx(px) {
  return px * (window.innerWidth / BASE_W);
}

let cssInjected = false;
let styleEl = null;

function injectCSS() {
  if (!styleEl) {
    styleEl = document.createElement('style');
    document.head.appendChild(styleEl);
  }
  cssInjected = true;
  updateCSS();
}

function updateCSS() {
  if (!styleEl) return;
  const s = (px) => `${scalePx(px).toFixed(1)}px`;

  styleEl.textContent = `
    .session-card {
      position: fixed;
      width: ${s(160)};
      padding: ${s(12)} ${s(14)} ${s(10)};
      border-radius: ${s(10)};
      background: rgba(12,16,28,0.85);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(60,90,140,0.22);
      box-shadow:
        0 2px 30px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.05),
        inset 0 -1px 0 rgba(0,0,0,0.2);
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
      transition: opacity 0.15s ease, border-color 0.3s ease, box-shadow 0.3s ease;
      transform-origin: center center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #e0e4ea;
      font-size: ${s(9.5)};
    }

    .session-card:hover {
      border-color: rgba(100,170,255,0.45) !important;
      box-shadow:
        0 0 35px rgba(80,140,255,0.12),
        0 8px 40px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.1);
    }
    .session-card.state-active {
      border-color: rgba(0,255,136,0.3);
      box-shadow:
        0 0 30px rgba(0,255,136,0.08),
        0 4px 30px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.07);
    }

    /* Card header */
    .card-header {
      display: flex; align-items: center; gap: ${s(6)};
      margin-bottom: ${s(10)};
      padding-bottom: ${s(8)};
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .card-icon {
      width: ${s(18)}; height: ${s(18)};
      border-radius: ${s(4)};
      display: flex; align-items: center; justify-content: center;
      font-size: ${s(9)}; flex-shrink: 0;
    }
    .card-name {
      font-size: ${s(10)}; font-weight: 700;
      letter-spacing: 0.8px; text-transform: uppercase;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #8899aa;
    }
    .session-card.state-active .card-name { color: #e8ecf0; }

    /* Card rows */
    .card-row {
      display: flex; align-items: center; gap: ${s(6)};
      margin-bottom: ${s(6)};
      letter-spacing: 0.3px;
    }
    .card-row .label {
      color: #556677; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.6px;
      min-width: ${s(48)}; font-size: ${s(8.5)};
    }
    .card-row .value {
      color: #a0b0c0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Context progress bar */
    .context-bar-bg {
      flex: 1; height: ${s(4)};
      background: rgba(255,255,255,0.06);
      border-radius: 2px; overflow: hidden;
      margin-right: ${s(6)};
    }
    .context-bar-fill {
      height: 100%; border-radius: 2px;
      transition: width 0.5s ease;
      box-shadow: 0 0 6px currentColor;
    }
    .context-pct {
      font-size: ${s(9)}; font-weight: 700;
      min-width: ${s(26)}; text-align: right;
    }

    /* Status */
    .status-dot {
      width: ${s(7)}; height: ${s(7)};
      border-radius: 50%; flex-shrink: 0;
    }
    .status-label {
      font-weight: 700; font-size: ${s(9)};
      letter-spacing: 0.5px;
    }

    /* Log */
    .card-log {
      margin-top: ${s(8)}; padding-top: ${s(7)};
      border-top: 1px solid rgba(255,255,255,0.04);
      font-size: ${s(8.5)}; color: #445566; line-height: 1.6;
    }
    .card-log .log-label {
      color: #556677; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.6px;
    }
  `;
}

export class SessionDashboard {
  constructor(onSessionClick) {
    this.onSessionClick = onSessionClick;
    this.sessions = [];
    this.visible = true;
    this.rotation = 0;
    this.targetRotation = 0;
    this.cardElements = [];
    this._dragging = false;
    this._dragStartX = 0;
    this._dragStartRotation = 0;
    this._velocity = 0;

    injectCSS();
    this._createElements();
    this._initKeys();
    this._initResize();
    this._startAnimLoop();
  }

  _createElements() {
    // Floor and reflection are now rendered in the Three.js scene (floor.js)
  }

  _initKeys() {
    // Arrow keys to rotate carousel
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        this._step(1);
      } else if (e.key === 'ArrowLeft') {
        this._step(-1);
      }
    });
  }

  _initResize() {
    window.addEventListener('resize', () => updateCSS());
  }

  /** Step one card position in the given direction (+1 = right, -1 = left) */
  _step(dir) {
    if (this.sessions.length === 0) return;
    const stepAngle = 360 / this.sessions.length;
    this.targetRotation += stepAngle * dir;
  }

  _startAnimLoop() {
    const animate = () => {
      requestAnimationFrame(animate);

      // Smooth rotation
      this.rotation += (this.targetRotation - this.rotation) * 0.12;

      // Update card positions
      this._updatePositions();
    };
    animate();
  }

  update(sessions) {
    this.sessions = sessions;
    this._rebuildCards();
  }

  toggle() {
    this.visible = !this.visible;
    this.cardElements.forEach(c => c.style.display = this.visible ? '' : 'none');
  }

  _rebuildCards() {
    // Remove old cards
    this.cardElements.forEach(c => c.remove());
    this.cardElements = [];
    if (!this.visible || this.sessions.length === 0) return;

    this.sessions.forEach((session) => {
      const card = this._createCard(session);
      document.body.appendChild(card);
      this.cardElements.push(card);
    });
  }

  _updatePositions() {
    const count = this.cardElements.length;
    if (count === 0) return;

    const ratio = window.innerWidth / BASE_W;
    const radiusX = 280 * ratio;
    const radiusY = 80 * ratio;
    const cardW = 160 * ratio;
    const cardH = 180 * ratio;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * 0.62;
    const step = 360 / count;

    // Collect positions for z-sorting
    const positions = this.cardElements.map((card, i) => {
      const angle = step * i + this.rotation;
      const rad = (angle * Math.PI) / 180;

      const x = Math.sin(rad) * radiusX;
      const y = Math.cos(rad) * radiusY;

      // Depth: front (positive y, bottom) = 1, back (negative y, top) = 0
      const normalizedDepth = (y + radiusY) / (2 * radiusY);

      return { card, x, y, normalizedDepth };
    });

    // Sort by depth so front cards render on top
    positions.sort((a, b) => a.normalizedDepth - b.normalizedDepth);

    positions.forEach(({ card, x, y, normalizedDepth }, sortIdx) => {
      const scale = 0.55 + normalizedDepth * 0.45;
      const opacity = 0.1 + normalizedDepth * 0.9;

      const left = centerX + x - (cardW / 2) * scale;
      const top = centerY + y - (cardH / 2) * scale;

      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.style.transform = `scale(${scale})`;
      card.style.opacity = opacity;
      card.style.zIndex = sortIdx + 10;
    });
  }

  _createCard(session) {
    const colors = STATE_COLORS[session.state] || STATE_COLORS.idle;
    const isActive = session.state === 'active';
    const icon = STATE_ICONS[session.state] || STATE_ICONS.idle;
    const contextPct = session.context_pct || Math.min(session.turn_count * 5, 100) || 10;
    const barColor = contextBarColor(contextPct);
    const topic = session.topic || 'General';
    const log = session.log || '';

    const card = document.createElement('div');
    card.className = `session-card ${isActive ? 'state-active' : ''}`;
    card.dataset.sessionId = session.id;

    // Click to switch session (stop propagation to prevent drag)
    card.addEventListener('mousedown', (e) => e.stopPropagation());
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onSessionClick) this.onSessionClick(session.id);
    });

    // Build log lines
    const logLines = log.split('\n').map(l => l.trim()).filter(Boolean);
    const logHtml = logLines.length > 0
      ? `<span class="log-label">Log: </span>${logLines.map(l => escapeHtml(l)).join('<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;')}`
      : '';

    card.innerHTML = `
      <div class="card-header">
        <span class="card-icon" style="background:${colors.iconBg}; color:${colors.dot};">${icon}</span>
        <span class="card-name">${escapeHtml(session.name)}</span>
      </div>
      <div class="card-row">
        <span class="label">Topic:</span>
        <span class="value">${escapeHtml(topic)}</span>
      </div>
      <div class="card-row">
        <span class="label">Context:</span>
        <div class="context-bar-bg">
          <div class="context-bar-fill" style="width:${contextPct}%; background:${barColor}; color:${barColor};"></div>
        </div>
        <span class="context-pct" style="color:${barColor}">${contextPct}%</span>
      </div>
      <div class="card-row">
        <span class="label">Status:</span>
        <span class="status-dot" style="background:${colors.dot}; box-shadow: 0 0 8px ${colors.dot};"></span>
        <span class="status-label" style="color:${colors.dot}">${STATE_LABELS[session.state] || session.state}</span>
      </div>
      ${logHtml ? `<div class="card-log">${logHtml}</div>` : ''}
    `;

    return card;
  }
}
