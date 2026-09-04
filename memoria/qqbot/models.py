from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QQInboundMessage:
    event_id: str
    context_type: str
    context_id: str
    user_openid: str
    content: str
    group_openid: str | None = None
    group_member_openid: str | None = None
    message_id: str | None = None


def parse_message(event: dict) -> QQInboundMessage | None:
    event_type = event.get("t") or ""
    data = event.get("d") or {}
    if event_type == "C2C_MESSAGE_CREATE":
        author = data.get("author") or {}
        event_id = str(event.get("id") or data.get("id") or "")
        message_id = str(data.get("id") or "") or None
        user_openid = str(author.get("user_openid") or "")
        content = str(data.get("content") or "").strip()
        if not event_id or not user_openid or not content:
            return None
        return QQInboundMessage(event_id, "c2c", user_openid, user_openid, content, message_id=message_id)
    if event_type == "GROUP_AT_MESSAGE_CREATE":
        group = str(data.get("group_openid") or "")
        member = data.get("author") or {}
        user = str(member.get("member_openid") or member.get("user_openid") or "")
        event_id = str(event.get("id") or data.get("id") or "")
        message_id = str(data.get("id") or "") or None
        content = str(data.get("content") or "").strip()
        if not event_id or not group or not user or not content:
            return None
        return QQInboundMessage(event_id, "group", group, user, content, group_openid=group, group_member_openid=user, message_id=message_id)
    return None
