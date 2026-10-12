import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const SECRET_SALT = Buffer.from("memoria_secret_salt_2026", "utf8");
const DEFAULT_SECRET_KEY =
  process.env.MEMORIA_SECRET_KEY || "default_memoria_encryption_key_change_in_production";
const ENCRYPTED_PREFIX = "enc:v1:";

function deriveKey(secretKey = DEFAULT_SECRET_KEY): Buffer {
  return pbkdf2Sync(Buffer.from(secretKey, "utf8"), SECRET_SALT, 100_000, 32, "sha256");
}

export function encryptSecret(plaintext?: string | null, secretKey = DEFAULT_SECRET_KEY): string {
  if (!plaintext) return "";
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;
  const key = deriveKey(secretKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  return `${ENCRYPTED_PREFIX}${combined}`;
}

export function decryptSecret(ciphertext?: string | null, secretKey = DEFAULT_SECRET_KEY): string {
  if (!ciphertext) return "";
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext;
  try {
    const raw = Buffer.from(ciphertext.slice(ENCRYPTED_PREFIX.length), "base64url");
    if (raw.length < 28) return ciphertext;
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const key = deriveKey(secretKey);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return ciphertext;
  }
}
