import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { parseDocumentBuffer } from "../src/rag/parser.ts";
import { createApp } from "../src/server/app.ts";

/**
 * Helper to build a minimal valid ZIP buffer with a single deflated entry (for testing .docx parsing).
 */
function buildSingleEntryZip(entryName: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, "utf8");
  const compressed = deflateRawSync(content);

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // Deflate
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const cdOffset = localHeader.length + compressed.length;
  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(content.length, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt32LE(0, 42);
  nameBuf.copy(cdHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([localHeader, compressed, cdHeader, eocd]);
}

describe("M2: SQLite Hybrid RAG (Vector + FTS5 BM25 + RRF), Multi-Format Parser & Vault Sync", () => {
  let db: AppDatabase;
  let faux: FauxProviderHandle;
  let runtime: MemoriaAgentRuntime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
    });
    app = createApp(runtime);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("parses .md, .txt, .docx (paragraphs + tables), and .pdf documents", () => {
    const docxXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Redis 集群故障排查手册</w:t></w:r></w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:p><w:r><w:t>节点</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>端口</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:p><w:r><w:t>redis-01</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>6379</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>`;
    const docxBuf = buildSingleEntryZip("word/document.xml", Buffer.from(docxXml, "utf8"));
    const parsedDocx = parseDocumentBuffer(docxBuf, "redis-guide.docx");
    expect(parsedDocx).toContain("Redis 集群故障排查手册");
    expect(parsedDocx).toContain("redis-01 | 6379");

    const pdfContent = `%PDF-1.4
1 0 obj << /Length 44 >>
stream
BT /F1 12 Tf (PostgreSQL Max Connections = 500) Tj ET
endstream
endobj`;
    const parsedPdf = parseDocumentBuffer(Buffer.from(pdfContent, "latin1"), "pg-config.pdf");
    expect(parsedPdf).toContain("PostgreSQL Max Connections = 500");
  });

  it("performs Hybrid RAG (Float32 vector + FTS5 BM25 + RRF) and atomic cascade deletion", async () => {
    const kb = db.createKB({ name: "核心架构库", description: "后端微服务排障" });

    await runtime.pipeline.ingest({
      kbId: kb.id,
      filename: "k8s-oom.md",
      contentBuffer: Buffer.from(
        "# Kubernetes Pod OOMKilled 排障\n当容器内存超过 limits.memory 时，Linux 内核 OOM Killer 会发送 SIGKILL (Exit Code 137) 终止进程。",
        "utf8",
      ),
    });

    await runtime.pipeline.ingest({
      kbId: kb.id,
      filename: "mysql-deadlock.md",
      contentBuffer: Buffer.from(
        "# MySQL 死锁分析\n使用 SHOW ENGINE INNODB STATUS 查看最近一次死锁事务持有的行锁与等待队列。",
        "utf8",
      ),
    });

    // Query matching Chinese + English terms via FTS5 BM25 + Vector Cosine RRF
    const results = await runtime.pipeline.retrieve({
      kbIds: [kb.id],
      query: "Exit Code 137 内存 OOMKilled",
      topK: 2,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].filename).toBe("k8s-oom.md");
    expect(results[0].text).toContain("SIGKILL");
    expect(results[0].bm25_score).toBeGreaterThan(0);

    // Verify kb_read & kb_search inside an Agent turn
    const docId = results[0].doc_id;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("kb_search", { query: "Exit Code 137" }, { id: "call_1" }),
          fauxToolCall("kb_read", { doc_id: docId, max_chars: 500 }, { id: "call_2" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Exit Code 137 代表容器因内存超限被 OOM Killer 终止。")]),
    ]);

    const res = await app.request("/api/conversations/new/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "为什么 Pod 会报 Exit Code 137？",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [kb.id], hostIds: [], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
        wait: true,
      }),
    });
    const body = (await res.json()) as any;
    expect(body.status).toBe("done");
    expect(body.messages[1].sources[0].filename).toBe("k8s-oom.md");

    // Delete document and verify both kb_chunks and kb_chunks_fts are cleaned
    runtime.pipeline.deleteDoc(docId);
    const afterDelete = await runtime.pipeline.retrieve({
      kbIds: [kb.id],
      query: "Exit Code 137",
    });
    expect(afterDelete.find((r) => r.doc_id === docId)).toBeUndefined();
  });

  it("synchronizes local Vault incrementally (create, update, delete, and safety threshold guard)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "memoria-vault-test-"));
    try {
      writeFileSync(join(tempDir, "note1.md"), "笔记一：Kafka 分区重平衡机制", "utf8");
      writeFileSync(join(tempDir, "note2.txt"), "笔记二：Zookeeper 会话超时配置", "utf8");

      const kb = db.createKB({ name: "本地笔记 Vault", type: "vault" });
      runtime.vaultManager.createVault(kb.id, {
        type: "local",
        local_path: tempDir,
      });

      const ok1 = await runtime.vaultManager.syncVault(kb.id);
      expect(ok1).toBe(true);
      expect(db.listDocs(kb.id).length).toBe(2);

      // Modify note1.md and delete note2.txt
      writeFileSync(join(tempDir, "note1.md"), "笔记一（更新）：Kafka KRaft 控制器模式", "utf8");
      unlinkSync(join(tempDir, "note2.txt"));

      const ok2 = await runtime.vaultManager.syncVault(kb.id);
      expect(ok2).toBe(true);
      const docsAfter = db.listDocs(kb.id) as Array<{ filename: string }>;
      expect(docsAfter.length).toBe(1);
      expect(docsAfter[0].filename).toBe("note1.md");

      const hits = await runtime.pipeline.retrieve({
        kbIds: [kb.id],
        query: "KRaft 控制器",
      });
      expect(hits.length).toBe(1);
      expect(hits[0].text).toContain("KRaft");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
