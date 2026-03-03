// JARVIS Energy Orb — Reflective Floor
// 3D grid plane rendered in the Three.js scene (avoids z-index issues with bloom)

import * as THREE from 'three';

const FLOOR_SIZE = 30;
const FLOOR_Y = -2.0;

const vertexShader = `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = `
  varying vec3 vWorldPos;

  uniform float uTime;
  uniform vec3 uGridColor;    // base grid line color
  uniform vec3 uGlowColor;    // center glow color
  uniform float uGlowRadius;  // radius of center glow
  uniform float uFadeRadius;  // radius of edge fade

  float gridLine(float coord, float spacing, float thickness) {
    float halfThick = thickness * 0.5;
    float modCoord = mod(coord + halfThick, spacing);
    return 1.0 - smoothstep(0.0, thickness, modCoord)
         + smoothstep(spacing - thickness, spacing, modCoord);
  }

  void main() {
    float x = vWorldPos.x;
    float z = vWorldPos.z;

    // Distance from center (directly below orb)
    float dist = length(vec2(x, z));

    // Grid lines — two spacings for depth variation
    float lineH = gridLine(z, 0.6, 0.02);   // horizontal lines (along Z)
    float lineV = gridLine(x, 1.0, 0.02);   // vertical lines (along X)

    // Combine: max for crisp intersections
    float grid = max(lineH * 0.8, lineV * 0.5);

    // Radial fade — grid fades out toward edges
    float radialFade = 1.0 - smoothstep(uFadeRadius * 0.3, uFadeRadius, dist);

    // Center glow — orb light spill on floor
    float glow = exp(-dist * dist / (uGlowRadius * uGlowRadius)) * 0.15;

    // Combine grid + glow
    vec3 color = uGridColor * grid * radialFade + uGlowColor * glow;
    float alpha = (grid * radialFade * 0.35) + glow;

    // Extra fade for very distant areas
    alpha *= radialFade;

    gl_FragColor = vec4(color, alpha);
  }
`;

export class Floor {
  constructor() {
    this.mesh = null;
  }

  init() {
    const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uGridColor: { value: new THREE.Color(0.2, 0.4, 0.7) },   // blue-ish grid
        uGlowColor: { value: new THREE.Color(0.3, 0.55, 1.0) },  // brighter blue glow
        uGlowRadius: { value: 3.0 },
        uFadeRadius: { value: 10.0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = FLOOR_Y;

    return this.mesh;
  }

  update(deltaTime) {
    if (this.mesh) {
      this.mesh.material.uniforms.uTime.value += deltaTime;
    }
  }
}
