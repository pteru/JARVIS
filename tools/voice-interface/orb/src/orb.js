// JARVIS Energy Orb — Orb Mesh
// IcosahedronGeometry with custom ShaderMaterial + noise displacement

import * as THREE from 'three';

export class EnergyOrb {
  constructor() {
    this.geometry = new THREE.IcosahedronGeometry(1.5, 5);
    this.uniforms = {
      u_time: { value: 0.0 },
      u_noiseAmplitude: { value: 0.05 },
      u_noiseFrequency: { value: 1.5 },
      u_noiseSpeed: { value: 0.3 },
      u_color: { value: new THREE.Vector3(0.75, 0.75, 0.75) },
      u_glowColor: { value: new THREE.Vector3(0.9, 0.9, 1.0) },
      u_amplitude: { value: 0.0 },
      u_pulsePhase: { value: 0.0 }
    };

    this.material = null;
    this.mesh = null;
    this.elapsedTime = 0;
    this.rotationSpeed = 0.1;

    // Smooth amplitude tracking
    this._targetAmplitude = 0;
    this._currentAmplitude = 0;
  }

  async init() {
    const [vertexShader, fragmentShader] = await Promise.all([
      fetch('./shaders/orb.vert.glsl').then(r => r.text()),
      fetch('./shaders/orb.frag.glsl').then(r => r.text())
    ]);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    return this.mesh;
  }

  update(deltaTime, stateValues, amplitude) {
    this.elapsedTime += deltaTime;

    // Smooth amplitude interpolation for natural feel
    this._targetAmplitude = amplitude;
    this._currentAmplitude += (this._targetAmplitude - this._currentAmplitude) * Math.min(1.0, deltaTime * 12);

    // Update uniforms
    this.uniforms.u_time.value = this.elapsedTime;
    this.uniforms.u_noiseAmplitude.value = stateValues.noiseAmplitude;
    this.uniforms.u_noiseSpeed.value = stateValues.noiseSpeed;
    this.uniforms.u_color.value.set(stateValues.color[0], stateValues.color[1], stateValues.color[2]);
    this.uniforms.u_glowColor.value.set(stateValues.glowColor[0], stateValues.glowColor[1], stateValues.glowColor[2]);
    this.uniforms.u_amplitude.value = this._currentAmplitude;
    this.uniforms.u_pulsePhase.value = this.elapsedTime * 1.5; // Breathing rhythm

    // Gentle rotation
    this.rotationSpeed = stateValues.rotationSpeed;
    if (this.mesh) {
      this.mesh.rotation.y += this.rotationSpeed * deltaTime;
      this.mesh.rotation.x += this.rotationSpeed * deltaTime * 0.3;
    }
  }
}
