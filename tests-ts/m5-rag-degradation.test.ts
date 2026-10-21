import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/db/database.ts";
import {
  computeDeterministicEmbedding,
  cosineSimilarity,
  float32ToBlob,
  HybridEmbedder,
  type EmbedOutcome,
  type Embedder,
} from "../src/rag/embedder.ts";
import { HybridRagPipeline, segmentTextForFTS } from "../src/rag/hybrid-retriever.ts";

/** 可控 embedder：模拟远程可用 / 降级 / 维度不一致 */
function stubEmbedder(fn: () => EmbedOutcome): Embedder {
  return { embed: async () => fn() };
}

function seedDoc(
  db: AppDatabase,
  kbId: string,
  docId: string,
  chunkId: string,
  text: string,
  vec?: Float32Array,
) {
  db.raw
    .prepare(
      `INSERT INTO kb_documents (id, kb_id, filename, path, source, content, chunk_count, created_at)
       VALUES (?, ?, 'a.md', NULL, 'upload', 'x', 1, '2026-01-01T00:00:00Z')`,
    )
    .run(docId, kbId);
  const blob = vec ? float32ToBlob(vec) : null;
  db.raw
    .prepare(
      `INSERT INTO kb_chunks (id, kb_id, doc_id, chunk_index, text, segmented_text, embedding)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(chunkId, kbId, docId, text, segmentTextForFTS(text), blob);
  db.raw
    .prepare(
      `INSERT INTO kb_chunks_fts (chunk_id, kb_id, doc_id, segmented_text) VALUES (?, ?, ?, ?)`,
    )
    .run(chunkId, kbId, docId, segmentTextForFTS(text));
}

describe("向量维度不一致必须报错而不是截断比较", () => {
  it("cosineSimilarity 对 4096 vs 256 抛错", () => {
    expect(() => cosineSimilarity(new Float32Array(4096), new Float32Array(256))).toThrow(
      /dimension mismatch/i,
    );
  });

  it("同维度仍正常计算", () => {
    const a = computeDeterministicEmbedding("hello");
    const b = computeDeterministicEmbedding("hello");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

describe("远程嵌入失败时退化为纯 BM25（不产生噪声向量分）", () => {
  it("降级时跳过向量路，结果只由关键词匹配产生，并回报降级原因", async () => {
    const db = new AppDatabase(":memory:");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    // 库内是 4096 维「远程」向量
    const remote = new Float32Array(4096).fill(0.1);
    seedDoc(db, kb.id, "d1", "c1", "如何重启 jellyfin 容器", remote);
    // 另一条完全无关，用来确认不会因噪声被召回
    seedDoc(db, kb.id, "d2", "c2", "今天北京天气预报", new Float32Array(4096).fill(0.2));

    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({
        vectors: [computeDeterministicEmbedding("jellyfin 重启")],
        degradedReason: "嵌入服务不可用(HTTP 500)，已退化为本地哈希向量",
      })),
    );

    const res = await pipeline.retrieveDetailed({ kbIds: [kb.id], query: "jellyfin 重启", topK: 5 });
    expect(res.degradedReason).toContain("嵌入服务不可用");
    // 只剩 BM25 命中
    expect(res.chunks.length).toBe(1);
    expect(res.chunks[0].doc_id).toBe("d1");
    expect(res.chunks[0].dense_score).toBe(0);
  });

  it("向量正常时两路都参与融合", async () => {
    const db = new AppDatabase(":memory:");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const vec = new Float32Array(256).fill(0.05);
    seedDoc(db, kb.id, "d1", "c1", "内容甲", vec);

    const pipeline = new HybridRagPipeline(db, stubEmbedder(() => ({ vectors: [vec.slice()] })));
    const res = await pipeline.retrieveDetailed({ kbIds: [kb.id], query: "内容甲", topK: 5 });
    expect(res.degradedReason).toBeUndefined();
    expect(res.chunks.length).toBe(1);
    expect(res.chunks[0].dense_score).toBeGreaterThan(0.99);
  });
});

describe("min_score 设置真正生效", () => {
  it("低于门槛的结果被丢弃", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("min_score", "0.99");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const vec = new Float32Array(256).fill(0.05);
    seedDoc(db, kb.id, "d1", "c1", "内容甲", vec);

    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({ vectors: [vec.slice()] })),
    );
    const res = await pipeline.retrieve({ kbIds: [kb.id], query: "内容甲", topK: 5 });
    expect(res).toEqual([]);
  });

  it("门槛调低后同一查询又有结果，证明参数被读取", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("min_score", "0");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const vec = new Float32Array(256).fill(0.05);
    seedDoc(db, kb.id, "d1", "c1", "内容甲", vec);

    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({ vectors: [vec.slice()] })),
    );
    const res = await pipeline.retrieve({ kbIds: [kb.id], query: "内容甲", topK: 5 });
    expect(res.length).toBe(1);
  });

  it("调用方可覆盖设置", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("min_score", "0");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const vec = new Float32Array(256).fill(0.05);
    seedDoc(db, kb.id, "d1", "c1", "内容甲", vec);
    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({ vectors: [vec.slice()] })),
    );
    const res = await pipeline.retrieve({ kbIds: [kb.id], query: "内容甲", minScore: 0.99 });
    expect(res).toEqual([]);
  });
});

describe("HybridEmbedder 如实标记降级", () => {
  it("未配置 API Key 时返回哈希向量并带降级原因", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("embedding_base_url", "https://example.invalid/v1");
    db.setSetting("embedding_api_key", "");
    const out = await new HybridEmbedder(db).embed(["测试"]);
    expect(out.vectors[0].length).toBe(256);
    expect(out.degradedReason).toBeTruthy();
  });
});

describe("min_score 边界：满分结果也应可被过滤", () => {
  it("门槛设为 0.99 时，被上限截断到 0.99 的结果不再通过", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("min_score", "0.99");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const vec = new Float32Array(256).fill(0.05);
    seedDoc(db, kb.id, "d1", "c1", "内容甲", vec);
    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({ vectors: [vec.slice()] })),
    );
    expect(await pipeline.retrieve({ kbIds: [kb.id], query: "内容甲", topK: 5 })).toEqual([]);
  });
});

describe("空密钥的占位 Provider 不得覆盖用户显式配置的嵌入端点", () => {
  it("ensureDefaultProvider 生成的 api.openai.com 空 key 占位记录被忽略", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("embedding_base_url", "https://example.invalid/v1");
    db.setSetting("embedding_api_key", "sk-user-configured");
    db.setSetting("embedding_model", "m");

    // 触发占位 provider 创建
    const providers = db.listProviders(true);
    expect(providers.some((p) => p.id === "default" && !p.apiKey)).toBe(true);

    // 用 stub 捕获 embedder 实际选择的 baseUrl/key
    let seen: { url?: string } = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      seen.url = String(input?.url ?? input);
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 });
    }) as any;
    try {
      await new HybridEmbedder(db).embed(["x"]);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen.url).toBe("https://example.invalid/v1/embeddings");
  });
});

describe("降级必须整条跳过向量路（即使维度碰巧一致）", () => {
  it("库内同为 256 维哈希向量时，degradedReason 存在仍不计 dense 分", async () => {
    const db = new AppDatabase(":memory:");
    const kb = db.createKB({ name: "kb", description: "", type: "upload" });
    const doc = "jellyfin 容器重启";
    const hashVec = computeDeterministicEmbedding(doc);
    seedDoc(db, kb.id, "d1", "c1", doc, hashVec);

    const pipeline = new HybridRagPipeline(
      db,
      stubEmbedder(() => ({
        vectors: [computeDeterministicEmbedding(doc)],
        degradedReason: "嵌入服务不可用(HTTP 500)",
      })),
    );
    const res = await pipeline.retrieveDetailed({ kbIds: [kb.id], query: doc, topK: 5 });
    expect(res.degradedReason).toBeTruthy();
    expect(res.chunks).toHaveLength(1);
    expect(res.chunks[0].dense_score).toBe(0);
  });
});

describe("ADR-0008：用户指派的 Provider 必须优先（含内网无密钥）", () => {
  async function resolveUrl(setup: (db: AppDatabase) => void): Promise<string> {
    const db = new AppDatabase(":memory:");
    setup(db);
    let hit = "";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      hit = String(input?.url ?? input);
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 });
    }) as any;
    try {
      await new HybridEmbedder(db).embed(["x"]);
    } finally {
      globalThis.fetch = realFetch;
    }
    return hit;
  }

  it("内网无密钥的 Ollama provider 不被误判为不可用", async () => {
    const hit = await resolveUrl((db) => {
      db.setSetting("embedding_base_url", "https://global.example.com/v1");
      db.setSetting("embedding_api_key", "sk-global");
      db.setSetting("embedding_provider", "ollama");
      db.raw
        .prepare(
          `INSERT INTO model_providers (id,name,protocol,base_url,api_key,enabled,models_json,created_at,updated_at)
           VALUES ('ollama','Ollama','openai-completions','http://192.168.1.50:11434/v1','',1,'[]','x','x')`,
        )
        .run();
    });
    expect(hit).toBe("http://192.168.1.50:11434/v1/embeddings");
  });

  it("带密钥的 provider 正常覆盖全局配置", async () => {
    const hit = await resolveUrl((db) => {
      db.setSetting("embedding_base_url", "https://global.example.com/v1");
      db.setSetting("embedding_api_key", "sk-global");
      db.setSetting("embedding_provider", "real");
      db.raw
        .prepare(
          `INSERT INTO model_providers (id,name,protocol,base_url,api_key,enabled,models_json,created_at,updated_at)
           VALUES ('real','Real','openai-completions','https://real.example.com/v1','sk-real',1,'[]','x','x')`,
        )
        .run();
    });
    expect(hit).toBe("https://real.example.com/v1/embeddings");
  });
});
