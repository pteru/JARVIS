# JARVIS Energy Orb — Sandbox Spec

## Objective

Build a complete, runnable Electron app that renders a reactive 3D energy orb using Three.js and custom GLSL shaders. The orb responds to state changes and audio amplitude received over WebSocket. This is the visual identity component of the JARVIS voice interface.

## Output Location

All code goes in `tools/voice-interface/orb/`.

## Target File Structure

```
tools/voice-interface/orb/
├── package.json               # electron, three, ws dependencies
├── main.js                    # Electron main process (frameless, transparent)
├── preload.js                 # Context bridge for IPC
├── src/
│   ├── index.html             # Entry HTML (dark bg, full viewport canvas)
│   ├── renderer.js            # Three.js scene, camera, render loop, post-processing
│   ├── orb.js                 # Orb mesh creation + shader material + update methods
│   ├── particles.js           # Instanced particle system orbiting the orb
│   ├── states.js              # State machine with smooth transitions between states
│   ├── ws-client.js           # WebSocket client connecting to ws://localhost:9000/orb
│   └── shaders/
│       ├── orb.vert.glsl      # Vertex shader with simplex noise displacement
│       └── orb.frag.glsl      # Fragment shader with color blending and fresnel glow
├── test/
│   └── mock-server.js         # Node.js WebSocket server that cycles through all states
└── README.md                  # How to run: npm install && npm start
```

## Technical Requirements

### 1. Electron Shell (`main.js`)

- Frameless window (`frame: false`)
- Transparent background (`transparent: true`, `backgroundColor: '#00000000'`)
- Default window size: 600x600
- Resizable
- `alwaysOnTop` configurable (default: false)
- Load `src/index.html`
- Context isolation enabled, node integration disabled
- Preload script for any IPC needs

### 2. Three.js Scene (`renderer.js`)

- **Camera**: PerspectiveCamera, FOV 60, positioned at z=4
- **Renderer**: WebGLRenderer with `alpha: true` (transparent background), antialias enabled
- **Post-processing**: EffectComposer with RenderPass + UnrealBloomPass
  - Bloom strength varies by state (idle=0.5, alert=2.0, speaking=1.2)
  - Bloom radius: 0.8, threshold: 0.1
- **Render loop**: requestAnimationFrame, passes elapsed time to orb and particles
- **Resize handler**: window resize updates camera aspect and renderer size

### 3. Orb Mesh (`orb.js`)

- **Geometry**: `IcosahedronGeometry(1.5, 5)` — radius 1.5, 5 subdivisions (~5000 vertices for smooth deformation)
- **Material**: `ShaderMaterial` with custom vertex and fragment shaders
- **Uniforms**:
  - `u_time` (float) — elapsed time for noise animation
  - `u_noiseAmplitude` (float) — how much vertices displace (varies by state)
  - `u_noiseFrequency` (float) — noise scale (default 1.5)
  - `u_noiseSpeed` (float) — noise animation speed (varies by state)
  - `u_color` (vec3) — base orb color (varies by state)
  - `u_glowColor` (vec3) — rim/fresnel glow color
  - `u_amplitude` (float) — audio amplitude for speaking state (0.0–1.0)
  - `u_pulsePhase` (float) — for idle breathing animation
- **Vertex shader** (`orb.vert.glsl`):
  - Implement 3D simplex noise (include noise function in shader or as a separate chunk)
  - Displace vertices along their normals by: `normal * snoise(position * u_noiseFrequency + u_time * u_noiseSpeed) * u_noiseAmplitude`
  - In speaking state, add extra displacement: `normal * u_amplitude * 0.3`
  - Pass `vNormal` and `vPosition` to fragment shader
- **Fragment shader** (`orb.frag.glsl`):
  - Fresnel rim glow: stronger glow at edges (dot product of normal and view direction)
  - Mix `u_color` with `u_glowColor` based on fresnel factor
  - Slight transparency at center, more opaque at edges
  - Output alpha for transparency support
- **Methods**:
  - `update(deltaTime, state, amplitude)` — update uniforms each frame
  - `setState(newState)` — trigger smooth transition (lerp colors and noise params over ~0.5s)

### 4. Particle System (`particles.js`)

- **Count**: 80 instanced small spheres (`SphereGeometry(0.02, 8, 8)`)
- **Material**: `MeshBasicMaterial` with matching state color, semi-transparent
- **Distribution**: Random positions on a sphere of radius 2.5–3.5 (around the orb)
- **Animation per state**:
  - `idle`: Slow random drift, gentle orbital motion
  - `listening`: Particles form expanding concentric rings
  - `thinking`: Particles orbit faster, tighter radius
  - `speaking`: Particles pulse in/out with amplitude
  - `alert`: Particles burst outward then snap back
  - `healthy`: Gentle shimmer effect (random opacity flicker)
- **Methods**:
  - `update(deltaTime, state, amplitude)` — animate particles each frame
  - `setState(newState)` — adjust particle behavior parameters

### 5. State Machine (`states.js`)

