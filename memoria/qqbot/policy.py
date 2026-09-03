from __future__ import annotations

import json
from dataclasses import dataclass


def _list(value: str) -> set[str]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return set()
    return {str(item).strip() for item in parsed if str(item).strip()}


@dataclass(frozen=True)
class QQPolicy:
    enabled: bool
    app_id: str
    client_secret: str
    gateway_intents: int
    c2c_enabled: bool
    group_enabled: bool
    group_require_mention: bool
    user_allowlist: set[str]
    group_allowlist: set[str]
    allow_unlisted_users: bool
    allow_unlisted_groups: bool
    group_approval_enabled: bool
    max_queue_size: int
    run_timeout_seconds: int

    @classmethod
    def from_settings(cls, values: dict[str, str]) -> QQPolicy:
        boolean = lambda key, default=False: values.get(key, str(default)).lower() == "true"
        return cls(
            enabled=boolean("enabled"), app_id=values.get("app_id", "").strip(),
            client_secret=values.get("client_secret", ""),
            gateway_intents=int(values.get("gateway_intents", "0") or 0),
            c2c_enabled=boolean("c2c_enabled", True), group_enabled=boolean("group_enabled", True),
            group_require_mention=boolean("group_require_mention", True),
            user_allowlist=_list(values.get("user_allowlist", "[]")),
            group_allowlist=_list(values.get("group_allowlist", "[]")),
            allow_unlisted_users=boolean("allow_unlisted_users"),
            allow_unlisted_groups=boolean("allow_unlisted_groups"),
            group_approval_enabled=boolean("group_approval_enabled"),
            max_queue_size=max(1, int(values.get("max_queue_size", "32") or 32)),
            run_timeout_seconds=max(1, int(values.get("run_timeout_seconds", "300") or 300)),
        )

    def allows(self, context_type: str, user_openid: str, group_openid: str | None = None) -> bool:
        if context_type == "c2c":
            return self.c2c_enabled and (self.allow_unlisted_users or user_openid in self.user_allowlist)
        if context_type == "group":
            return self.group_enabled and (self.allow_unlisted_groups or (group_openid or "") in self.group_allowlist)
        return False
