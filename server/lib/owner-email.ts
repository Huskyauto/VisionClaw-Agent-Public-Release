/**
 * Fork-safe owner email resolution.
 *
 * Resolves the platform owner's alert/digest address from environment only,
 * and returns "" when nothing is configured. Callers MUST treat "" as "skip the
 * send" rather than falling back to a hardcoded personal address — a fork that
 * has not set OWNER_ALERT_EMAIL / OWNER_EMAIL must never email the original
 * author of the platform.
 *
 * Bob's own instance sets OWNER_ALERT_EMAIL (+ OWNER_EMAILS / SITE_OWNER_EMAIL),
 * so its behavior is unchanged; only a fresh fork resolves to "".
 */

function firstCsv(value: string | undefined): string | undefined {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
}

/** Single best owner address, or "" when none is configured. */
export function resolveOwnerEmail(): string {
  return (
    process.env.OWNER_EMAIL ||
    process.env.OWNER_ALERT_EMAIL ||
    firstCsv(process.env.OWNER_EMAILS) ||
    process.env.SITE_OWNER_EMAIL ||
    process.env.SITE_CONTACT_EMAIL ||
    ""
  ).trim();
}

/** All configured owner addresses, lowercased + de-duplicated (may be empty). */
export function resolveOwnerEmails(): string[] {
  const single = [
    process.env.OWNER_EMAIL,
    process.env.OWNER_ALERT_EMAIL,
    process.env.SITE_OWNER_EMAIL,
    process.env.SITE_CONTACT_EMAIL,
  ];
  const multi = String(process.env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const all = [...single, ...multi].filter(Boolean) as string[];
  return Array.from(new Set(all.map((s) => s.trim().toLowerCase())));
}