- **States**: `idle`, `listening`, `thinking`, `speaking`, `alert`, `healthy`
- **Default state**: `idle`
- **State config object**:
  ```javascript
  const STATE_CONFIG = {
    idle: {
      color: [0.75, 0.75, 0.75],        // silver
      glowColor: [0.9, 0.9, 1.0],
      noiseAmplitude: 0.05,
      noiseSpeed: 0.3,
      bloomStrength: 0.5,
      rotationSpeed: 0.1
    },
    listening: {
      color: [0.27, 0.53, 1.0],         // blue
      glowColor: [0.4, 0.7, 1.0],
      noiseAmplitude: 0.12,
      noiseSpeed: 0.6,
      bloomStrength: 0.8,
      rotationSpeed: 0.2
    },
    thinking: {
      color: [1.0, 0.67, 0.2],          // amber
      glowColor: [1.0, 0.85, 0.4],
      noiseAmplitude: 0.15,
      noiseSpeed: 1.2,
      bloomStrength: 1.0,
      rotationSpeed: 0.5
    },
    speaking: {
      color: [0.0, 0.87, 0.8],          // cyan/teal
      glowColor: [0.3, 1.0, 0.95],
      noiseAmplitude: 0.1,              // base, audio adds more
      noiseSpeed: 0.8,
      bloomStrength: 1.2,
      rotationSpeed: 0.3
    },
    alert: {
      color: [1.0, 0.2, 0.2],           // red
      glowColor: [1.0, 0.4, 0.3],
      noiseAmplitude: 0.25,
      noiseSpeed: 1.5,
      bloomStrength: 2.0,
      rotationSpeed: 0.8
    },
    healthy: {
      color: [0.2, 1.0, 0.53],          // green
      glowColor: [0.5, 1.0, 0.7],
      noiseAmplitude: 0.08,
      noiseSpeed: 0.5,
      bloomStrength: 0.8,
      rotationSpeed: 0.15
    }
  };
  ```
- **Transitions**: Smooth lerp over 500ms between states (all numeric values interpolated)
- **Special**: `healthy` state auto-returns to `idle` after 2 seconds
- **Methods**:
  - `transition(newState)` — start smooth transition
  - `update(deltaTime)` — advance transition interpolation
  - `getCurrentValues()` — return interpolated state values

### 6. WebSocket Client (`ws-client.js`)

- Connect to `ws://localhost:9000/orb`
- Auto-reconnect on disconnect (exponential backoff: 1s, 2s, 4s, max 10s)
- Parse incoming JSON messages:
  - `{ "state": "listening" }` → trigger state transition
  - `{ "state": "speaking", "amplitude": 0.73 }` → state + audio data
  - `{ "amplitude": 0.5 }` → audio data only (no state change)
  - `{ "alert": "vk-health", "level": "critical" }` → trigger alert state
- On connection lost, orb continues in current state (graceful degradation)
- Log connection status to console

### 7. Mock Server (`test/mock-server.js`)

- Node.js WebSocket server on port 9000
- Cycles through a demo sequence:
  1. `idle` (3s)
  2. `listening` (2s)
  3. `thinking` (3s)
  4. `speaking` with simulated amplitude sine wave (5s)
  5. `healthy` (2s, auto-returns to idle)
  6. `alert` (2s)
  7. Back to `idle` (3s)
  8. Repeat
- Console logs each state change
- Run with: `node test/mock-server.js`

### 8. Package Configuration (`package.json`)

```json
{
  "name": "jarvis-orb",
  "version": "1.0.0",
  "description": "JARVIS Energy Orb — Reactive visual identity",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "mock": "node test/mock-server.js",
    "dev": "concurrently \"npm run mock\" \"npm start\""
  },
  "dependencies": {
    "electron": "^33.0.0",
    "three": "^0.170.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

## Visual Quality Requirements

- The orb must look **cinematic**, not like a tech demo. Inspiration: MCU JARVIS holographic UI, iOS Siri orb, Cortana's ring from Halo.
- Smooth 60fps on a mid-range GPU (GTX 1060 / integrated Intel UHD 630).
- Transitions between states must be smooth (no pops or jumps).
- The bloom glow should create a soft halo around the orb, not harsh edges.
- The idle state should feel alive — subtle breathing animation, gentle particle drift. Never static.
- The speaking state should feel responsive — the surface should visibly pulse with each amplitude peak.

## Simplex Noise

Include a simplex noise implementation directly in the vertex shader (GLSL). A common approach is to include the Ashima Arts simplex noise functions (MIT licensed, widely used in Three.js projects). Do NOT use a texture-based noise lookup.

## Testing

After implementation:
1. Run `npm install` in `tools/voice-interface/orb/`
2. Run `npm run dev` — mock server + Electron should both start
3. Verify all 6 states render correctly with distinct visuals
4. Verify smooth transitions between states
5. Verify the speaking state responds to amplitude changes
6. Verify the window is frameless and transparent

## Constraints

- All code in `tools/voice-interface/orb/` — do not modify files outside this directory
- No external CDN links — all dependencies via npm
- No build step required (no webpack/vite/rollup) — use ES modules natively in Electron
- GLSL shaders stored as separate `.glsl` files, loaded at runtime
- The mock server must be runnable independently (`node test/mock-server.js`)

## References

- Design doc: `docs/plans/2026-02-27-energy-orb-design.md`
- Voice interface spec: `backlogs/orchestrator/voice-interface.md`
- Three.js docs: https://threejs.org/docs/
- UnrealBloomPass: https://threejs.org/examples/#webgl_postprocessing_unreal_bloom
- Simplex noise GLSL: Ashima Arts (https://github.com/ashima/webgl-noise)
