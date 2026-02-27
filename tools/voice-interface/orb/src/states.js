// JARVIS Energy Orb — State Machine
// Smooth transitions between 6 visual states

const STATE_CONFIG = {
  idle: {
    color: [0.75, 0.75, 0.75],
    glowColor: [0.9, 0.9, 1.0],
    noiseAmplitude: 0.05,
    noiseSpeed: 0.3,
    bloomStrength: 0.5,
    rotationSpeed: 0.1
  },
  listening: {
    color: [0.27, 0.53, 1.0],
    glowColor: [0.4, 0.7, 1.0],
    noiseAmplitude: 0.12,
    noiseSpeed: 0.6,
    bloomStrength: 0.8,
    rotationSpeed: 0.2
  },
  thinking: {
    color: [1.0, 0.67, 0.2],
    glowColor: [1.0, 0.85, 0.4],
    noiseAmplitude: 0.15,
    noiseSpeed: 1.2,
    bloomStrength: 1.0,
    rotationSpeed: 0.5
  },
  speaking: {
    color: [0.0, 0.87, 0.8],
    glowColor: [0.3, 1.0, 0.95],
    noiseAmplitude: 0.1,
    noiseSpeed: 0.8,
    bloomStrength: 1.2,
    rotationSpeed: 0.3
  },
  alert: {
    color: [1.0, 0.2, 0.2],
    glowColor: [1.0, 0.4, 0.3],
    noiseAmplitude: 0.25,
    noiseSpeed: 1.5,
    bloomStrength: 2.0,
    rotationSpeed: 0.8
  },
  healthy: {
    color: [0.2, 1.0, 0.53],
    glowColor: [0.5, 1.0, 0.7],
    noiseAmplitude: 0.08,
    noiseSpeed: 0.5,
    bloomStrength: 0.8,
    rotationSpeed: 0.15
  }
};

const TRANSITION_DURATION = 0.5; // seconds
const HEALTHY_AUTO_RETURN = 2.0; // seconds

function lerpValue(a, b, t) {
  return a + (b - a) * t;
}

function lerpArray(a, b, t) {
  return a.map((v, i) => lerpValue(v, b[i], t));
}

function lerpConfig(from, to, t) {
  return {
    color: lerpArray(from.color, to.color, t),
    glowColor: lerpArray(from.glowColor, to.glowColor, t),
    noiseAmplitude: lerpValue(from.noiseAmplitude, to.noiseAmplitude, t),
    noiseSpeed: lerpValue(from.noiseSpeed, to.noiseSpeed, t),
    bloomStrength: lerpValue(from.bloomStrength, to.bloomStrength, t),
    rotationSpeed: lerpValue(from.rotationSpeed, to.rotationSpeed, t)
  };
}

// Smooth easing for natural feel
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class StateMachine {
  constructor() {
    this.currentState = 'idle';
    this.previousState = 'idle';
    this.transitionProgress = 1.0; // 1.0 = fully in current state
    this.transitionSpeed = 1.0 / TRANSITION_DURATION;
    this.healthyTimer = 0;
    this._currentValues = { ...STATE_CONFIG.idle };
  }

  transition(newState) {
    if (!STATE_CONFIG[newState]) {
      console.warn(`Unknown state: ${newState}`);
      return;
    }
    if (newState === this.currentState && this.transitionProgress >= 1.0) {
      return;
    }

    // Capture current interpolated values as the starting point
    this.previousState = null;
    this._transitionFrom = { ...this._currentValues };
    this.currentState = newState;
    this.transitionProgress = 0.0;
    this.healthyTimer = 0;

    console.log(`[Orb] Transitioning to: ${newState}`);
  }

  update(deltaTime) {
    // Advance transition
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + deltaTime * this.transitionSpeed);
      const easedT = easeInOutCubic(this.transitionProgress);

      const from = this._transitionFrom || STATE_CONFIG[this.previousState];
      const to = STATE_CONFIG[this.currentState];
      this._currentValues = lerpConfig(from, to, easedT);
    } else {
      this._currentValues = { ...STATE_CONFIG[this.currentState] };
    }

    // Healthy state auto-returns to idle after 2 seconds
    if (this.currentState === 'healthy' && this.transitionProgress >= 1.0) {
      this.healthyTimer += deltaTime;
      if (this.healthyTimer >= HEALTHY_AUTO_RETURN) {
        this.transition('idle');
      }
    }
  }

  getCurrentValues() {
    return this._currentValues;
  }

  getStateName() {
    return this.currentState;
  }
}

export { STATE_CONFIG };
