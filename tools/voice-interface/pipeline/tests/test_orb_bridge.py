"""Tests for orb WebSocket bridge."""

import asyncio
import json
import pytest
import websockets
from src.orb_bridge import OrbBridge


@pytest.fixture
async def bridge():
    b = OrbBridge(port=9876)  # test port to avoid conflicts
    await b.start()
    yield b
    await b.stop()


@pytest.mark.asyncio
async def test_state_change(bridge):
    """Connect a client and verify it receives state messages."""
    async with websockets.connect("ws://localhost:9876") as ws:
        # Should receive current state on connect
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["state"] == "idle"  # default state

        await bridge.set_state("listening")
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert data["state"] == "listening"


@pytest.mark.asyncio
async def test_amplitude(bridge):
    """Verify amplitude messages are sent."""
    async with websockets.connect("ws://localhost:9876") as ws:
        # Consume the initial state message
        await asyncio.wait_for(ws.recv(), timeout=2.0)

        await bridge.send_amplitude(0.73)
        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
        data = json.loads(msg)
        assert abs(data["amplitude"] - 0.73) < 0.01
