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

let cssInjected = false;

function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* Reflective floor — bottom half */
    #dashboard-floor {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 50%;
      background: linear-gradient(
        to bottom,
        rgba(6,10,18,0.6) 0%,
        rgba(10,14,22,0.82) 30%,
        rgba(8,12,18,0.92) 60%,
        rgba(6,8,14,0.97) 100%
      );
      pointer-events: none;
      z-index: 3;
    }
    #dashboard-floor::before {
      content: '';
      position: absolute;
      top: 0; left: 2%; right: 2%;
      height: 1px;
      background: linear-gradient(
        to right, transparent,
        rgba(80,120,180,0.10) 15%,
        rgba(100,160,220,0.20) 50%,
        rgba(80,120,180,0.10) 85%,
        transparent
      );
    }

    /* Orb reflection on the floor */
    #orb-reflection {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translateX(-50%) scaleY(-0.45);
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        rgba(255,255,255,0.20) 0%,
        rgba(100,160,255,0.10) 35%,
        transparent 65%
      );
      filter: blur(14px);
      opacity: 0.35;
      z-index: 4;
      pointer-events: none;
    }

    .session-card {
      position: fixed;
      width: 160px;
      padding: 12px 14px 10px;
      border-radius: 10px;
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
      font-size: 9.5px;
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
      display: flex; align-items: center; gap: 6px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .card-icon {
      width: 18px; height: 18px;
      border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; flex-shrink: 0;
    }
    .card-name {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.8px; text-transform: uppercase;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #8899aa;
    }
    .session-card.state-active .card-name { color: #e8ecf0; }

    /* Card rows */
    .card-row {
      display: flex; align-items: center; gap: 6px;
      margin-bottom: 6px;
      letter-spacing: 0.3px;
    }
    .card-row .label {
      color: #556677; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.6px;
      min-width: 48px; font-size: 8.5px;
    }
    .card-row .value {
      color: #a0b0c0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Context progress bar */
    .context-bar-bg {
      flex: 1; height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px; overflow: hidden;
      margin-right: 6px;
    }
    .context-bar-fill {
      height: 100%; border-radius: 2px;
      transition: width 0.5s ease;
      box-shadow: 0 0 6px currentColor;
    }
    .context-pct {
      font-size: 9px; font-weight: 700;
      min-width: 26px; text-align: right;
    }

    /* Status */
    .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%; flex-shrink: 0;
    }
    .status-label {
      font-weight: 700; font-size: 9px;
      letter-spacing: 0.5px;
    }

    /* Log */
    .card-log {
      margin-top: 8px; padding-top: 7px;
      border-top: 1px solid rgba(255,255,255,0.04);
      font-size: 8.5px; color: #445566; line-height: 1.6;
    }
    .card-log .log-label {
      color: #556677; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.6px;
    }
  `;
  document.head.appendChild(style);
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

    // Ellipse radii (top-down perspective)
    this.radiusX = 280;
    this.radiusY = 80;
    this.cardW = 160;
    this.cardH = 180;

    injectCSS();
    this._createElements();
    this._initKeys();
    this._startAnimLoop();
  }

  _createElements() {
    // Floor
    this.floor = document.createElement('div');
    this.floor.id = 'dashboard-floor';
    document.body.appendChild(this.floor);

    // Orb reflection
    this.reflection = document.createElement('div');
    this.reflection.id = 'orb-reflection';
    document.body.appendChild(this.reflection);
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
    const op = this.visible ? '1' : '0';
    this.floor.style.opacity = op;
    this.reflection.style.opacity = op;
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

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * 0.62;
    const step = 360 / count;

    // Collect positions for z-sorting
    const positions = this.cardElements.map((card, i) => {
      const angle = step * i + this.rotation;
      const rad = (angle * Math.PI) / 180;

      const x = Math.sin(rad) * this.radiusX;
      const y = Math.cos(rad) * this.radiusY;

      // Depth: front (positive y, bottom) = 1, back (negative y, top) = 0
      const normalizedDepth = (y + this.radiusY) / (2 * this.radiusY);

      return { card, x, y, normalizedDepth };
    });

    // Sort by depth so front cards render on top
    positions.sort((a, b) => a.normalizedDepth - b.normalizedDepth);

    positions.forEach(({ card, x, y, normalizedDepth }, sortIdx) => {
      const scale = 0.55 + normalizedDepth * 0.45;
      const opacity = 0.1 + normalizedDepth * 0.9;

      const left = centerX + x - (this.cardW / 2) * scale;
      const top = centerY + y - (this.cardH / 2) * scale;

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
