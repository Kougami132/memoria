import type { AppDatabase } from "../db/database.ts";

/** ensureDefaultProvider() 自动创建的占位渠道地址（未配置任何密钥时）。 */
const PLACEHOLDER_BASE_URL = "https://api.openai.com/v1";

export interface EmbedOutcome {
  vectors: Float32Array[];
  /** 远程嵌入不可用、已降级时的原因；正常路径为 undefined。 */
  degradedReason?: string;
}

export interface Embedder {
  embed(texts: string[]): Promise<EmbedOutcome>;
}

export function float32ToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToFloat32(blob: Uint8Array | Buffer): Float32Array {
  const aligned = new Uint8Array(blob.byteLength);
  aligned.set(blob);
  return new Float32Array(aligned.buffer);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // 维度必须严格一致：不同模型的向量截断相减只会得到无意义的噪声分数。
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  const len = a.length;
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Deterministic feature-hashing embedder for local/offline fallback & unit tests.
 * Produces L2-normalized 256-d Float32Array vectors based on character & word n-grams.
 */
export function computeDeterministicEmbedding(text: string, dims = 256): Float32Array {
  const vec = new Float32Array(dims);
  const normalized = text.toLowerCase().trim();
  if (!normalized) return vec;

  // Hash character unigrams, bigrams, and trigrams
  for (let i = 0; i < normalized.length; i++) {
    for (let n = 1; n <= 3 && i + n <= normalized.length; n++) {
      const gram = normalized.slice(i, i + n);
      let h = 2166136261;
      for (let j = 0; j < gram.length; j++) {
        h ^= gram.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dims;
      const sign = (h & 1) === 0 ? 1 : -1;
      vec[idx] += sign * (n === 1 ? 0.5 : 1.0);
    }
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

export class HybridEmbedder implements Embedder {
  private readonly db: AppDatabase;
  private readonly forceLocal: boolean;

  constructor(db: AppDatabase, options?: { forceLocal?: boolean }) {
    this.db = db;
    this.forceLocal = Boolean(options?.forceLocal);
  }

  async embed(texts: string[]): Promise<EmbedOutcome> {
    if (texts.length === 0) return { vectors: [] };
    const eff = this.db.getEffectiveSettings();
    let apiKey = eff.embedding_api_key || eff.openai_api_key;
    let baseUrl = eff.embedding_base_url || eff.openai_base_url;

    // 只有 provider 真正持有配置时才覆盖。
    // ensureDefaultProvider() 会在启动时写入一条 base_url=api.openai.com / api_key 为空的占位记录，
    // 若让它覆盖，用户全局配置的 embedding 端点会被静默重置并导致误降级。
    // 注意：不能用「有无密钥」或「是否内网」判定可用性 —— 自建 Ollama 等本地端点合法且无密钥。
    if (eff.embedding_provider) {
      const providers = this.db.listProviders(true);
      const match = providers.find((p) => p.id === eff.embedding_provider);
      const providerUrl = match?.baseUrl?.trim() ?? "";
      const providerKey = match?.apiKey?.trim() ?? "";
      const isStub = !providerKey && providerUrl.replace(/\/+$/, "") === PLACEHOLDER_BASE_URL;
      if (providerUrl && !isStub) {
        baseUrl = providerUrl;
        if (providerKey) apiKey = providerKey;
      }
    }

    const useMock =
      this.forceLocal ||
      process.env.USE_MOCK === "true" ||
      !apiKey ||
      apiKey === "mock" ||
      baseUrl.includes("localhost");

    if (useMock) {
      return {
        vectors: texts.map((t) => computeDeterministicEmbedding(t)),
        degradedReason: this.forceLocal
          ? "本地哈希嵌入模式（forceLocal）"
          : "未配置嵌入 API Key，使用本地哈希向量",
      };
    }

    try {
      const resp = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: eff.embedding_model,
          input: texts,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        throw new Error(`Embedding HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { data?: Array<{ embedding: number[] }> };
      if (Array.isArray(data?.data) && data.data.length === texts.length) {
        return { vectors: data.data.map((d) => new Float32Array(d.embedding)) };
      }
      throw new Error("Embedding response shape mismatch");
    } catch (err) {
      // 远程不可用时不再伪装成正常向量：调用方据此退化为纯 BM25 检索。
      return {
        vectors: texts.map((t) => computeDeterministicEmbedding(t)),
        degradedReason: `嵌入服务不可用(${err instanceof Error ? err.message : String(err)})，已退化为本地哈希向量`,
      };
    }
  }
}
