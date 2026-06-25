def test_import_memoria() -> None:
    import memoria
    assert memoria.__version__ == "0.1.0"


def test_models_instantiation() -> None:
    from memoria.models import Bot, KnowledgeBase, Document

    bot = Bot(id="b1", name="test-bot")
    kb = KnowledgeBase(id="k1", name="test-kb")
    doc = Document(id="d1", kb_id="k1", filename="a.pdf", path="/tmp/a.pdf")

    assert bot.kb_ids == []
    assert kb.description == ""
    assert doc.chunk_count == 0
