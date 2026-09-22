from __future__ import annotations

import re
from typing import Any, List, Tuple


def estimate_tokens(text: str) -> int:
    """
    Fast heuristic token estimation:
    CJK characters are typically ~1.3-1.5 tokens, ASCII words/punctuation ~0.3 tokens.
    """
    if not text:
        return 0
    count = 0.0
    for ch in text:
        if ord(ch) > 127:
            count += 1.3
        else:
            count += 0.3
    return max(1, int(count))


def estimate_history_tokens(history: List[dict[str, Any]]) -> int:
    """Calculate the estimated total tokens for all messages in history."""
    total = 0
    for item in history:
        content = str(item.get("content") or "")
        total += estimate_tokens(content)
    return total


def consolidate_whiteboard(
    early_messages: List[dict[str, Any]],
    existing_whiteboard: str = "",
) -> str:
    """
    Consolidate earlier conversation turns into a structured session whiteboard.
    Includes:
      1. Confirmed Facts (已确认事实)
      2. Attempted Steps / Diagnostics (已排查步骤与诊断结论)
      3. Safety Constraints & Rules (安全限制与核心约束)
    """
    facts: list[str] = []
    attempted_steps: list[str] = []
    constraints: list[str] = []

    # Preserve any previous whiteboard data
    if existing_whiteboard and existing_whiteboard.strip():
        # Extract previous lines
        for line in existing_whiteboard.splitlines():
            line_str = line.strip()
            if line_str.startswith("- [事实]") or line_str.startswith("- [Fact]"):
                facts.append(line_str.split("]", 1)[-1].strip())
            elif line_str.startswith("- [排查]") or line_str.startswith("- [Step]"):
                attempted_steps.append(line_str.split("]", 1)[-1].strip())
            elif line_str.startswith("- [约束]") or line_str.startswith("- [Constraint]"):
                constraints.append(line_str.split("]", 1)[-1].strip())

    for item in early_messages:
        role = item.get("role", "")
        content = str(item.get("content") or "").strip()
        if not content:
            continue

        lines = content.splitlines()
        first_line = lines[0] if lines else content
        snippet = first_line[:100] + ("..." if len(first_line) > 100 else "")

        if role == "user":
            # Extract possible facts or intent
            if any(k in content for k in ["主机", "服务器", "IP", "报错", "异常", "故障", "502", "10054", "CPU", "内存"]):
                facts.append(f"用户报告: {snippet}")
            if any(k in content for k in ["禁止", "严禁", "只能", "只读", "不允许", "务必", "切勿"]):
                constraints.append(f"用户约束: {snippet}")
        elif role == "assistant":
            # Extract attempted diagnostic steps or recommendations
            if any(k in content for k in ["执行", "检查", "排查", "确认", "发现", "定位", "排查步骤"]):
                attempted_steps.append(f"排查结果: {snippet}")

    # Deduplicate while preserving order
    def _dedup(seq: list[str]) -> list[str]:
        seen = set()
        out = []
        for x in seq:
            if x not in seen:
                seen.add(x)
                out.append(x)
        return out

    facts = _dedup(facts)[-8:]
    attempted_steps = _dedup(attempted_steps)[-8:]
    constraints = _dedup(constraints)[-5:]

    sections = ["### 【会话状态事实白板 (Session Whiteboard)】"]
    if facts:
        sections.append("**已确认事实与故障现象 (Confirmed Facts):**")
        sections.extend(f"- {f}" for f in facts)
    if attempted_steps:
        sections.append("**已排查步骤与操作记录 (Attempted Steps):**")
        sections.extend(f"- {s}" for s in attempted_steps)
    if constraints:
        sections.append("**已知关键限制与安全约束 (Known Constraints):**")
        sections.extend(f"- {c}" for c in constraints)

    if len(sections) == 1:
        # Fallback if no specific tags matched
        sections.append("- 会话早期背景：已进行多轮深度排查交互，早期历史已自动精简压缩。")

    return "\n".join(sections)


def build_consolidated_prompt(
    message: str,
    history: List[dict[str, Any]],
    watermark_tokens: int = 8000,
    keep_recent_turns: int = 6,
    existing_whiteboard: str = "",
) -> Tuple[str, str]:
    """
    Assemble the prompt with session whiteboard memory compression.
    If cumulative history tokens exceed watermark_tokens (or history length > keep_recent_turns),
    early turns are compressed into a structured Session Whiteboard.
    Returns: (assembled_prompt, whiteboard_text)
    """
    if not history:
        return message, ""

    total_tokens = estimate_history_tokens(history)
    
    # If below watermark and message count within recent window, preserve raw history
    if total_tokens <= watermark_tokens and len(history) <= keep_recent_turns:
        transcript = ["以下是本会话此前的对话上下文，请结合它回答当前问题："]
        for item in history:
            role = "用户" if item.get("role") == "user" else "助手"
            content = str(item.get("content") or "").strip()
            if content:
                transcript.append(f"{role}：{content}")
        transcript.append("")
        transcript.append(f"当前用户问题：{message}")
        return "\n".join(transcript), ""

    # Token watermark exceeded or history is long: split into early and recent history
    early_history = history[:-keep_recent_turns]
    recent_history = history[-keep_recent_turns:]

    whiteboard_text = consolidate_whiteboard(early_history, existing_whiteboard=existing_whiteboard)

    transcript = [
        "以下是长会话的历史事实白板与近期对话上下文，请严格保留已知约束并基于它们回答当前问题：",
        "",
        whiteboard_text,
        "",
        "**近期对话记录 (Recent Turns):**",
    ]
    for item in recent_history:
        role = "用户" if item.get("role") == "user" else "助手"
        content = str(item.get("content") or "").strip()
        if content:
            transcript.append(f"{role}：{content}")

    transcript.append("")
    transcript.append(f"当前用户问题：{message}")
    return "\n".join(transcript), whiteboard_text
