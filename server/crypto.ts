import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_PREFIX = "enc:v1:";

function getDerivedKey(): Buffer {
  const secret = process.env.SESSION_SECRET || "";
  return crypto.scryptSync(secret, "visionclaw-key-encryption-v1", 32);
}

export function encryptApiKey(plaintext: string): string {
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cannot store API keys without SESSION_SECRET configured. Set SESSION_SECRET to enable encryption.");
    }
    console.warn("[crypto] WARNING: SESSION_SECRET not set — API key stored without encryption");
    return plaintext;
  }
  if (plaintext.startsWith(ENCRYPTION_PREFIX)) return plaintext;

  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return ENCRYPTION_PREFIX + iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) return ciphertext;
  if (!process.env.SESSION_SECRET) return ciphertext;

  try {
    const payload = ciphertext.slice(ENCRYPTION_PREFIX.length);
    const [ivHex, authTagHex, encrypted] = payload.split(":");
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("[crypto] Failed to decrypt API key — returning raw value");
    return ciphertext;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}
