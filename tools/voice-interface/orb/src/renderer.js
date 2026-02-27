// JARVIS Energy Orb — Three.js Renderer
// Scene setup, post-processing with bloom, render loop

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { EnergyOrb } from './orb.js';
import { ParticleSystem } from './particles.js';
import { StateMachine } from './states.js';
import { WebSocketClient } from './ws-client.js';

// --- Scene setup ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 4;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// --- Post-processing ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
renderPass.clearAlpha = 0;
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5, // strength (updated per state)
  0.8, // radius
  0.1  // threshold
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// --- State machine ---
const stateMachine = new StateMachine();

// --- Orb ---
const energyOrb = new EnergyOrb();

// --- Particles ---
const particleSystem = new ParticleSystem();

// --- Audio amplitude ---
let currentAmplitude = 0;

// --- Initialize ---
async function init() {
  // Init orb (loads shaders)
  const orbMesh = await energyOrb.init();
  scene.add(orbMesh);

  // Init particles
  const particleMesh = particleSystem.init();
  scene.add(particleMesh);

  // Add subtle ambient light for particles
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // Connect WebSocket
  const wsClient = new WebSocketClient(
    (state) => {
      if (state === 'alert') {
        stateMachine.transition('alert');
      } else {
        stateMachine.transition(state);
      }
    },
    (amplitude) => {
      currentAmplitude = amplitude;
    },
    (alertName, level) => {
      console.log(`[Alert] ${alertName} — ${level}`);
      stateMachine.transition('alert');
    }
  );
  wsClient.connect();

  // Start render loop
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const deltaTime = Math.min((now - lastTime) / 1000, 0.1); // cap delta for tab-switch
    lastTime = now;

    // Update state machine
    stateMachine.update(deltaTime);
    const stateValues = stateMachine.getCurrentValues();
    const stateName = stateMachine.getStateName();

    // Update bloom
    bloomPass.strength = stateValues.bloomStrength;

    // Update orb
    energyOrb.update(deltaTime, stateValues, currentAmplitude);

    // Update particles
    particleSystem.setState(stateName, stateValues);
    particleSystem.updateColor(deltaTime);
    particleSystem.update(deltaTime, stateName, currentAmplitude);

    // Render with post-processing
    composer.render();
  }

  requestAnimationFrame(animate);
}

// --- Resize handler ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);
});

// --- Start ---
init().catch((err) => {
  console.error('[Orb] Initialization failed:', err);
});
