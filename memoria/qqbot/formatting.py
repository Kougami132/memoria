from __future__ import annotations

import re

MAX_MESSAGE_LENGTH = 4000


def split_markdown(content: str, limit: int = MAX_MESSAGE_LENGTH) -> list[str]:
    """Split Markdown while keeping fenced code blocks valid in each chunk."""
    if limit <= 0:
        raise ValueError("limit must be positive")
    if len(content) <= limit:
        return [content]

    lines = content.splitlines(keepends=True)
    chunks: list[str] = []
    current: list[str] = []
    in_fence = False
    fence_marker = ""

    def flush() -> None:
        if current:
            chunks.append("".join(current).rstrip("\n"))
            current.clear()

    for line in lines:
        stripped = line.lstrip()
        match = re.match(r"(`{3,}|~{3,})", stripped)
        if match:
            marker = match.group(1)
            if not in_fence:
                in_fence = True
                fence_marker = marker[0]
            elif marker[0] == fence_marker:
                in_fence = False

        if current and len("".join(current)) + len(line) > limit:
            if in_fence:
                # Close and reopen the block so QQ receives valid Markdown.
                current.append(f"\n{fence_marker * 3}\n")
                flush()
                current.append(f"{fence_marker * 3}\n")
            else:
                flush()
        current.append(line)

        while len("".join(current)) > limit:
            text = "".join(current)
            boundary = text.rfind("\n", 0, limit + 1)
            if boundary <= 0:
                boundary = limit
            part = text[:boundary].rstrip("\n")
            if in_fence:
                part += f"\n{fence_marker * 3}"
                remainder = f"{fence_marker * 3}\n" + text[boundary:].lstrip("\n")
            else:
                remainder = text[boundary:].lstrip("\n")
            chunks.append(part)
            current[:] = [remainder] if remainder else []

    flush()
    return chunks or [""]


def markdown_to_plain_text(content: str) -> str:
    """Provide a readable fallback when QQ Markdown is unavailable."""
    text = re.sub(r"```[^\n]*\n?", "", content)
    text = text.replace("```", "")
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*\*([^*]+)\*\*|__([^_]+)__", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^\s*>\s?", "| ", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "• ", text, flags=re.MULTILINE)
    return text.strip()
