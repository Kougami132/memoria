from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from memoria.agents.engine import AgenticRagEngine
from memoria.config import get_qq_settings
from memoria.qqbot.gateway import QQGateway
from memoria.qqbot.models import QQInboundMessage, parse_message
from memoria.qqbot.policy import QQPolicy
from memoria.storage.db import DB

logger = logging.getLogger(__name__)


@dataclass
class _QueuedMessage:
    message: QQInboundMessage


class QQBotAdapter:
    def __init__(self, db: DB, engine: AgenticRagEngine | Callable[[], AgenticRagEngine]) -> None:
        self.db = db
        self._engine = engine
        self._gateway: QQGateway | None = None
        self._gateway_task: asyncio.Task | None = None
        self._queues: dict[str, asyncio.Queue[_QueuedMessage]] = {}
        self._workers: dict[str, asyncio.Task] = {}
        self.status = "disabled"
        self.last_error: str | None = None
        self._approval_contexts: dict[str, tuple[str, str, str]] = {}
        self._running = False

    def _get_engine(self) -> AgenticRagEngine:
        if callable(self._engine):
            self._engine = self._engine()
        return self._engine

    def _policy(self) -> QQPolicy:
        return QQPolicy.from_settings({k.removeprefix("qq_"): v for k, v in self.db.get_all_settings().items() if k.startswith("qq_")} | get_qq_settings(self.db))

    async def start(self) -> None:
        policy = self._policy()
        if not policy.enabled:
            self.status = "disabled"
            return
        if not policy.app_id or not policy.client_secret:
            self.status = "error"
            self.last_error = "QQ App ID and Client Secret are required"
            return
        self.last_error = None
        self.status = "connecting"
        self._running = True
        self._gateway = QQGateway(
            policy.app_id,
            policy.client_secret,
            policy.gateway_intents,
            self.handle_event,
            self._handle_gateway_error,
        )
        self._gateway_task = asyncio.create_task(self._gateway.run())

    async def stop(self) -> None:
        self._running = False
        if self._gateway:
            await self._gateway.stop()
        if self._gateway_task:
            self._gateway_task.cancel()
            await asyncio.gather(self._gateway_task, return_exceptions=True)
        for task in self._workers.values():
            task.cancel()
        self._workers.clear()
        self._queues.clear()
        self.status = "disabled"

    async def _handle_gateway_error(self, error: Exception) -> None:
        if not self._running:
            return
        self.status = "error"
        self.last_error = str(error)
        logger.error("QQ Gateway connection failed: %s", error)

    async def reload(self) -> None:
        await self.stop()
        self.last_error = None
        await self.start()

    async def handle_event(self, event: dict) -> None:
        if event.get("t") == "READY":
            self.status = "connected"
            return
        if event.get("t") == "INTERACTION_CREATE":
            await self._handle_interaction(event)
            return
        message = parse_message(event)
        if not message or not self.db.claim_qq_event(message.event_id):
            return
        policy = self._policy()
        if not policy.allows(message.context_type, message.user_openid, message.group_openid):
            return
        if message.context_type == "group" and policy.group_require_mention and not self._has_bot_mention(event):
            return
        key = f"{policy.app_id}:{message.context_type}:{message.context_id}"
        queue = self._queues.setdefault(key, asyncio.Queue(maxsize=policy.max_queue_size))
        if queue.full():
            logger.warning("QQ context queue full: context=%s", key)
            return
        await queue.put(_QueuedMessage(message))
        if key not in self._workers or self._workers[key].done():
            self._workers[key] = asyncio.create_task(self._worker(key, queue))

    @staticmethod
    def _has_bot_mention(event: dict) -> bool:
        data = event.get("d") or {}
        mentions = data.get("mentions") or []
        if isinstance(mentions, list) and mentions:
            return True
        content = str(data.get("content") or "")
        return "<@!" in content or "<@" in content

    async def _handle_interaction(self, event: dict) -> None:
        data = event.get("d") or {}
        interaction_data = data.get("data") or {}
        custom_id = str(interaction_data.get("custom_id") or interaction_data.get("customId") or "")
        parts = custom_id.split(":")
        if len(parts) != 3 or parts[0] != "approve" or parts[2] not in {"allow-once", "deny"}:
            return
        approval_id, action = parts[1], parts[2]
        context = self._approval_contexts.get(approval_id)
        if context is None:
            return
        context_type, context_id, initiator_openid = context
        clicker = self._interaction_openid(data)
        # Group approval is deliberately fail-closed until the interaction payload
        # is proven to contain a trustworthy member identity and policy enables it.
        policy = self._policy()
        if context_type != "c2c" or not policy.c2c_enabled or clicker != initiator_openid:
            if context_type == "group" and policy.group_approval_enabled:
                logger.warning("Rejecting QQ group approval until member identity binding is enabled: approval=%s", approval_id)
            return
        from memoria.connectors.host.approval import global_host_approval_manager
        approved = action != "deny"
        approval = global_host_approval_manager.respond(approval_id, approved=approved)
        if approval:
            self.db.update_approval_message_status(approval_id, approval.status)
            self._approval_contexts.pop(approval_id, None)
            await self.send_target(context_type, context_id, "已处理审批：" + ("允许执行" if approved else "拒绝执行"))

    @staticmethod
    def _interaction_openid(data: dict) -> str:
        candidates = [
            (data.get("user") or {}).get("openid"),
            (data.get("user") or {}).get("user_openid"),
            (data.get("author") or {}).get("user_openid"),
            (data.get("member") or {}).get("member_openid"),
        ]
        return next((str(value) for value in candidates if value), "")

    async def _worker(self, key: str, queue: asyncio.Queue[_QueuedMessage]) -> None:
        while True:
            item = await queue.get()
            try:
                await asyncio.wait_for(self._process(item.message), timeout=self._policy().run_timeout_seconds)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("QQ message processing failed: context=%s", key)
            finally:
                queue.task_done()

    async def _process(self, message: QQInboundMessage) -> None:
        session = self.db.get_or_create_qq_session(
            self._policy().app_id, message.context_type, message.context_id, message.content,
        )
        prompt = message.content
        if message.context_type == "group" and message.group_member_openid:
            prompt = f"[QQ 群成员 {message.group_member_openid}]\n{prompt}"
        stream = self._get_engine().run_stream(prompt, session_id=session["id"], bot_id=None)
        events: list[dict] = []
        while True:
            event, finished = await asyncio.to_thread(self._next_stream_event, stream)
            if finished:
                break
            events.append(event)
            if event.get("type") == "approval_required":
                approval_id = str(event.get("approval_id") or "")
                if approval_id:
                    self._approval_contexts[approval_id] = (
                        message.context_type, message.context_id, message.user_openid,
                    )
                    await self.send_approval(message, event)
        answer = next((str(event.get("answer") or "") for event in reversed(events) if event.get("type") == "done"), "")
        if answer:
            await self.send_message(message, answer)

    @staticmethod
    def _next_stream_event(stream: Any) -> tuple[dict, bool]:
        try:
            return next(stream), False
        except StopIteration:
            return {}, True

    async def send_approval(self, message: QQInboundMessage, event: dict) -> None:
        approval_id = str(event.get("approval_id") or "")
        command = str(event.get("command") or "")
        content = f"需要审批才能执行命令：\n{command}\n审批编号：{approval_id}"
        keyboard = {
            "content": [
                {"id": f"approve:{approval_id}:allow-once", "render_data": {"label": "允许一次", "visited_label": "已处理", "style": 0}},
                {"id": f"approve:{approval_id}:deny", "render_data": {"label": "拒绝", "visited_label": "已处理", "style": 1}},
            ]
        }
        await self.send_target(message.context_type, message.context_id, content, message.message_id, keyboard=keyboard)

    async def send_message(self, message: QQInboundMessage, content: str) -> None:
        await self.send_target(message.context_type, message.context_id, content, message.message_id)

    async def send_target(
        self,
        context_type: str,
        context_id: str,
        content: str,
        reply_to: str | None = None,
        keyboard: dict | None = None,
    ) -> None:
        token = await self._gateway.fetch_token() if self._gateway else None
        if not token:
            raise RuntimeError("QQ Gateway is not connected")
        endpoint = (
            f"https://api.sgroup.qq.com/v2/users/{context_id}/messages"
            if context_type == "c2c"
            else f"https://api.sgroup.qq.com/v2/groups/{context_id}/messages"
        )
        import urllib.request
        chunks = [content[index:index + 4000] for index in range(0, len(content), 4000)] or [""]
        for index, chunk in enumerate(chunks):
            payload_data = {"content": chunk, "msg_type": 0}
            if reply_to and index == 0:
                payload_data["msg_id"] = reply_to
            if keyboard and index == 0:
                payload_data["keyboard"] = keyboard
            payload = json.dumps(payload_data, ensure_ascii=False).encode()
            for attempt in range(3):
                request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json", "Authorization": f"QQBot {token}"}, method="POST")
                try:
                    await asyncio.to_thread(self._post, request)
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code == 401 and attempt == 0 and self._gateway:
                        self._gateway.invalidate_token()
                        token = await self._gateway.fetch_token()
                        continue
                    if exc.code == 429 and attempt < 2:
                        retry_after = float(exc.headers.get("Retry-After", "1"))
                        await asyncio.sleep(min(max(retry_after, 0.1), 10.0))
                        continue
                    raise

    @staticmethod
    def _post(request: Any) -> None:
        import urllib.request
        with urllib.request.urlopen(request, timeout=15):
            pass
