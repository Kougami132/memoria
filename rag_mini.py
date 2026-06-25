"""
Phase 0.2 — Mini RAG
=====================
目标：亲手实现最小化的 RAG（检索增强生成）
不使用任何 RAG 框架，只靠 OpenAI SDK + 数学运算

理解三个核心概念：
1. Embedding — 文本 → 向量
2. 向量检索 — 找最相似的文本段
3. RAG Prompt — 检索结果 + 问题 → 答案

运行方式：
  export NEWAPI_KEY="你的key"
  python rag_mini.py
"""

import json
import os
import sys
import io
import numpy as np
from openai import OpenAI

# 暴力强锁 UTF-8，避免中文打印报错
if sys.stdout.encoding and sys.stdout.encoding.upper() != "UTF-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ─── 配置 ──────────────────────────────────────────────
client = OpenAI(
    base_url="https://api.kougami.de/v1",
    api_key=os.environ.get("NEWAPI_KEY", "sk-S51xGBg4SPH7PeZjYidNEfozmu0ezDNHDimc9KrrekvpVnzv"),
)

# DeepSeek 的 embedding 模型
EMBEDDING_MODEL = "text-embedding-3-large"
# 对话模型
LLM_MODEL = "deepseek-v4-flash"


# ─── 1. 准备文档 ──────────────────────────────────────
# 先用几段模拟数据跑通流程，后面再换成你真实的 Obsidian 笔记

DOCUMENTS = [
    {
        "title": "Jellyfin 硬件转码",
        "content": """Jellyfin 支持三种硬件转码方案：
QSV（Intel Quick Sync）：适合 Intel 核显，功耗低，画质好
NVENC（NVIDIA）：适合 N 卡用户，兼容性好，性能强
VAAPI（通用）：适合 AMD 或老旧设备，通用性最强

配置方法：在 Jellyfin 管理后台 → 播放 → 转码 → 选择硬件加速方案。
注意：QSV 需要在 Docker 中挂载 /dev/dri 设备。""",
    },
    {
        "title": "Transformer 架构笔记",
        "content": """Transformer 由 Google 在 2017 年提出，核心是 Self-Attention 机制。
主要组件：
- Encoder：理解输入文本
- Decoder：生成输出文本
- Self-Attention：让每个词看到所有词
- Multi-Head Attention：多个注意力头并行
- Feed Forward：全连接层
- Positional Encoding：给模型位置信息

BERT 只用 Encoder，GPT 只用 Decoder。""",
    },
    {
        "title": "RAG 技术总结",
        "content": """RAG = Retrieval-Augmented Generation（检索增强生成）。
解决的问题：LLM 的知识有截止日期，且会「幻觉」——编造事实。
做法：用户提问时，先从知识库里检索相关文档，再让 LLM 基于文档回答。
效果：减少幻觉，答案可溯源，知识实时更新。

关键组件：
- 文档入库：切分 → Embedding → 存向量库
- 检索：问题 → Embedding → 向量库搜 top-k → 取原文
- 生成：检索结果 + 问题 → LLM → 带引用的答案""",
    },
    {
        "title": "Docker 网络模式",
        "content": """Docker 四种网络模式：
1. bridge（默认）：容器内独立网络栈，通过端口映射访问
2. host：容器直接使用宿主机网络，性能好但隔离差
3. container：共享另一个容器的网络栈
4. none：无网络

常用场景：
- Web 服务用 bridge + 端口映射
- 需要高性能网络（如转码）用 host
- 多个容器需要 localhost 通信用 container 模式""",
    },
    {
        "title": "Python 异步编程",
        "content": """Python 异步编程核心概念：
- async/await：语法糖，定义协程
- asyncio：事件循环，调度协程
- 协程 vs 线程：协程是用户态切换，线程是内核态切换

适用场景：IO 密集型（网络请求、文件读写）
不适用：CPU 密集型（计算、转码）

常用库：asyncio、aiohttp、httpx（异步版）""",
    },
]


# ─── 2. 分块 (Chunking) ──────────────────────────────
# 一篇笔记可能很长，切成小段后再存，检索更精准
# 简单策略：按段落/句子分割

def chunk_text(text: str, max_chars: int = 500) -> list[str]:
    """把文本切成块，每块不超过 max_chars 字符"""
    paragraphs = text.split("\n\n")  # 先按段落分
    chunks = []
    current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) < max_chars:
            current += para + "\n"
        else:
            if current:
                chunks.append(current.strip())
            # 如果段落本身就超长，按句子切
            if len(para) > max_chars:
                sentences = para.replace("。", "。\n").replace("？", "？\n").split("\n")
                for s in sentences:
                    if s.strip():
                        chunks.append(s.strip())
            else:
                current = para + "\n"

    if current:
        chunks.append(current.strip())
    return chunks


