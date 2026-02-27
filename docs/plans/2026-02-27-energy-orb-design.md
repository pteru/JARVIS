# JARVIS Energy Orb — Design Document

**Date:** 2026-02-27
**Status:** Approved
**Component:** Voice Interface — Phase 2

## Overview

Reactive energy orb visual identity for the JARVIS voice interface. A floating, semi-transparent 3D sphere rendered with Three.js and custom GLSL shaders, displayed in a frameless Electron window. The orb responds to voice pipeline state changes and audio amplitude over WebSocket.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `tools/voice-interface/orb/` | Groups with other tools, leaves room for sibling voice components |
| Renderer | Three.js + custom GLSL | Best cinematic result, bloom post-processing, rich ecosystem |
| Display | Electron (frameless, transparent) | Standalone desktop window, no browser chrome, always-on-top capable |
| TTS coupling | Agnostic | Orb receives amplitude over WebSocket regardless of TTS source |
| STT | Deepgram (decided separately) | Reuses existing API key from meeting assistant |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron App (frameless, transparent, always-on-top)   │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Three.js Scene                                   │  │
│  │  - IcosahedronGeometry (subdivided, ~128 faces)   │  │
│  │  - Custom GLSL vertex shader (simplex noise)      │  │
│  │  - Custom GLSL fragment shader (color + glow)     │  │
│  │  - UnrealBloomPass post-processing                │  │
│  │  - Instanced particle system (50-100 particles)   │  │
│  │                                                   │  │
│  │  WebSocket Client ← ws://localhost:9000/orb       │  │
│  │    receives: { state, amplitude, alert }          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Visual States

| State | Base Color | Noise Amp | Noise Speed | Particles | Extra |
|-------|-----------|-----------|-------------|-----------|-------|
| idle | `#c0c0c0` silver | 0.05 | 0.3 | slow drift | gentle scale pulse |
| listening | `#4488ff` blue | 0.12 | 0.6 | expanding rings | surface ripples outward |
| thinking | `#ffaa33` amber | 0.15 | 1.2 | fast orbit | rotation accelerates |
| speaking | `#00ddcc` cyan | dynamic | 0.8 | audio pulse | FFT-driven displacement |
| alert | `#ff3333` red | 0.25 | 1.5 | burst | sharp surface spikes |
| healthy | `#33ff88` green | 0.08 | 0.5 | shimmer | 2s transition → idle |

## WebSocket Protocol

```json
{ "state": "listening" }
{ "state": "speaking", "amplitude": 0.73 }
{ "alert": "vk-health", "level": "critical" }
```

## File Structure

```
tools/voice-interface/orb/
├── package.json
├── main.js                    # Electron main process
├── preload.js                 # Context bridge
├── src/
│   ├── index.html             # Entry point
│   ├── renderer.js            # Three.js scene setup
│   ├── orb.js                 # Orb mesh + shader management
│   ├── particles.js           # Particle system
│   ├── states.js              # State machine + transitions
│   ├── ws-client.js           # WebSocket connection
│   └── shaders/
│       ├── orb.vert.glsl      # Vertex shader (noise displacement)
│       └── orb.frag.glsl      # Fragment shader (color + glow)
├── test/
│   └── mock-server.js         # WebSocket mock for testing all states
└── assets/
    └── (none initially)
```

## Scope Boundaries

**In scope:** Electron app, Three.js orb, GLSL shaders, particle system, WebSocket client, bloom post-processing, mock server for testing.

**Out of scope:** Voice pipeline (Porcupine, Deepgram, TTS), context integration, session tracker overlay.
