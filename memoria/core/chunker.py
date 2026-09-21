import os

from langchain_text_splitters import RecursiveCharacterTextSplitter

from memoria.config import settings

SUPPORTED = {".md", ".markdown", ".txt", ".pdf", ".docx", ".yaml", ".yml"}


def parse_document(path: str) -> str:
    """Extract and parse plain text from supported document formats."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError(f"Unsupported file format: {ext}. Supported: {sorted(SUPPORTED)}")
    if not os.path.exists(path):
        raise FileNotFoundError(f"File not found: {path}")

    if ext in {".md", ".markdown", ".txt"}:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()

    elif ext == ".pdf":
        import pypdf
        reader = pypdf.PdfReader(path)
        extracted = []
        for i, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                extracted.append(page_text.strip())
        return "\n\n".join(extracted)

    elif ext == ".docx":
        import docx
        from docx.oxml.table import CT_Tbl
        from docx.oxml.text.paragraph import CT_P
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        doc = docx.Document(path)
        elements: list[str] = []
        for child in doc.element.body:
            if isinstance(child, CT_P):
                p = Paragraph(child, doc)
                if p.text.strip():
                    elements.append(p.text.strip())
            elif isinstance(child, CT_Tbl):
                table = Table(child, doc)
                for row in table.rows:
                    row_cells = [cell.text.strip() for cell in row.cells]
                    row_line = " | ".join(row_cells)
                    if row_line.strip():
                        elements.append(row_line)
        return "\n\n".join(elements)

    elif ext in {".yaml", ".yml"}:
        import yaml
        with open(path, encoding="utf-8", errors="replace") as f:
            raw_text = f.read()
        try:
            parsed = yaml.safe_load(raw_text)
            if parsed is not None:
                return yaml.dump(parsed, allow_unicode=True, default_flow_style=False, sort_keys=False)
        except Exception:
            pass
        return raw_text

    return ""


class Chunker:
    def __init__(self, chunk_size: int | None = None, chunk_overlap: int | None = None) -> None:
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size or settings.chunk_size,
            chunk_overlap=chunk_overlap or settings.chunk_overlap,
        )

    def split(self, path: str) -> list[str]:
        ext = os.path.splitext(path)[1].lower()
        if ext not in SUPPORTED:
            raise ValueError(f"Unsupported file format: {ext}. Supported: {sorted(SUPPORTED)}")
        text = parse_document(path)
        if not text.strip():
            return []
        return self._splitter.split_text(text)

