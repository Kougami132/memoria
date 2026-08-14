from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SourceCollector:
    """Collect and deduplicate retrieval sources produced by agent tools."""

    max_sources: int = 20

    def __post_init__(self) -> None:
        self._items: dict[tuple[str, str, str, str], dict] = {}

    def add_chunk(self, kb_id: str, chunk: dict, doc_info: dict | None = None) -> dict:
        text = str(chunk.get("text") or "")
        doc_id = str(chunk.get("doc_id") or "")
        db_doc_id = str(chunk.get("db_doc_id") or "")
        key = (kb_id, db_doc_id, doc_id, text)
        score = float(chunk.get("score") or 0.0)

        existing = self._items.get(key)
        if existing is None:
            source = {
                "kb_id": kb_id,
                "text": text,
                "score": score,
                "doc_id": doc_id,
                "db_doc_id": db_doc_id,
                "filename": doc_info.get("filename") if doc_info else None,
                "path": doc_info.get("path") if doc_info else None,
                "source": doc_info.get("source") if doc_info else None,
            }
            self._items[key] = source
            return source

        if score > float(existing.get("score") or 0.0):
            existing["score"] = score
        return existing

    def list_sources(self) -> list[dict]:
        sources = list(self._items.values())
        sources.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
        return sources[: self.max_sources]

    def used_kbs(self) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for source in self.list_sources():
            kb_id = str(source.get("kb_id") or "")
            if kb_id and kb_id not in seen:
                seen.add(kb_id)
                ordered.append(kb_id)
        return ordered
