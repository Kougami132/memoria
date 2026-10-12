import type { AppDatabase } from "../db/database.ts";

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
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
  const len = Math.min(a.length, b.length);
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

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const eff = this.db.getEffectiveSettings();
    const useMock =
      this.forceLocal ||
      process.env.USE_MOCK === "true" ||
      !eff.openai_api_key ||
      eff.openai_api_key === "mock" ||
      eff.openai_base_url.includes("localhost");

    if (useMock) {
      return texts.map((t) => computeDeterministicEmbedding(t));
    }

    try {
      const resp = await fetch(`${eff.openai_base_url}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${eff.openai_api_key}`,
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
        return data.data.map((d) => new Float32Array(d.embedding));
      }
    } catch {
      // Fallback to deterministic local embedding when remote endpoint is unreachable
    }

    return texts.map((t) => computeDeterministicEmbedding(t));
  }
}
