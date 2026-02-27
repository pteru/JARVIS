# JARVIS Energy Orb

Reactive 3D energy orb — the visual identity component of the JARVIS voice interface. Built with Electron, Three.js, and custom GLSL shaders.

## Quick Start

```bash
npm install
npm run dev      # starts mock server + Electron app
```

## Scripts

| Command         | Description                                      |
|-----------------|--------------------------------------------------|
| `npm start`     | Launch the Electron orb window                   |
| `npm run mock`  | Start the mock WebSocket server (port 9000)      |
| `npm run dev`   | Run both mock server and Electron concurrently   |

## Visual States

| State       | Color        | Description                         |
|-------------|--------------|-------------------------------------|
| `idle`      | Silver       | Gentle breathing, slow drift        |
| `listening` | Blue         | Expanding rings, heightened noise   |
| `thinking`  | Amber        | Fast orbiting particles, high noise |
| `speaking`  | Cyan/Teal    | Audio-reactive surface pulsing      |
| `alert`     | Red          | Burst particles, aggressive noise   |
| `healthy`   | Green        | Shimmer effect, auto-returns idle   |

## WebSocket Protocol

The orb connects to `ws://localhost:9000/orb` and accepts JSON messages:

```json
{ "state": "listening" }
{ "state": "speaking", "amplitude": 0.73 }
{ "amplitude": 0.5 }
{ "alert": "vk-health", "level": "critical" }
```

## Architecture

```
main.js          Electron main process (frameless, transparent window)
preload.js       Context bridge for IPC
src/
  index.html     Entry HTML with import map for Three.js
  renderer.js    Scene, camera, post-processing, render loop
  orb.js         Orb mesh with custom ShaderMaterial
  particles.js   80 instanced spheres with state-driven animation
  states.js      State machine with smooth 500ms transitions
  ws-client.js   WebSocket client with auto-reconnect
  shaders/
    orb.vert.glsl   Vertex shader (simplex noise displacement)
    orb.frag.glsl   Fragment shader (fresnel glow + color blending)
test/
  mock-server.js    Demo server cycling through all states
```
