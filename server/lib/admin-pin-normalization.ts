export function normalizeAdminPin(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function requireNormalizedAdminPin(value: unknown): string {
  const normalized = normalizeAdminPin(value);
  if (!normalized) {
    throw new Error("PIN cannot be empty or whitespace-only");
  }
  return normalized;
}