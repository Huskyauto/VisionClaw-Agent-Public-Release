import crypto from "node:crypto";

export function hashAdminPinWithKey(pin: string, key: string): string {
  return crypto.createHmac("sha256", key).update(pin).digest("hex");
}

export function verifyAdminPinWithKey(pin: string, storedHash: string, key: string): boolean {
  const candidate = hashAdminPinWithKey(pin, key);
  if (candidate.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(storedHash, "hex"),
    );
  } catch {
    return false;
  }
}