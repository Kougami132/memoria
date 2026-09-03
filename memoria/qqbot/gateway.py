from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import websockets

logger = logging.getLogger(__name__)


class QQGateway:
    """Small official QQ Gateway client. The adapter owns message semantics."""

    def __init__(
        self,
        app_id: str,
        client_secret: str,
        intents: int,
        on_event: Callable[[dict], Awaitable[None]],
        on_error: Callable[[Exception], Awaitable[None]] | None = None,
    ) -> None:
        self.app_id = app_id
        self.client_secret = client_secret
        self.intents = intents
        self.on_event = on_event
        self.on_error = on_error
        self._stop = asyncio.Event()
        self._ws: Any = None
        self._session_id: str | None = None
        self._sequence: int | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._token: str | None = None
        self._token_expires_at: datetime | None = None
        self._reconnect_requested = False

    async def fetch_token(self, session: Any = None) -> str:
        now = datetime.now(UTC)
        if self._token and self._token_expires_at and now < self._token_expires_at:
            return self._token
        import urllib.request

        payload = json.dumps({"appId": self.app_id, "clientSecret": self.client_secret}).encode()
        request = urllib.request.Request(
            "https://bots.qq.com/app/getAppAccessToken", data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        def _request() -> dict:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read())
        try:
            result = await asyncio.to_thread(_request)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"QQ token API returned HTTP {exc.code}: {self._read_error_body(exc)}") from exc
        token = result.get("access_token")
        if not token:
            raise RuntimeError(f"QQ token API rejected the request: {self._describe_response(result)}")
        self._token = str(token)
        expires_in = max(60, int(result.get("expires_in") or 7200))
        self._token_expires_at = now + timedelta(seconds=expires_in - 60)
        return self._token

    async def fetch_gateway_url(self, token: str) -> str:
        import urllib.request

        request = urllib.request.Request(
            "https://api.sgroup.qq.com/gateway",
            headers={"Authorization": f"QQBot {token}"},
        )

        def _request() -> str:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.loads(response.read())
            url = result.get("url")
            if not url:
                raise RuntimeError("QQ Gateway response did not contain url")
            return str(url)

        try:
            return await asyncio.to_thread(_request)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"QQ Gateway API returned HTTP {exc.code}: {self._read_error_body(exc)}") from exc

    @staticmethod
    def _describe_response(result: dict) -> str:
        details = []
        for key in ("code", "message", "msg", "err_msg"):
            value = result.get(key)
            if value not in (None, ""):
                details.append(f"{key}={value}")
        return ", ".join(details) or "unexpected response format"

    @staticmethod
    def _read_error_body(error: urllib.error.HTTPError) -> str:
        try:
            body = json.loads(error.read())
        except (OSError, ValueError):
            return "request failed"
        return QQGateway._describe_response(body) if isinstance(body, dict) else "request failed"

    def invalidate_token(self) -> None:
        self._token = None
        self._token_expires_at = None

    async def run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                token = await self.fetch_token()
                gateway_url = await self.fetch_gateway_url(token)
                await self._run_connection(token, gateway_url)
                backoff = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - reconnect on any transport/API failure
                logger.warning("QQ Gateway disconnected: %s", exc)
                if self.on_error:
                    await self.on_error(exc)
                self._reconnect_requested = False
                await asyncio.sleep(min(backoff, 30.0))
                backoff = min(backoff * 2, 30.0)

    async def _run_connection(self, token: str, gateway_url: str) -> None:
        async with websockets.connect(gateway_url, ping_interval=None) as ws:
            self._ws = ws
            hello = json.loads(await ws.recv())
            heartbeat_interval = int((hello.get("d") or {}).get("heartbeat_interval") or 45000) / 1000
            self._heartbeat_task = asyncio.create_task(self._heartbeat(heartbeat_interval))
            try:
                if self._session_id:
                    await ws.send(json.dumps({"op": 6, "d": {"token": f"QQBot {token}", "session_id": self._session_id, "seq": self._sequence}}))
                else:
                    await ws.send(json.dumps({"op": 2, "d": {"token": f"QQBot {token}", "intents": self.intents, "shard": [0, 1], "properties": {"$os": "memoria", "$browser": "memoria", "$device": "memoria"}}}))
                async for raw in ws:
                    event = json.loads(raw)
                    if event.get("s") is not None:
                        self._sequence = event["s"]
                    opcode = event.get("op")
                    if opcode == 0:
                        self._session_id = (event.get("d") or {}).get("session_id", self._session_id)
                        await self.on_event(event)
                    elif opcode == 7:
                        self._reconnect_requested = True
                        return
                    elif opcode == 9:
                        # Invalid sessions may not be resumable. A false value means
                        # the next connection must identify with a fresh session.
                        if not (event.get("d") or False):
                            self._session_id = None
                            self._sequence = None
                        return
                    elif opcode == 11:
                        continue
            finally:
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    await asyncio.gather(self._heartbeat_task, return_exceptions=True)
                    self._heartbeat_task = None
                self._ws = None

    async def _heartbeat(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            if self._ws:
                await self._ws.send(json.dumps({"op": 1, "d": self._sequence}))

    async def stop(self) -> None:
        self._stop.set()
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            await asyncio.gather(self._heartbeat_task, return_exceptions=True)
            self._heartbeat_task = None
        if self._ws:
            await self._ws.close()
        self._ws = None
