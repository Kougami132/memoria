from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def get_current_temporal_context(timezone_str: str = "Asia/Shanghai") -> dict[str, str]:
    """Return ISO datetime and localized string representation for prompt injection."""
    try:
        tz = ZoneInfo(timezone_str)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    now = datetime.datetime.now(tz)
    weekday_cn = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][now.weekday()]
    formatted = now.strftime(f"%Y年%m月%d日 {weekday_cn} %H:%M:%S %Z")
    
    return {
        "iso": now.isoformat(),
        "formatted": formatted,
        "timezone": str(tz),
    }
