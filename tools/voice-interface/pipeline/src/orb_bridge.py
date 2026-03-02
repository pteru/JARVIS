"""WebSocket server that sends state/amplitude updates to the Energy Orb."""

import asyncio
import json
import logging
from websockets.asyncio.server import serve, ServerConnection

logger = logging.getLogger(__name__)


class OrbBridge:
    def __init__(self, port: int = 9000):
        self._port = port
        self._clients: set[ServerConnection] = set()
        self._server = None
        self._current_state = "idle"

    async def _handler(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        remote = websocket.remote_address
        logger.info("Orb client connected: %s", remote)
        # Send current state on connect
        await websocket.send(json.dumps({"state": self._current_state}))
        try:
            async for _ in websocket:
                pass  # We don't expect inbound messages, but keep connection alive
        finally:
            self._clients.discard(websocket)
            logger.info("Orb client disconnected: %s", remote)

    async def start(self) -> None:
        self._server = await serve(self._handler, "0.0.0.0", self._port)
        logger.info("Orb bridge listening on ws://0.0.0.0:%d", self._port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _broadcast(self, message: dict) -> None:
        if not self._clients:
            return
        payload = json.dumps(message)
        dead = set()
        for ws in self._clients:
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    async def set_state(self, state: str) -> None:
        self._current_state = state
        await self._broadcast({"state": state})

    async def send_amplitude(self, amplitude: float) -> None:
        await self._broadcast({"amplitude": round(amplitude, 3)})

    async def send_alert(self, source: str, level: str) -> None:
        await self._broadcast({"alert": source, "level": level})
