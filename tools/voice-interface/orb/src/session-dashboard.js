// JARVIS Session Dashboard — Glass-panel session cards
// Overlays HTML cards on top of the Three.js canvas in a semi-circle layout

const STATE_COLORS = {
  active:     { dot: '#00ff88', border: 'rgba(0, 255, 136, 0.3)', glow: 'rgba(0, 255, 136, 0.15)' },
  idle:       { dot: '#ffaa00', border: 'rgba(255, 170, 0, 0.2)',  glow: 'rgba(255, 170, 0, 0.08)' },
  background: { dot: '#4488ff', border: 'rgba(68, 136, 255, 0.2)', glow: 'rgba(68, 136, 255, 0.08)' },
  complete:   { dot: '#00cc66', border: 'rgba(0, 204, 102, 0.2)',  glow: 'rgba(0, 204, 102, 0.08)' },
  error:      { dot: '#ff4444', border: 'rgba(255, 68, 68, 0.3)',  glow: 'rgba(255, 68, 68, 0.12)' },
};

const STATE_LABELS = {
  active: 'ACTIVE',
  idle: 'IDLE',
  background: 'BACKGROUND',
  complete: 'COMPLETE',
  error: 'ERROR',
};

export class SessionDashboard {
  constructor(onSessionClick) {
    this.onSessionClick = onSessionClick;
    this.sessions = [];
    this.visible = true;
    this.container = null;
    this._createContainer();
  }

  _createContainer() {
    this.container = document.createElement('div');
    this.container.id = 'session-dashboard';
    this.container.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 45%;
      pointer-events: none;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      padding-bottom: 24px;
      gap: 16px;
      z-index: 10;
      perspective: 800px;
      transition: opacity 0.4s ease;
    `;
    document.body.appendChild(this.container);
  }

  update(sessions) {
    this.sessions = sessions;
    this._render();
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.opacity = this.visible ? '1' : '0';
    this.container.style.pointerEvents = this.visible ? 'none' : 'none';
  }

  _render() {
    this.container.innerHTML = '';

    if (!this.visible || this.sessions.length === 0) return;

    const count = Math.min(this.sessions.length, 8);
    const sessions = this.sessions.slice(0, count);

    // Semi-circle layout parameters
    const arcSpan = Math.min(count * 28, 140); // degrees of arc, max 140
    const startAngle = -arcSpan / 2;
    const step = count > 1 ? arcSpan / (count - 1) : 0;

    sessions.forEach((session, i) => {
      const angle = count > 1 ? startAngle + step * i : 0;
      const card = this._createCard(session, angle, i, count);
      this.container.appendChild(card);
    });
  }

  _createCard(session, angle, index, total) {
    const colors = STATE_COLORS[session.state] || STATE_COLORS.idle;
    const isActive = session.state === 'active';
    const scale = isActive ? 1.05 : 0.92;
    const opacity = isActive ? 1.0 : 0.7;

    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = session.id;

    // Transform: slight rotation toward center + vertical offset for arc
    const yOffset = Math.abs(angle) * 0.3; // cards further from center sit slightly higher
    const rotateY = angle * 0.15; // subtle perspective rotation

    card.style.cssText = `
      pointer-events: auto;
      width: 220px;
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(10, 14, 20, 0.75);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid ${colors.border};
      box-shadow: 0 0 20px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.05);
      color: #e0e4ea;
      font-family: 'Inter', 'SF Pro Display', -apple-system, sans-serif;
      font-size: 11px;
      cursor: pointer;
      transform: scale(${scale}) translateY(${yOffset}px) rotateY(${rotateY}deg);
      transform-origin: bottom center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: ${opacity};
      user-select: none;
      overflow: hidden;
    `;

    // Hover effect
    card.addEventListener('mouseenter', () => {
      card.style.transform = `scale(1.08) translateY(${yOffset - 4}px) rotateY(${rotateY}deg)`;
      card.style.opacity = '1';
      card.style.borderColor = colors.dot;
      card.style.boxShadow = `0 0 30px ${colors.glow}, 0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = `scale(${scale}) translateY(${yOffset}px) rotateY(${rotateY}deg)`;
      card.style.opacity = String(opacity);
      card.style.borderColor = colors.border;
      card.style.boxShadow = `0 0 20px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`;
    });

    // Click to switch
    card.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // prevent window drag
    });
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onSessionClick) {
        this.onSessionClick(session.id);
      }
    });

    // Card content
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <span style="
          width:8px; height:8px; border-radius:50%;
          background:${colors.dot};
          box-shadow: 0 0 6px ${colors.dot};
          flex-shrink:0;
        "></span>
        <span style="
          font-size:12px; font-weight:600;
          letter-spacing:0.5px;
          text-transform:uppercase;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          color: ${isActive ? '#ffffff' : '#b0b8c8'};
        ">${this._escapeHtml(session.name)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="
          font-size:10px; text-transform:uppercase;
          letter-spacing:0.8px;
          color:${colors.dot};
          opacity:0.9;
        ">${STATE_LABELS[session.state] || session.state}</span>
        <span style="
          font-size:10px; color:#667;
        ">${session.turn_count} turn${session.turn_count !== 1 ? 's' : ''}</span>
      </div>
    `;

    return card;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
