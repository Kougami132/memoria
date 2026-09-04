from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from memoria.agents.engine import AgenticRagEngine
from memoria.config import get_qq_settings
from memoria.qqbot.formatting import (
    MAX_MESSAGE_LENGTH,
    markdown_to_plain_text,
    split_markdown,
)
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
        self._lifecycle_lock = asyncio.Lock()

    def _get_engine(self) -> AgenticRagEngine:
        if callable(self._engine):
            self._engine = self._engine()
        return self._engine

    @staticmethod
    def _next_msg_seq(seed: str = "default") -> int:
        del seed
        time_part = int(time.time()) % 100000000
        rand = int(uuid.uuid4().hex[:4], 16)
        return (time_part ^ rand) % 65536

    @staticmethod
    def _is_markdown_unsupported(error_body: str) -> bool:
        text = error_body.lower()
        markdown_terms = ("markdown", "msg_type")
        unsupported_terms = ("unsupported", "not support", "不支持", "invalid")
        return any(term in text for term in markdown_terms) and any(term in text for term in unsupported_terms)

    def _policy(self) -> QQPolicy:
        return QQPolicy.from_settings({k.removeprefix("qq_"): v for k, v in self.db.get_all_settings().items() if k.startswith("qq_")} | get_qq_settings(self.db))

    async def start(self) -> None:
        async with self._lifecycle_lock:
            await self._start_locked()

    async def _start_locked(self) -> None:
        policy = self._policy()
        if not policy.enabled:
            self.status = "disabled"
            return
        if not policy.app_id or not policy.client_secret:
            self.status = "error"
            self.last_error = "QQ App ID and Client Secret are required"
            return
        if self._running and self._gateway_task and not self._gateway_task.done():
            return
        self.last_error = None
        self.status = "connecting"
        self._running = True
        self._gateway = QQGateway(
            policy.app_id,
            policy.client_secret,
            0,
            self.handle_event,
            self._handle_gateway_error,
        )
        self._gateway_task = asyncio.create_task(self._run_gateway(self._gateway))

    async def _run_gateway(self, gateway: QQGateway) -> None:
        try:
            await gateway.run()
        finally:
            if self._running and self._gateway is gateway and self.status == "connecting":
                self.status = "error"
                self.last_error = "QQ Gateway stopped before receiving READY"

    async def stop(self) -> None:
        async with self._lifecycle_lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
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
        async with self._lifecycle_lock:
            await self._stop_locked()
            self.last_error = None
            await self._start_locked()

    async def handle_event(self, event: dict) -> None:
        event_type = event.get("t")
        if event.get("t") in {"READY", "RESUMED"}:
            self.status = "connected"
            return
        if event.get("t") == "INTERACTION_CREATE":
            # Gateway wraps the interaction payload in an event envelope. The
            # ACK endpoint expects the interaction payload id from d.id, not
            # the envelope id (which may look like INTERACTION_CREATE:<uuid>).
            interaction_id = str((event.get("d") or {}).get("id") or "")
            if interaction_id and self._gateway:
                try:
                    await self._gateway.acknowledge_interaction(interaction_id)
                except Exception:
                    # Hermes continues the callback even when the platform ACK fails.
                    logger.warning(
                        "QQ interaction ACK failed; continuing interaction handling: id=%s",
                        interaction_id,
                        exc_info=True,
                    )
            elif not interaction_id:
                logger.warning("QQ interaction has no id; skipping ACK")
            await self._handle_interaction(event)
            return
        message = parse_message(event)
        if not message:
            logger.warning("Ignoring QQ event: unsupported or invalid message event type=%s", event_type)
            return
        if not self.db.claim_qq_event(message.event_id):
            logger.info("Ignoring duplicate QQ message: event_id=%s", message.event_id)
            return
        policy = self._policy()
        if not policy.allows(message.context_type, message.user_openid, message.group_openid):
            logger.warning(
                "Ignoring QQ message: blocked by policy context=%s user=%s group=%s "
                "(check enabled switches and allowlists)",
                message.context_type, message.user_openid, message.group_openid,
            )
            return
        if message.context_type == "group" and policy.group_require_mention and not self._has_bot_mention(event):
            logger.warning("Ignoring QQ group message: bot mention not detected group=%s", message.group_openid)
            return
        key = f"{policy.app_id}:{message.context_type}:{message.context_id}"
        queue = self._queues.setdefault(key, asyncio.Queue(maxsize=policy.max_queue_size))
        if queue.full():
            logger.warning("QQ context queue full: context=%s", key)
            return
        await queue.put(_QueuedMessage(message))
        logger.info(
            "Queued QQ message: event_id=%s context=%s user=%s content_length=%d",
            message.event_id, key, message.user_openid, len(message.content),
        )
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
        resolved = interaction_data.get("resolved") or {}
        custom_id = str(
            resolved.get("button_data")
            or resolved.get("button_id")
            or interaction_data.get("custom_id")
            or interaction_data.get("customId")
            or ""
        )
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
            # The interaction ACK is the complete QQ callback response.  Hermes
            # does not send a second message from the interaction handler; the
            # waiting agent produces the normal result message after resuming.

    @staticmethod
    def _interaction_openid(data: dict) -> str:
        resolved = ((data.get("data") or {}).get("resolved") or {})
        candidates = [
            data.get("user_openid"),
            data.get("group_member_openid"),
            (data.get("user") or {}).get("openid"),
            (data.get("user") or {}).get("user_openid"),
            (data.get("author") or {}).get("user_openid"),
            (data.get("member") or {}).get("member_openid"),
            resolved.get("user_id"),
        ]
        return next((str(value) for value in candidates if value), "")

    async def _worker(self, key: str, queue: asyncio.Queue[_QueuedMessage]) -> None:
        while True:
            item = await queue.get()
            try:
                # Approval waits are intentionally longer than the normal
                # message processing budget.  Hermes keeps the channel task
                # alive while the approval session is resolved; cancelling
                # this coroutine here would orphan the approved command.
                await self._process(item.message)
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
            logger.info("QQ agent response ready: event_id=%s answer_length=%d", message.event_id, len(answer))
            await self.send_message(message, answer)
        else:
            logger.warning("QQ agent returned no final answer: event_id=%s", message.event_id)

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
        keyboard = self._approval_keyboard(approval_id)
        try:
            await self.send_target(message.context_type, message.context_id, content, message.message_id, keyboard=keyboard)
        except Exception:
            logger.exception(
                "QQ approval keyboard send failed; trying text fallback: approval_id=%s",
                approval_id,
            )
            fallback = content + "\n按钮发送失败，请在 Web 管理端处理审批。"
            try:
                await self.send_target(message.context_type, message.context_id, fallback, message.message_id)
            except Exception:
                logger.exception("QQ approval text fallback failed: approval_id=%s", approval_id)
                raise

    @staticmethod
    def _approval_keyboard(approval_id: str) -> dict:
        def button(button_id: str, label: str, visited_label: str, action: str, style: int) -> dict:
            return {
                "id": button_id,
                "render_data": {
                    "label": label,
                    "visited_label": visited_label,
                    "style": style,
                },
                "action": {
                    "type": 1,
                    "data": f"approve:{approval_id}:{action}",
                    "permission": {"type": 2},
                    "click_limit": 1,
                },
                "group_id": "approval",
            }

        return {
            "content": {
                "rows": [{
                    "buttons": [
                        button("allow", "允许一次", "已允许", "allow-once", 1),
                        button("deny", "拒绝", "已拒绝", "deny", 0),
                    ]
                }]
            }
        }

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
        chunks = split_markdown(content, MAX_MESSAGE_LENGTH) or [""]
        markdown_enabled = True
        for index, chunk in enumerate(chunks):
            use_reply = bool(reply_to and index == 0)
            for attempt in range(3):
                msg_seq = self._next_msg_seq(reply_to or context_id)
                if markdown_enabled:
                    payload_data = {
                        "markdown": {"content": chunk[:MAX_MESSAGE_LENGTH]},
                        "msg_type": 2,
                        "msg_seq": msg_seq,
                    }
                else:
                    payload_data = {
                        "content": markdown_to_plain_text(chunk)[:MAX_MESSAGE_LENGTH],
                        "msg_type": 0,
                        "msg_seq": msg_seq,
                    }
                if use_reply:
                    payload_data["msg_id"] = reply_to
                if keyboard and index == 0:
                    payload_data["keyboard"] = keyboard
                payload = json.dumps(payload_data, ensure_ascii=False).encode()
                request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json", "Authorization": f"QQBot {token}"}, method="POST")
                try:
                    await asyncio.to_thread(self._post, request)
                    logger.info(
                        "QQ message sent: context=%s target=%s chunk=%d/%d",
                        context_type, context_id, index + 1, len(chunks),
                    )
                    break
                except urllib.error.HTTPError as exc:
                    error_body = self._read_http_error_body(exc)
                    logger.warning(
                        "QQ message send failed: HTTP %s context=%s target=%s attempt=%d/%d body=%s",
                        exc.code, context_type, context_id, attempt + 1, 3, error_body,
                    )
                    if use_reply and exc.code == 400 and "40034024" in error_body:
                        logger.info(
                            "QQ reply msg_id rejected; retrying as an active message: context=%s target=%s",
                            context_type, context_id,
                        )
                        use_reply = False
                        continue
                    if markdown_enabled and exc.code == 400 and self._is_markdown_unsupported(error_body):
                        logger.info(
                            "QQ Markdown message rejected; retrying as plain text: context=%s target=%s",
                            context_type,
                            context_id,
                        )
                        markdown_enabled = False
                        attempt = -1
                        continue
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

    @staticmethod
    def _read_http_error_body(error: urllib.error.HTTPError) -> str:
        try:
            body = error.read().decode("utf-8", errors="replace")
        except OSError:
            return "<unavailable>"
        return body[:1000] or "<empty>"
