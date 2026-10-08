/**
 * Shared outbound-email preflight — the ONE set of safety gates every email
 * transport must pass before submission, regardless of provider (AgentMail,
 * Gmail-direct, or any future channel).
 *
 * Gates, in order:
 *   1. Bounce gate  — refuse known hard-bouncing recipients (R98.25) across
 *                     to/cc/bcc/replyTo.
 *   2. Quality gate — customer-facing content scanned for generation-failure
 *                     debris (fail-open on infra error, fail-closed on HARD
 *                     findings). Owner-only recipients are exempt (their
 *                     alert emails legitimately quote raw errors).
 *   3. R95 redaction — secret/PII egress gate over subject/text/html; throws
 *                     on block, returns redacted payloads otherwise.
 *
 * server/email.ts (AgentMail) and the delivery pipeline's Gmail-direct owner
 * path both call this, so a new transport can never silently skip a gate.
 * Query-free at module load (dynamic imports for anything that could touch
 * the DB) so unit tests can import it without a pg pool.
 */

export interface OutboundEmailInput {
  to: unknown;
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
  subject?: string;
  text?: string;
  html?: string;
}

export interface OutboundEmailPreflightResult {
  /** Gated + redacted payloads — transports must send THESE, not the inputs. */
  subject: string;
  text: string;
  html?: string;
}

export function collectRecipients(field: unknown): string[] {
  if (field == null) return [];
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s === "string") {
      for (const piece of s.split(/[,;]/)) {
        const v = piece.trim().toLowerCase();
        if (v) out.push(v);
      }
    } else if (s && typeof s === "object") {
      const e = (s as any).email || (s as any).address;
      if (typeof e === "string") push(e);
    }
  };
  if (Array.isArray(field)) field.forEach(push); else push(field);
  return out;
}

/**
 * RFC 2047-encode a Subject header when it contains non-ASCII characters.
 * Raw UTF-8 bytes in hand-built MIME headers render as mojibake ("â€”") in
 * Gmail; ASCII subjects pass through unchanged.
 */
export function encodeMimeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

/**
 * True when a sendEmail() return value is a suppression sentinel from the
 * owner-digest gate ({queued}/{silenced}) rather than a real provider send.
 * Callers must NEVER record send-success for a suppressed result.
 */
export function isSuppressedSendResult(result: unknown): boolean {
  return Boolean(result && typeof result === "object" &&
    ((result as any).queued || (result as any).silenced));
}

export async function preflightOutboundEmail(params: OutboundEmailInput): Promise<OutboundEmailPreflightResult> {
  const bodyText = params.text || "";

  // 1. Bounce gate (R98.25) — all recipient channels.
  const BOUNCED_DEFAULT = new Set(["admin@visionclaw.ai"]);
  const bouncedExtra = String(process.env.EMAIL_BOUNCED_RECIPIENTS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bouncedSet = new Set([...BOUNCED_DEFAULT, ...bouncedExtra]);
  const allRecipients = [
    ...collectRecipients(params.to),
    ...collectRecipients(params.cc),
    ...collectRecipients(params.bcc),
    ...collectRecipients(params.replyTo),
  ];
  const blocked = allRecipients.find((r) => bouncedSet.has(r));
  if (blocked) {
    throw new Error(
      `Email refused by R98.25 bouncing-recipient gate: "${blocked}" (in to/cc/bcc/replyTo) is on the SES hard-bounce list. Update the caller to use a deliverable address or remove from EMAIL_BOUNCED_RECIPIENTS if the address has been re-verified at the provider.`,
    );
  }

  // 2. Quality gate (R125+138) — external recipients only; fail-open on
  //    infra errors, fail-closed on HARD findings.
  try {
    const { resolveOwnerEmails } = await import("./owner-email");
    const ownerSet = new Set(resolveOwnerEmails().map((s) => s.toLowerCase()));
    const deliveryRecipients = [
      ...collectRecipients(params.to),
      ...collectRecipients(params.cc),
      ...collectRecipients(params.bcc),
    ];
    const hasExternalRecipient = deliveryRecipients.some((r) => !ownerSet.has(r));
    if (hasExternalRecipient) {
      const { scanCustomerFacingText, reportQualityIncident } = await import("./outbound-quality-gate");
      const scan = scanCustomerFacingText([params.subject || "", bodyText, params.html || ""].join("\n"));
      if (scan.degraded) {
        reportQualityIncident({
          tenantId: 1,
          signature: "outbound_quality_gate_degraded",
          title: `outbound email shipped UNSCANNED — quality-gate scanner crashed (fail-open)`,
          error: "scanCustomerFacingText returned degraded:true",
          stage: "outbound-email",
          candidateFiles: ["server/lib/outbound-quality-gate.ts", "server/lib/outbound-email-preflight.ts"],
          metadata: { subject: params.subject, kind: "send" },
        });
      }
      if (scan.blocked) {
        const detail = scan.reasons.join("; ").slice(0, 1000);
        reportQualityIncident({
          tenantId: 1,
          signature: "email_quality_gate_blocked",
          title: `outbound email blocked by quality gate: ${params.subject || "(no subject)"}`,
          error: detail,
          stage: "outbound-email",
          candidateFiles: ["server/lib/outbound-email-preflight.ts", "server/lib/outbound-quality-gate.ts"],
          metadata: { to: params.to, subject: params.subject },
        });
        throw new Error(`Email refused by outbound quality gate (broken/error content must never reach a customer): ${detail}`);
      }
    }
  } catch (e: any) {
    if (e?.message?.includes("outbound quality gate")) throw e;
    console.warn(`[email-preflight] quality gate error (failing open): ${e?.message}`); // infra bug ≠ block
  }

  // 3. R95 secret/PII redaction — throws on block, returns redacted payloads.
  const { enforceOutbound } = await import("./outbound-redaction");
  const subjectGate = enforceOutbound(params.subject || "", { surface: "email:subject" });
  if (!subjectGate.ok) throw new Error(`Email send refused by R95 (subject): ${subjectGate.error}`);
  const textGate = enforceOutbound(bodyText, { surface: "email:text" });
  if (!textGate.ok) throw new Error(`Email send refused by R95 (text): ${textGate.error}`);
  let safeHtml: string | undefined = undefined;
  if (params.html) {
    const htmlGate = enforceOutbound(params.html, { surface: "email:html" });
    if (!htmlGate.ok) throw new Error(`Email send refused by R95 (html): ${htmlGate.error}`);
    safeHtml = htmlGate.payload;
  }

  return { subject: subjectGate.payload, text: textGate.payload, html: safeHtml };
}
