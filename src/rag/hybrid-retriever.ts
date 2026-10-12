import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db/database.ts";
import {
  blobToFloat32,
  cosineSimilarity,
  float32ToBlob,
  HybridEmbedder,
  type Embedder,
} from "./embedder.ts";
import { parseDocumentBuffer, splitTextIntoChunks } from "./parser.ts";

const zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function tokenizeForSearch(text: string): string[] {
  if (!text || !text.trim()) return [];
  const tokens: string[] = [];
  for (const seg of zhSegmenter.segment(text)) {
    if (seg.isWordLike) {
      const clean = seg.segment.toLowerCase().trim();
      if (clean) tokens.push(clean);
    }
  }
  return tokens;
}

export function segmentTextForFTS(text: string): string {
  return tokenizeForSearch(text).join(" ");
}

export function buildFtsMatchQuery(query: string): string {
  const tokens = Array.from(new Set(tokenizeForSearch(query)))
    .map((t) => t.replace(/["']/g, "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

export interface IngestDocumentParams {
  kbId: string;
  filename: string;
  contentBuffer: Buffer;
  path?: string;
  source?: "upload" | "vault";
}

export interface IngestResult {
  doc_id: string;
  chunk_count: number;
  doc: {
    id: string;
    kb_id: string;
    filename: string;
    chunk_count: number;
    source: "upload" | "vault";
    path?: string;
    created_at: string;
  };
}

export interface RetrievedChunk {
  id: string;
  kb_id: string;
  doc_id: string;
  text: string;
  score: number;
  dense_score: number;
  bm25_score: number;
  filename: string;
  path?: string;
  source: string;
}

export class HybridRagPipeline {
  readonly db: AppDatabase;
  readonly embedder: Embedder;

  constructor(db: AppDatabase, embedder?: Embedder) {
    this.db = db;
    this.embedder = embedder ?? new HybridEmbedder(db);
  }

  async ingest(params: IngestDocumentParams): Promise<IngestResult> {
    const kb = this.db.getKB(params.kbId);
    if (!kb) {
      throw new Error(`Knowledge base not found: ${params.kbId}`);
    }

    const eff = this.db.getEffectiveSettings();
    const chunkSize = Math.max(64, Number(eff.chunk_size) || 512);
    const chunkOverlap = Math.max(0, Number(eff.chunk_overlap) || 128);

    const fullText = parseDocumentBuffer(params.contentBuffer, params.filename);
    const chunks = splitTextIntoChunks(fullText, chunkSize, chunkOverlap);
    const embeddings = chunks.length > 0 ? await this.embedder.embed(chunks) : [];

    const docId = `doc_${randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const source = params.source ?? "upload";

    this.db.raw.exec("BEGIN");
    try {
      this.db.raw
        .prepare(
          `INSERT INTO kb_documents (id, kb_id, filename, path, source, content, chunk_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          docId,
          params.kbId,
          params.filename,
          params.path ?? null,
          source,
          fullText,
          chunks.length,
          now,
        );

      const insertChunk = this.db.raw.prepare(
        `INSERT INTO kb_chunks (id, kb_id, doc_id, chunk_index, text, segmented_text, embedding, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.db.raw.prepare(
        `INSERT INTO kb_chunks_fts (chunk_id, kb_id, doc_id, segmented_text)
         VALUES (?, ?, ?, ?)`,
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${docId}_c${i}`;
        const chunkText = chunks[i];
        const segmented = segmentTextForFTS(chunkText);
        const embBlob = embeddings[i] ? float32ToBlob(embeddings[i]) : null;
        insertChunk.run(
          chunkId,
          params.kbId,
          docId,
          i,
          chunkText,
          segmented,
          embBlob,
          JSON.stringify({ filename: params.filename, path: params.path, source }),
        );
        if (segmented) {
          insertFts.run(chunkId, params.kbId, docId, segmented);
        }
      }

      this.db.raw.exec("COMMIT");
    } catch (err) {
      this.db.raw.exec("ROLLBACK");
      throw err;
    }

    return {
      doc_id: docId,
      chunk_count: chunks.length,
      doc: {
        id: docId,
        kb_id: params.kbId,
        filename: params.filename,
        chunk_count: chunks.length,
        source,
        path: params.path,
        created_at: now,
      },
    };
  }

  deleteDoc(docId: string): boolean {
    const existing = this.db.raw
      .prepare("SELECT id, kb_id FROM kb_documents WHERE id = ?")
      .get(docId) as { id: string; kb_id: string } | undefined;
    if (!existing) return false;

    this.db.raw.exec("BEGIN");
    try {
      this.db.raw.prepare("DELETE FROM kb_chunks_fts WHERE doc_id = ?").run(docId);
      this.db.raw.prepare("DELETE FROM kb_documents WHERE id = ?").run(docId);
      this.db.raw.exec("COMMIT");
      return true;
    } catch (err) {
      this.db.raw.exec("ROLLBACK");
      throw err;
    }
  }

  async retrieve(params: {
    kbIds: string[];
    query: string;
    topK?: number;
    minScore?: number;
  }): Promise<RetrievedChunk[]> {
    const { kbIds, query } = params;
    if (!kbIds.length || !query.trim()) return [];

    const eff = this.db.getEffectiveSettings();
    const topK = params.topK ?? (Number(eff.top_k) || 5);
    const candidateLimit = Math.max(topK * 4, 20);
    const placeholders = kbIds.map(() => "?").join(",");

    // 1. Load candidate chunks from SQLite for dense vector scoring
    const allChunks = this.db.raw
      .prepare(
        `SELECT c.id, c.kb_id, c.doc_id, c.text, c.embedding, d.filename, d.path, d.source
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.doc_id
         WHERE c.kb_id IN (${placeholders})`,
      )
      .all(...kbIds) as Array<{
      id: string;
      kb_id: string;
      doc_id: string;
      text: string;
      embedding: Uint8Array | null;
      filename: string;
      path: string | null;
      source: string;
    }>;

    if (allChunks.length === 0) return [];

    const chunkMap = new Map(allChunks.map((c) => [c.id, c]));

    // 2. Dense vector cosine ranking
    const [queryVec] = await this.embedder.embed([query]);
    const denseScored: Array<{ id: string; score: number }> = [];
    if (queryVec) {
      for (const chunk of allChunks) {
        if (chunk.embedding) {
          const vec = blobToFloat32(chunk.embedding);
          const sim = cosineSimilarity(queryVec, vec);
          denseScored.push({ id: chunk.id, score: sim });
        } else if (chunk.text.toLowerCase().includes(query.toLowerCase())) {
          denseScored.push({ id: chunk.id, score: 0.75 });
        }
      }
      denseScored.sort((a, b) => b.score - a.score);
    }
    const denseTop = denseScored.slice(0, candidateLimit);

    // 3. Sparse BM25 ranking via SQLite FTS5
    const ftsQuery = buildFtsMatchQuery(query);
    let sparseTop: Array<{ chunk_id: string; bm25_raw: number }> = [];
    if (ftsQuery) {
      try {
        sparseTop = this.db.raw
          .prepare(
            `SELECT chunk_id, bm25(kb_chunks_fts) AS bm25_raw
             FROM kb_chunks_fts
             WHERE kb_id IN (${placeholders}) AND kb_chunks_fts MATCH ?
             ORDER BY bm25(kb_chunks_fts) ASC
             LIMIT ?`,
          )
          .all(...kbIds, ftsQuery, candidateLimit) as Array<{
          chunk_id: string;
          bm25_raw: number;
        }>;
      } catch {
        sparseTop = [];
      }
    }

    // 4. Reciprocal Rank Fusion (RRF, k = 60)
    const rrfK = 60;
    const rrfScores = new Map<string, { rrf: number; dense: number; bm25: number }>();

    denseTop.forEach((item, idx) => {
      const rank = idx + 1;
      const prev = rrfScores.get(item.id) ?? { rrf: 0, dense: 0, bm25: 0 };
      prev.rrf += 1 / (rrfK + rank);
      prev.dense = item.score;
      rrfScores.set(item.id, prev);
    });

    sparseTop.forEach((item, idx) => {
      if (!chunkMap.has(item.chunk_id)) return;
      const rank = idx + 1;
      const prev = rrfScores.get(item.chunk_id) ?? { rrf: 0, dense: 0, bm25: 0 };
      // Give BM25 slightly higher weight when exact keyword matches exist
      prev.rrf += 1.2 / (rrfK + rank);
      prev.bm25 = Math.abs(Number(item.bm25_raw) || 0);
      rrfScores.set(item.chunk_id, prev);
    });

    // Normalize RRF score to a human-friendly [0..1] similarity range
    const maxPossibleRrf = 2.2 / (rrfK + 1);
    const merged: RetrievedChunk[] = [];

    for (const [chunkId, sc] of rrfScores.entries()) {
      const row = chunkMap.get(chunkId);
      if (!row) continue;
      const normalizedRrf = Math.min(0.99, sc.rrf / maxPossibleRrf);
      const finalScore = Number(
        Math.max(normalizedRrf, sc.dense > 0 ? sc.dense * 0.85 : 0).toFixed(4),
      );
      merged.push({
        id: row.id,
        kb_id: row.kb_id,
        doc_id: row.doc_id,
        text: row.text,
        score: finalScore,
        dense_score: sc.dense,
        bm25_score: sc.bm25,
        filename: row.filename,
        path: row.path ?? undefined,
        source: row.source,
      });
    }

    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
  }
}
