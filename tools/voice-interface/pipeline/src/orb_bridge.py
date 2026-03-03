"""WebSocket server that sends state/amplitude/session updates to the Energy Orb."""

import asyncio
import json
import logging
from typing import Callable
from websockets.asyncio.server import serve, ServerConnection

logger = logging.getLogger(__name__)


class OrbBridge:
    def __init__(self, port: int = 9000):
        self._port = port
        self._clients: set[ServerConnection] = set()
        self._server = None
        self._current_state = "idle"
        self._current_sessions = []
        self._on_command: Callable[[str, dict], None] | None = None

    def set_command_handler(self, handler: Callable[[str, dict], None]) -> None:
        """Register a callback for inbound commands from the orb UI."""
        self._on_command = handler

    async def _handler(self, websocket: ServerConnection) -> None:
        self._clients.add(websocket)
        remote = websocket.remote_address
        logger.info("Orb client connected: %s", remote)
        # Send current state + sessions on connect
        await websocket.send(json.dumps({"state": self._current_state}))
        if self._current_sessions:
            await websocket.send(json.dumps({"sessions": self._current_sessions}))
        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                    self._handle_inbound(msg)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning("Invalid inbound message from orb: %s", e)
        finally:
            self._clients.discard(websocket)
            logger.info("Orb client disconnected: %s", remote)

    def _handle_inbound(self, msg: dict) -> None:
        """Process commands from the orb UI (e.g., switch_session)."""
        command = msg.get("command")
        if command and self._on_command:
            self._on_command(command, msg)

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

    async def send_sessions(self, sessions: list[dict]) -> None:
        """Broadcast the session list to all connected orb clients."""
        self._current_sessions = sessions
        await self._broadcast({"sessions": sessions})