# ─── 3. 构建向量索引 ──────────────────────────────────
# 每个 chunk → embedding API → 一个向量
# 存到数组里，检索时暴力算相似度

def get_embedding(text: str) -> list[float]:
    """调 NewAPI 的 embedding endpoint，返回向量"""
    resp = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """余弦相似度：值越接近 1 表示越相似"""
    a = np.array(a)
    b = np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


class SimpleVectorStore:
    """最简单的向量库——就是一个数组"""
    def __init__(self):
        self.chunks = []       # 存原始文本
        self.embeddings = []   # 存对应的向量
        self.metadata = []     # 存来源信息

    def add(self, text: str, meta: dict = None):
        """添加一条文本到索引"""
        print(f"  📥 索引中: {text[:50]}...")
        vec = get_embedding(text)
        self.chunks.append(text)
        self.embeddings.append(vec)
        self.metadata.append(meta or {})

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """输入问题，返回最相似的 top_k 个 chunk"""
        q_vec = get_embedding(query)
        scores = [
            cosine_similarity(q_vec, doc_vec)
            for doc_vec in self.embeddings
        ]
        # 按相似度降序，取 top_k
        top_indices = sorted(
            range(len(scores)),
            key=lambda i: scores[i],
            reverse=True,
        )[:top_k]

        results = []
        for idx in top_indices:
            results.append({
                "text": self.chunks[idx],
                "score": scores[idx],
                "meta": self.metadata[idx],
            })
        return results


# ─── 4. RAG Pipeline ──────────────────────────────────
# 核心流程：
#   用户问题 → Embedding → 向量检索 → 拼 Prompt → LLM 回答

RAG_PROMPT_TEMPLATE = """你是一个基于知识库回答问题的助手。

请根据以下参考内容回答问题。如果参考内容不足以回答，请如实说不知道，不要编造。

=== 参考内容 ===
{context}

=== 问题 ===
{question}

请给出准确的回答，并在引用参考内容时标注来源。"""


def run_rag(store: SimpleVectorStore, question: str, top_k: int = 3) -> str:
    """RAG 全流程"""
    print(f"\n{'='*60}")
    print(f"❓ 问题: {question}")

    # Step 1: 检索
    print(f"\n🔍 正在检索 top-{top_k} ...")
    results = store.search(question, top_k=top_k)

    print(f"\n📊 检索结果:")
    for i, r in enumerate(results):
        print(f"  [{i+1}] 相似度={r['score']:.4f} | {r['text'][:60]}...")

    # Step 2: 构建上下文
    context_parts = []
    for i, r in enumerate(results):
        title = r["meta"].get("title", "未知来源")
        context_parts.append(f"[来源 {i+1}: {title}]\n{r['text']}")

    context = "\n\n".join(context_parts)

    # Step 3: 拼 prompt 调 LLM
    prompt = RAG_PROMPT_TEMPLATE.format(context=context, question=question)

    print(f"\n🤖 正在生成回答...")
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )

    answer = response.choices[0].message.content
    return answer


# ─── 启动 ──────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("🧪 Mini RAG Demo")
    print("先用 5 篇 demo 笔记建索引，然后你可以提问")
    print("输入 q 退出")
    print("=" * 60)

    # 建索引
    print("\n📦 正在构建向量索引...")
    store = SimpleVectorStore()

    for doc in DOCUMENTS:
        chunks = chunk_text(doc["content"])
        for chunk in chunks:
            store.add(chunk, meta={"title": doc["title"]})

    print(f"\n✅ 索引完成！共 {len(store.chunks)} 个 chunk")

    # 你可以先看看不同 chunk 之间的相似度，理解语义距离
    print(f"\n🔬 来看看不同文本的语义距离:")
    test_pairs = [
        ("Jellyfin 硬件转码方案对比", "Docker 网络桥接配置"),
        ("Jellyfin 硬件转码方案对比", "RAG 减少 LLM 幻觉"),
        ("Jellyfin 硬件转码方案对比", "QSV 和 NVENC 的区别"),
    ]

    for q1, q2 in test_pairs:
        v1 = get_embedding(q1)
        v2 = get_embedding(q2)
        sim = cosine_similarity(v1, v2)
        print(f"  「{q1}」  vs  「{q2}」 → 相似度: {sim:.4f}")

    print(f"\n注意：语义相关的「QSV vs NVENC」和「Jellyfin 转码」相似度最高，")
    print(f"不相关的内容相似度接近 0。这就是向量检索的基础。")

    # 问答循环
    while True:
        question = input("\n❓ 你的问题：").strip()
        if question.lower() in ("q", "quit", "exit"):
            break
        if not question:
            continue

        answer = run_rag(store, question)
        print(f"\n{'─'*60}")
        print(f"✅ 回答:\n{answer}")
