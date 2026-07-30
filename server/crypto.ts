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

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

let _legacyPlaintextWarned = false;

export function decryptApiKey(ciphertext: string): string {
  // Legacy plaintext (no enc:v1: prefix) is returned as-is for backward compat.
  if (!ciphertext.startsWith(ENCRYPTION_PREFIX)) {
    if (!_legacyPlaintextWarned) {
      _legacyPlaintextWarned = true;
      console.warn("[crypto] Legacy plaintext credential returned (no enc:v1: prefix). Re-save these values via encryptApiKey to migrate. This warning fires once per process — check DB for unmigrated rows in api_keys / oauth_tokens / connector tables.");
    }
    return ciphertext;
  }

  // SECURITY (R74.13u-sec): values WITH the enc:v1: prefix MUST be decrypted
  // successfully — never return the raw ciphertext as if it were plaintext.
  // Returning the encrypted blob downstream would leak it into logs and
  // outbound API requests as a "credential" that callers then mishandle.
  // Fail closed by throwing; callers must catch and report.
  if (!process.env.SESSION_SECRET) {
    throw new DecryptionError("SESSION_SECRET not configured — cannot decrypt enc:v1: payload");
  }

  try {
    const payload = ciphertext.slice(ENCRYPTION_PREFIX.length);
    const [ivHex, authTagHex, encrypted] = payload.split(":");
    if (!ivHex || !authTagHex || encrypted === undefined) {
      throw new DecryptionError("Malformed enc:v1: payload (expected iv:authTag:ciphertext)");
    }
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    // SECURITY: pass authTagLength explicitly so a forged short tag (which
    // is easier to brute-force) cannot be substituted. Locks GCM to 16 bytes.
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err: any) {
    if (err instanceof DecryptionError) throw err;
    console.error("[crypto] Decryption failed for enc:v1: payload:", err?.message);
    throw new DecryptionError("Failed to decrypt enc:v1: payload — refusing to return ciphertext");
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}
