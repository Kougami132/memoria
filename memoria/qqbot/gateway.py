from __future__ import annotations

import asyncio
import json
import logging
import random
import time
import urllib.error
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

try:
    import httpx
except ImportError:  # pragma: no cover - the application dependency includes httpx
    httpx = None

logger = logging.getLogger(__name__)

# Hermes sends this event subscription from inside its adapter rather than exposing
# it as a user setting. Keep the compatibility constructor argument, but do not let
# stale values from older Memoria installations override this payload.
DEFAULT_GATEWAY_INTENTS = (1 << 25) | (1 << 30) | (1 << 12) | (1 << 26)
READY_TIMEOUT_SECONDS = 30


class QQGatewayAPIError(RuntimeError):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class QQGatewayConfigurationError(RuntimeError):
    """The bot configuration cannot be accepted by QQ Gateway."""


class QQGatewayCloseError(RuntimeError):
    """The Gateway closed the connection with a QQ-specific close code."""

    def __init__(self, code: int | None, reason: str = "") -> None:
        self.code = code
        self.reason = reason
        detail = f"{code}"
        if reason:
            detail += f" ({reason})"
        super().__init__(f"QQ Gateway closed the connection: {detail}")


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
        del intents
        self.intents = DEFAULT_GATEWAY_INTENTS
        self.on_event = on_event
        self.on_error = on_error
        self._stop = asyncio.Event()
        self._ws: Any = None
        self._session_id: str | None = None
        self._sequence: int | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._event_tasks: set[asyncio.Task] = set()
        self._token: str | None = None
        self._token_expires_at: datetime | None = None
        self._token_lock = asyncio.Lock()
        self._gateway_url: str | None = None
        self._http_client: Any = None
        self._http_client_lock = asyncio.Lock()

    async def fetch_token(self, session: Any = None) -> str:
        async with self._token_lock:
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
                raise QQGatewayAPIError(
                    f"QQ token API returned HTTP {exc.code}: {self._read_error_body(exc)}",
                    self._retry_after(exc),
                ) from exc
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
            url = await asyncio.to_thread(_request)
            self._gateway_url = url
            return url
        except urllib.error.HTTPError as exc:
            raise QQGatewayAPIError(
                f"QQ Gateway API returned HTTP {exc.code}: {self._read_error_body(exc)}",
                self._retry_after(exc),
            ) from exc

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

    @staticmethod
    def _retry_after(error: urllib.error.HTTPError) -> float | None:
        value = error.headers.get("Retry-After") if error.headers else None
        try:
            delay = float(value)
        except (TypeError, ValueError):
            return None
        return max(0.0, min(delay, 300.0))

    def invalidate_token(self) -> None:
        self._token = None
        self._token_expires_at = None

    async def run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                token = await self.fetch_token()
                gateway_url = self._gateway_url or await self.fetch_gateway_url(token)
                reconnect_delay = await self._run_connection(token, gateway_url)
                await self._wait_before_reconnect(reconnect_delay, backoff)
                backoff = min(max(backoff * 2, 1.0), 30.0)
            except asyncio.CancelledError:
                raise
            except QQGatewayConfigurationError as exc:
                logger.error("QQ Gateway configuration is invalid: %s", exc)
                if self.on_error:
                    await self.on_error(exc)
                self._stop.set()
                return
            except QQGatewayCloseError as exc:
                if exc.code in {4004}:
                    self.invalidate_token()
                if exc.code in {4013, 4014}:
                    message = {
                        4013: "4013 invalid intents",
                        4014: "4014 intents not authorized",
                    }[exc.code]
                    error = QQGatewayConfigurationError(
                        f"QQ Gateway rejected the configured event intents: {message}"
                    )
                    logger.error("%s", error)
                    if self.on_error:
                        await self.on_error(error)
                    self._stop.set()
                    return
                logger.warning("%s", exc)
                if self.on_error:
                    await self.on_error(exc)
                await self._wait_before_reconnect(None, backoff)
                backoff = min(backoff * 2, 30.0)
            except Exception as exc:  # noqa: BLE001 - reconnect on any transport/API failure
                if self._gateway_url and self._is_gateway_url_invalid(exc):
                    self._gateway_url = None
                logger.warning("QQ Gateway disconnected: %s", exc)
                if self.on_error:
                    await self.on_error(exc)
                await self._wait_before_reconnect(
                    exc.retry_after if isinstance(exc, QQGatewayAPIError) else None,
                    backoff,
                )
                backoff = min(backoff * 2, 30.0)

    @staticmethod
    def _is_gateway_url_invalid(error: Exception) -> bool:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
        return status_code in {404, 410}

    async def _run_connection(self, token: str, gateway_url: str) -> float | None:
        async with websockets.connect(gateway_url, ping_interval=None) as ws:
            self._ws = ws
            hello = json.loads(await ws.recv())
            if hello.get("op") != 10:
                raise QQGatewayConfigurationError(
                    f"QQ Gateway did not send Hello (opcode 10); received opcode {hello.get('op')!r}"
                )
            heartbeat_interval = int((hello.get("d") or {}).get("heartbeat_interval") or 45000) / 1000
            logger.info("QQ Gateway Hello received; heartbeat interval=%ss", heartbeat_interval)
            self._heartbeat_task = asyncio.create_task(self._heartbeat(heartbeat_interval))
            try:
                if self._session_id:
                    logger.info("QQ Gateway sending Resume")
                    await ws.send(json.dumps({"op": 6, "d": {"token": f"QQBot {token}", "session_id": self._session_id, "seq": self._sequence}}))
                else:
                    logger.info("QQ Gateway sending Identify with internal event intents=%s", self.intents)
                    await ws.send(json.dumps({"op": 2, "d": {"token": f"QQBot {token}", "intents": self.intents, "shard": [0, 1], "properties": {"$os": "memoria", "$browser": "memoria", "$device": "memoria"}}}))
                ready = False
                deadline = asyncio.get_running_loop().time() + READY_TIMEOUT_SECONDS
                while True:
                    if ready:
                        raw = await ws.recv()
                    else:
                        remaining = deadline - asyncio.get_running_loop().time()
                        if remaining <= 0:
                            raise QQGatewayConfigurationError(
                                f"QQ Gateway connected but READY was not received within {READY_TIMEOUT_SECONDS} seconds"
                            )
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                        except TimeoutError as exc:
                            raise QQGatewayConfigurationError(
                                f"QQ Gateway connected but READY was not received within {READY_TIMEOUT_SECONDS} seconds"
                            ) from exc
                    event = json.loads(raw)
                    if event.get("s") is not None:
                        self._sequence = event["s"]
                    opcode = event.get("op")
                    if opcode == 0:
                        self._session_id = (event.get("d") or {}).get("session_id", self._session_id)
                        logger.info("QQ Gateway event received: type=%s sequence=%s", event.get("t"), event.get("s"))
                        if event.get("t") in {"READY", "RESUMED"}:
                            ready = True
                            logger.info("QQ Gateway session ready: type=%s", event.get("t"))
                        if event.get("t") == "INTERACTION_CREATE":
                            received_at = asyncio.get_running_loop().time()
                            task = asyncio.create_task(self._dispatch_event(event, received_at))
                            self._event_tasks.add(task)
                            task.add_done_callback(self._event_tasks.discard)
                        else:
                            await self.on_event(event)
                    elif opcode == 7:
                        return self._reconnect_delay(event)
                    elif opcode == 9:
                        # Invalid sessions may not be resumable. A false value means
                        # the next connection must identify with a fresh session.
                        if not (event.get("d") or False):
                            self._session_id = None
                            self._sequence = None
                        return self._reconnect_delay(event)
                    elif opcode == 11:
                        continue
            except ConnectionClosed as exc:
                raise self._close_error(exc) from exc
            finally:
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    await asyncio.gather(self._heartbeat_task, return_exceptions=True)
                    self._heartbeat_task = None
                self._ws = None
        return 0.0

    async def _dispatch_event(self, event: dict, received_at: float | None = None) -> None:
        envelope_id = str(event.get("id") or "")
        interaction_id = str((event.get("d") or {}).get("id") or "")
        dispatch_delay = 0.0
        if received_at is not None:
            dispatch_delay = asyncio.get_running_loop().time() - received_at
        logger.info(
            "QQ interaction dispatched: envelope_id=%s interaction_id_present=%s "
            "dispatch_delay_ms=%.1f",
            envelope_id or "-", bool(interaction_id), dispatch_delay * 1000,
        )
        try:
            await self.on_event(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("QQ Gateway event handler failed: type=%s", event.get("t"))

    async def acknowledge_interaction(self, interaction_id: str, code: int = 0) -> None:
        started_at = time.monotonic()
        logger.info("QQ interaction ACK started: id_present=%s code=%s", bool(interaction_id), code)
        token = await self.fetch_token()
        try:
            if httpx is None:
                raise RuntimeError("httpx is required for QQ interaction ACK")
            client = await self._get_http_client()
            response = await client.put(
                f"https://api.sgroup.qq.com/interactions/{interaction_id}",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"QQBot {token}",
                    "User-Agent": "QQBot (Memoria, 1.0)",
                },
                json={"code": code},
                timeout=15.0,
            )
            status = response.status_code
            response_body = response.text[:200]
            trace_id = response.headers.get("X-Tps-Trace-Id", "")
            if status >= 400:
                raise QQGatewayAPIError(
                    f"QQ interaction ACK API returned HTTP {status}: {response_body}"
                )
            logger.info(
                "QQ interaction ACK succeeded: status=%s elapsed_ms=%.1f "
                "trace_id=%s response_body=%r",
                status, (time.monotonic() - started_at) * 1000,
                trace_id or "-", response_body,
            )
        except Exception:
            logger.warning(
                "QQ interaction ACK raised transport error: elapsed_ms=%.1f",
                (time.monotonic() - started_at) * 1000,
                exc_info=True,
            )
            raise

    async def _get_http_client(self) -> Any:
        async with self._http_client_lock:
            if self._http_client is None:
                self._http_client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
            return self._http_client

    @staticmethod
    def _close_error(error: ConnectionClosed) -> QQGatewayCloseError:
        return QQGatewayCloseError(getattr(error, "code", None), getattr(error, "reason", ""))

    @staticmethod
    def _reconnect_delay(event: dict) -> float | None:
        value = (event.get("d") if isinstance(event, dict) else None)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value)

    async def _wait_before_reconnect(self, server_delay: float | None, backoff: float) -> None:
        delay = max(server_delay or 0.0, min(backoff, 30.0))
        delay += random.uniform(0.0, min(delay * 0.1, 1.0))
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=delay)
        except TimeoutError:
            return

    async def _heartbeat(self, interval: float) -> None:
        while True:
            await asyncio.sleep(interval)
            if self._ws:
                await self._ws.send(json.dumps({"op": 1, "d": self._sequence}))

    async def stop(self) -> None:
        self._stop.set()
        if self._event_tasks:
            for task in self._event_tasks:
                task.cancel()
            await asyncio.gather(*self._event_tasks, return_exceptions=True)
            self._event_tasks.clear()
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            await asyncio.gather(self._heartbeat_task, return_exceptions=True)
            self._heartbeat_task = None
        if self._ws:
            await self._ws.close()
        self._ws = None
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
