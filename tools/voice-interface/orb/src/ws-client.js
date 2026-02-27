// JARVIS Energy Orb — WebSocket Client
// Connects to ws://localhost:9000/orb with auto-reconnect

const WS_URL = 'ws://localhost:9000/orb';
const RECONNECT_BASE = 1000; // 1s
const RECONNECT_MAX = 10000; // 10s

export class WebSocketClient {
  constructor(onStateChange, onAmplitude, onAlert) {
    this.onStateChange = onStateChange;
    this.onAmplitude = onAmplitude;
    this.onAlert = onAlert;
    this.ws = null;
    this.reconnectDelay = RECONNECT_BASE;
    this.reconnectTimer = null;
    this.connected = false;
  }

  connect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    console.log(`[WS] Connecting to ${WS_URL}...`);

    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('[WS] Failed to create WebSocket:', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.connected = true;
      this.reconnectDelay = RECONNECT_BASE;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (err) {
        console.warn('[WS] Invalid message:', event.data);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.connected = false;
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[WS] Error:', err.message || 'connection error');
    };
  }

  _handleMessage(data) {
    // { "state": "listening" }
    if (data.state) {
      this.onStateChange(data.state);
    }

    // { "amplitude": 0.5 } or { "state": "speaking", "amplitude": 0.73 }
    if (data.amplitude !== undefined) {
      this.onAmplitude(data.amplitude);
    }

    // { "alert": "vk-health", "level": "critical" }
    if (data.alert) {
      this.onAlert(data.alert, data.level);
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}
