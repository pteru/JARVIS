// JARVIS Energy Orb — Particle System
// 80 instanced spheres orbiting the orb with state-driven animations

import * as THREE from 'three';

const PARTICLE_COUNT = 80;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 3.5;

export class ParticleSystem {
  constructor() {
    this.mesh = null;
    this.particles = [];
    this.elapsedTime = 0;
    this.color = new THREE.Color(0.75, 0.75, 0.75);
    this._targetColor = new THREE.Color(0.75, 0.75, 0.75);
  }

  init() {
    const geometry = new THREE.SphereGeometry(0.02, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Random spherical position
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      this.particles.push({
        basePosition: new THREE.Vector3(x, y, z),
        position: new THREE.Vector3(x, y, z),
        radius,
        theta,
        phi,
        speed: 0.2 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
        driftOffset: new THREE.Vector3(
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02
        ),
        opacity: 0.4 + Math.random() * 0.4
      });

      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    return this.mesh;
  }

  update(deltaTime, state, amplitude) {
    this.elapsedTime += deltaTime;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this.particles[i];

      switch (state) {
        case 'idle':
          this._animateIdle(p, deltaTime);
          break;
        case 'listening':
          this._animateListening(p, deltaTime, i);
          break;
        case 'thinking':
          this._animateThinking(p, deltaTime);
          break;
        case 'speaking':
          this._animateSpeaking(p, deltaTime, amplitude);
          break;
        case 'alert':
          this._animateAlert(p, deltaTime);
          break;
        case 'healthy':
          this._animateHealthy(p, deltaTime, i);
          break;
        default:
          this._animateIdle(p, deltaTime);
      }

      dummy.position.copy(p.position);
      // Scale particles slightly based on state
      const scale = state === 'alert' ? 1.5 : state === 'thinking' ? 1.2 : 1.0;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setState(newState, stateValues) {
    this._targetColor.setRGB(stateValues.color[0], stateValues.color[1], stateValues.color[2]);
  }

  updateColor(deltaTime) {
    this.color.lerp(this._targetColor, Math.min(1.0, deltaTime * 4));
    this.mesh.material.color.copy(this.color);
  }

  _animateIdle(p, deltaTime) {
    // Slow random drift + gentle orbital motion
    p.theta += p.speed * 0.15 * deltaTime;
    const drift = Math.sin(this.elapsedTime * 0.5 + p.phase) * 0.1;
    const r = p.radius + drift;

    p.position.x = r * Math.sin(p.phi) * Math.cos(p.theta);
    p.position.y = r * Math.sin(p.phi) * Math.sin(p.theta) + p.driftOffset.y * Math.sin(this.elapsedTime + p.phase);
    p.position.z = r * Math.cos(p.phi);
  }

  _animateListening(p, deltaTime, index) {
    // Particles form expanding concentric rings
    p.theta += p.speed * 0.3 * deltaTime;
    const ringIndex = index % 4;
    const ringRadius = 2.5 + ringIndex * 0.4 + Math.sin(this.elapsedTime * 2.0 + ringIndex) * 0.2;
    const ringHeight = (ringIndex - 1.5) * 0.5;

    p.position.x = ringRadius * Math.cos(p.theta);
    p.position.y = ringHeight + Math.sin(this.elapsedTime * 1.5 + p.phase) * 0.1;
    p.position.z = ringRadius * Math.sin(p.theta);
  }

  _animateThinking(p, deltaTime) {
    // Faster orbit, tighter radius
    p.theta += p.speed * 0.8 * deltaTime;
    const tightRadius = p.radius * 0.7 + Math.sin(this.elapsedTime * 3.0 + p.phase) * 0.15;

    p.position.x = tightRadius * Math.sin(p.phi) * Math.cos(p.theta);
    p.position.y = tightRadius * Math.sin(p.phi) * Math.sin(p.theta);
    p.position.z = tightRadius * Math.cos(p.phi);
  }

  _animateSpeaking(p, deltaTime, amplitude) {
    // Pulse in/out with amplitude
    p.theta += p.speed * 0.4 * deltaTime;
    const pulse = 1.0 + amplitude * 0.5 * Math.sin(this.elapsedTime * 6.0 + p.phase);
    const r = p.radius * pulse;

    p.position.x = r * Math.sin(p.phi) * Math.cos(p.theta);
    p.position.y = r * Math.sin(p.phi) * Math.sin(p.theta);
    p.position.z = r * Math.cos(p.phi);
  }

  _animateAlert(p, deltaTime) {
    // Burst outward then snap back
    const burstCycle = (this.elapsedTime * 1.5 + p.phase) % (Math.PI * 2);
    const burstFactor = Math.max(0, Math.sin(burstCycle));
    const r = p.radius + burstFactor * 1.5;

    p.theta += p.speed * 0.6 * deltaTime;

    p.position.x = r * Math.sin(p.phi) * Math.cos(p.theta);
    p.position.y = r * Math.sin(p.phi) * Math.sin(p.theta);
    p.position.z = r * Math.cos(p.phi);
  }

  _animateHealthy(p, deltaTime, index) {
    // Gentle shimmer — random opacity flicker via position jitter
    p.theta += p.speed * 0.2 * deltaTime;
    const shimmer = Math.sin(this.elapsedTime * 4.0 + index * 0.7) * 0.05;
    const r = p.radius + shimmer;

    p.position.x = r * Math.sin(p.phi) * Math.cos(p.theta);
    p.position.y = r * Math.sin(p.phi) * Math.sin(p.theta) + shimmer * 2;
    p.position.z = r * Math.cos(p.phi);
  }
}
