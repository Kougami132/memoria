import pytest
from unittest.mock import MagicMock
from memoria.storage.hybrid_retriever import BM25Index, HybridRetriever, tokenize_cn_en
from memoria.core.pipeline import Pipeline
from memoria.storage.db import DB
from memoria.llm.caller import MockLLMCaller


def test_tokenize_cn_en():
    text = "Docker 报错 ErrCode:10054 网络连接超时"
    tokens = tokenize_cn_en(text)
    assert "docker" in tokens
    assert "10054" in tokens
    assert "errcode" in tokens


def test_bm25_index_search():
    index = BM25Index()
    docs = [
        {"id": "doc1", "text": "Kubernetes Pod 处于 CrashLoopBackOff 状态排查指南", "doc_id": "d1"},
        {"id": "doc2", "text": "Nginx 返回 502 Bad Gateway 上游服务未启动", "doc_id": "d2"},
        {"id": "doc3", "text": "MySQL 连接超时 ErrCode:10054 客户端主动断开连接", "doc_id": "d3"},
    ]
    index.build(docs)

    results1 = index.search("10054", top_k=2)
    assert len(results1) > 0
    assert results1[0]["id"] == "doc3"

    results2 = index.search("502 Bad Gateway", top_k=2)
    assert len(results2) > 0
    assert results2[0]["id"] == "doc2"

    results3 = index.search("完全无关内容香蕉苹果", top_k=2)
    assert len(results3) == 0


def test_bm25_index_incremental_and_delete():
    index = BM25Index()
    docs = [
        {"id": "doc1", "text": "Python fastapi 服务", "doc_id": "d1"},
    ]
    index.build(docs)
    assert len(index.documents) == 1

    index.add_documents([{"id": "doc2", "text": "Golang gin 服务", "doc_id": "d2"}])
    assert len(index.documents) == 2

    res = index.search("Golang", top_k=1)
    assert len(res) == 1
    assert res[0]["id"] == "doc2"

    index.delete_documents({"doc_id": "d2"})
    assert len(index.documents) == 1
    assert len(index.search("Golang", top_k=1)) == 0


def test_hybrid_retriever_rrf():
    mock_vector = MagicMock()
    mock_vector.query.return_value = [
        {"id": "doc1", "text": "通用容器知识", "score": 0.95},
        {"id": "doc2", "text": "Nginx 网关反向代理", "score": 0.85},
    ]

    index = BM25Index()
    index.build([
        {"id": "doc2", "text": "Nginx 502 Bad Gateway 错误代码", "doc_id": "d2"},
        {"id": "doc3", "text": "Apache httpd 配置", "doc_id": "d3"},
    ])

    retriever = HybridRetriever(mock_vector, index, rrf_k=60)
    results = retriever.retrieve("502", [0.1] * 10, top_k=5)

    assert len(results) >= 2
    # doc2 appears in both vector and bm25, should be ranked top
    assert results[0]["id"] == "doc2"
    assert "rrf_score" in results[0]


def test_pipeline_hybrid_search(tmp_path):
    class ExactMockEmbedder:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.1] * 1536 for _ in texts]

    db = DB(str(tmp_path / "test.db"))
    pipeline = Pipeline(
        db=db,
        embedder=ExactMockEmbedder(),
        llm=MockLLMCaller(),
        chroma_path=str(tmp_path / "chroma"),
    )

    kb = pipeline.db.create_kb("kb_hybrid", "")
    f1 = tmp_path / "nginx.txt"
    f1.write_text("Nginx 服务在端口 8080 上发生 502 Bad Gateway 报错 ErrCode:10054\n" * 5)
    f2 = tmp_path / "redis.txt"
    f2.write_text("Redis 内存缓存达到上限 OOM command not allowed when used memory > 'maxmemory'\n" * 5)

    pipeline.ingest(kb["id"], str(f1))
    pipeline.ingest(kb["id"], str(f2))

    # Keyword search should find 10054 easily
    chunks = pipeline.retrieve(kb["id"], "ErrCode:10054", k=3)
    assert len(chunks) > 0
    assert any("10054" in c["text"] for c in chunks)
