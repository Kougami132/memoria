import { extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

export const SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
  ".yaml",
  ".yml",
]);

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extract a file by path from a ZIP buffer using Node built-in zlib.
 */
function extractZipEntry(zipBuffer: Buffer, entryName: string): Buffer | null {
  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minEocdOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const cdEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < cdEntries && cdOffset + 46 <= zipBuffer.length; i++) {
    if (zipBuffer.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const compressionMethod = zipBuffer.readUInt16LE(cdOffset + 10);
    const compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
    const fileNameLen = zipBuffer.readUInt16LE(cdOffset + 28);
    const extraLen = zipBuffer.readUInt16LE(cdOffset + 30);
    const commentLen = zipBuffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cdOffset + 42);

    const name = zipBuffer.subarray(cdOffset + 46, cdOffset + 46 + fileNameLen).toString("utf8");
    cdOffset += 46 + fileNameLen + extraLen + commentLen;

    if (name === entryName) {
      if (localHeaderOffset + 30 > zipBuffer.length) return null;
      if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;
      const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        return Buffer.from(compressedData);
      }
      if (compressionMethod === 8) {
        return inflateRawSync(compressedData);
      }
      return null;
    }
  }
  return null;
}

/**
 * Parse .docx buffer by reading word/document.xml paragraphs (<w:p>) and tables (<w:tbl>).
 */
export function parseDocxBuffer(buffer: Buffer): string {
  const xmlBuf = extractZipEntry(buffer, "word/document.xml");
  if (!xmlBuf) {
    throw new Error("Invalid .docx file: word/document.xml not found");
  }
  const xml = xmlBuf.toString("utf8");
  const blocks: string[] = [];

  // Match either <w:tbl>...</w:tbl> or <w:p ...>...</w:p> in document order
  const blockRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const extractParagraphText = (pXml: string): string => {
    const runs: string[] = [];
    const textRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
    let m: RegExpExecArray | null;
    while ((m = textRegex.exec(pXml)) !== null) {
      if (m[0] === "<w:tab/>") runs.push("\t");
      else if (m[0] === "<w:br/>") runs.push("\n");
      else if (m[1]) runs.push(decodeXmlEntities(m[1]));
    }
    return runs.join("").trim();
  };

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xml)) !== null) {
    const chunk = match[0];
    if (chunk.startsWith("<w:tbl")) {
      const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(chunk)) !== null) {
        const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        const cells: string[] = [];
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
          const pRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
          const cellParts: string[] = [];
          let pMatch: RegExpExecArray | null;
          while ((pMatch = pRegex.exec(cellMatch[0])) !== null) {
            const pText = extractParagraphText(pMatch[0]);
            if (pText) cellParts.push(pText);
          }
          cells.push(cellParts.join(" "));
        }
        const rowLine = cells.join(" | ").trim();
        if (rowLine) blocks.push(rowLine);
      }
    } else {
      const pText = extractParagraphText(chunk);
      if (pText) blocks.push(pText);
    }
  }

  return blocks.join("\n\n");
}

function decodePdfLiteralString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[++i];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next >= "0" && next <= "7") {
        let oct = next;
        if (i + 1 < raw.length && raw[i + 1] >= "0" && raw[i + 1] <= "7") oct += raw[++i];
        if (i + 1 < raw.length && raw[i + 1] >= "0" && raw[i + 1] <= "7") oct += raw[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else {
        out += next;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (clean.toUpperCase().startsWith("FEFF")) {
    const buf = Buffer.from(clean.slice(4), "hex");
    let out = "";
    for (let i = 0; i + 1 < buf.length; i += 2) {
      out += String.fromCharCode(buf.readUInt16BE(i));
    }
    return out;
  }
  return Buffer.from(clean, "hex").toString("utf8");
}

/**
 * Extract plain text from a PDF buffer (supports uncompressed & FlateDecode content streams).
 */
export function parsePdfBuffer(buffer: Buffer): string {
  const contentSources: string[] = [];
  const rawLatin1 = buffer.toString("latin1");
  contentSources.push(rawLatin1);

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRegex.exec(rawLatin1)) !== null) {
    const rawStream = Buffer.from(m[1], "latin1");
    try {
      const decompressed = inflateSync(rawStream);
      contentSources.push(decompressed.toString("latin1"));
    } catch {
      // Not a zlib-compressed stream or uses another filter
    }
  }

  const extractedLines: string[] = [];
  for (const src of contentSources) {
    const btEtRegex = /BT\b([\s\S]*?)\bET/g;
    let btMatch: RegExpExecArray | null;
    while ((btMatch = btEtRegex.exec(src)) !== null) {
      const block = btMatch[1];
      const parts: string[] = [];
      const tokenRegex = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
      let tok: RegExpExecArray | null;
      while ((tok = tokenRegex.exec(block)) !== null) {
        if (tok[0].startsWith("(")) {
          parts.push(decodePdfLiteralString(tok[0].slice(1, -1)));
        } else if (tok[1]) {
          parts.push(decodePdfHexString(tok[1]));
        }
      }
      const joined = parts.join("").trim();
      if (joined) extractedLines.push(joined);
    }
  }

  return Array.from(new Set(extractedLines)).join("\n\n");
}

export function parseDocumentBuffer(buffer: Buffer, filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file format: ${ext}. Supported: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}`);
  }

  if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".yaml" || ext === ".yml") {
    return buffer.toString("utf8");
  }
  if (ext === ".docx") {
    return parseDocxBuffer(buffer);
  }
  if (ext === ".pdf") {
    return parsePdfBuffer(buffer);
  }
  return "";
}

/**
 * Structure-aware recursive character text splitter.
 */
export function splitTextIntoChunks(
  text: string,
  chunkSize = 512,
  chunkOverlap = 128,
): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const separators = ["\n\n", "\n", "。", "！", "？", ". ", " ", ""];

  function splitRecursively(input: string, sepIndex: number): string[] {
    if (input.length <= chunkSize) return [input];
    const sep = separators[sepIndex] ?? "";
    if (sep === "") {
      const slices: string[] = [];
      const step = Math.max(1, chunkSize - chunkOverlap);
      for (let i = 0; i < input.length; i += step) {
        slices.push(input.slice(i, i + chunkSize));
        if (i + chunkSize >= input.length) break;
      }
      return slices;
    }

    const parts = input.split(sep);
    if (parts.length === 1) {
      return splitRecursively(input, sepIndex + 1);
    }

    const chunks: string[] = [];
    let current = "";

    for (const part of parts) {
      const candidate = current ? `${current}${sep}${part}` : part;
      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current);
          // Retain overlap tail from current if possible
          const overlapTail =
            chunkOverlap > 0 && current.length > chunkOverlap
              ? current.slice(current.length - chunkOverlap)
              : "";
          const withOverlap = overlapTail ? `${overlapTail}${sep}${part}` : part;
          if (withOverlap.length <= chunkSize) {
            current = withOverlap;
          } else if (part.length <= chunkSize) {
            current = part;
          } else {
            chunks.push(...splitRecursively(part, sepIndex + 1));
            current = "";
          }
        } else {
          chunks.push(...splitRecursively(part, sepIndex + 1));
        }
      }
    }
    if (current.trim()) {
      chunks.push(current);
    }
    return chunks;
  }

  return splitRecursively(cleaned, 0)
    .map((c) => c.trim())
    .filter(Boolean);
}
