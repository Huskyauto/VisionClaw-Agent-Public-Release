/**
 * Portable per-deliverable Evidence Docket.
 *
 * The single reviewer-facing artifact that bundles — for a given
 * (tenantId, conversationId / deliverable) — the pieces of provenance the
 * platform already produces but never emits together:
 *   - the goal contract(s) the work was held to (`deliverable_contracts`)
 *   - the completion-verification verdicts (`delivery_verifications`)
 *   - the CoVe / claim-grading report (passed inline by the caller; not persisted)
 *   - the jury concordance κ scores (`moa_responses`, tenant+window advisory)
 *   - the security audit trail (`security_intent_checks` + `security_tool_blocks`)
 *   - the delivery record(s) (`delivery_logs`)
 *   - a replay pointer into the step-ledger (runId)
 * so an external / institutional reviewer can audit a piece of work end-to-end
 * from one inspectable document.
 *
 * Design: the DB gather (`gatherDocketData`) is isolated behind a call-time
 * dynamic import of `./db` so importing this module for the PURE functions
 * (`assembleDocket` / `renderDocketMarkdown` / `renderDocketHtml`) never opens a
 * pg pool — that keeps the unit test hermetic (see memory: node-test-db-pool-hang).
 *
 * Tenant isolation: EVERY query in `gatherDocketData` filters `tenant_id` to the
 * caller's tenant. `deliverable_contracts` is a global shared definition table
 * (no tenant column) and carries no tenant data — only the contract shape.
 *
 * Secret / PII hygiene: every free-text value flows through
 * `redactPiiForStorage` during assembly (secrets/SSN/CC ALWAYS stripped; email/
 * phone stripped only when the caller opts OUT of customer PII, which is the
 * docket default since the audience is an external reviewer). The delivered
 * files are additionally secret-scanned fail-closed by the delivery pipeline.
 */

import { redactPiiForStorage, type PiiClass } from "./storage-helpers/pii-redaction-guard";

// ---------------------------------------------------------------------------
// Public option + result types
// ---------------------------------------------------------------------------

export interface EvidenceDocketOptions {
  /** REQUIRED. Every gathered row is scoped to this tenant. */
  tenantId: number;
  /** The conversation whose work is being audited. Ties the verification +
   * intent-check rows exactly; jury/tool-block/delivery rows fall back to a
   * tenant+time window (those tables carry no conversation_id). */
  conversationId?: number;
  /** Optional order id — ties delivery_logs rows exactly when present. */
  orderId?: string;
  /** Optional step-ledger run id — recorded as the replay pointer. */
  runId?: string;
  /** Explicit window bounds (ms epoch). When omitted they are derived from the
   * conversation's verification timestamps, else default to the last 24h. */
  windowStartMs?: number;
  windowEndMs?: number;
  /** Inline CoVe / claim-grading report (not persisted anywhere, so the caller
   * must pass it if they want it in the docket). Recursively secret/PII-redacted
   * (structure preserved) before it enters the reviewer artifact. */
  coveReport?: unknown;
  /** When true, keep customer email/phone in the docket. Default false — the
   * reviewer audience should not see customer contact PII. */
  includeCustomerPii?: boolean;
  /** Per-section row cap (bounds the scan). Clamped to [1, 200], default 50. */
  maxRows?: number;
}

export interface RawDocketData {
  contracts: any[];
  verifications: any[];
  jury: any[];
  intentChecks: any[];
  toolBlocks: any[];
  deliveries: any[];
  window: { startMs: number; endMs: number };
}

export interface EvidenceDocketSummary {
  totalVerifications: number;
  passed: number;
  failed: number;
  skipped: number;
  minKappa: number | null;
  juryEscalations: number;
  intentBlocks: number;
  toolBlocks: number;
  /** "PASS" when nothing failed/blocked/escalated; "REVIEW" otherwise. */
  overallVerdict: "PASS" | "REVIEW";
}

export interface EvidenceDocket {
  meta: {
    docketVersion: number;
    generatedAt: string;
    tenantId: number;
    conversationId: number | null;
    orderId: string | null;
    windowStart: string;
    windowEnd: string;
  };
  goalContracts: Array<{
    id: number | null;
    deliverableType: string;
    requiredExtensions: string[];
    requiredMimePattern: string | null;
    minSizeBytes: number | null;
    maxSizeBytes: number | null;
    renderCheck: string;
    description: string;
  }>;
  verifications: Array<{
    deliverableType: string;
    status: string;
    contractId: number | null;
    filePath: string | null;
    fileUrl: string | null;
    detectedExtension: string | null;
    detectedMime: string | null;
    detectedSize: number | null;
    failures: string[];
    verifiedAt: string | null;
  }>;
  cove: unknown | null;
  jury: Array<{
    question: string;
    aggregatorModel: string;
    proposerCount: number;
    proposerSuccessCount: number;
    concordance: number | null;
    shouldEscalate: boolean;
    invokedVia: string | null;
    createdAt: string | null;
  }>;
  security: {
    intentChecks: Array<{
      action: string;
      source: string;
      literalIntent: string | null;
      flaggedCategories: string[];
      reason: string | null;
      classifier: string | null;
      createdAt: string | null;
    }>;
    toolBlocks: Array<{
      toolName: string;
      reason: string;
      invokedVia: string | null;
      createdAt: string | null;
    }>;
  };
  delivery: Array<{
    orderId: string | null;
    productName: string;
    fileName: string;
    customerName: string;
    customerEmail: string | null;
    status: string;
    downloadLink: string | null;
    shareableLink: string | null;
    createdAt: string | null;
  }>;
  replay: {
    runId: string | null;
    retrieval: string;
  };
  summary: EvidenceDocketSummary;
  redactionClasses: PiiClass[];
}

// ---------------------------------------------------------------------------
// Pure assembly (DB-free — safe to import + unit-test without a pool)
// ---------------------------------------------------------------------------

function isoOrNull(v: any): string | null {
  if (!v) return null;
  try {
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function num(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assemble the raw gathered rows into the reviewer-facing docket. PURE: no DB,
 * no I/O. Redacts every free-text value through `redactPiiForStorage` and
 * accumulates the union of redacted classes.
 */
export function assembleDocket(
  raw: RawDocketData,
  opts: EvidenceDocketOptions,
): EvidenceDocket {
  const redactedClasses = new Set<PiiClass>();
  // Docket default: strip contact PII UNLESS the caller explicitly opts in.
  const redactContactInfo = opts.includeCustomerPii !== true;

  const scrub = (v: any, max = 2000): string => {
    const s = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
    const r = redactPiiForStorage(s, { redactContactInfo });
    for (const c of r.redactedClasses) redactedClasses.add(c);
    const out = r.redacted;
    return out.length > max ? out.slice(0, max) + "…[truncated]" : out;
  };
  const scrubOrNull = (v: any, max = 2000): string | null =>
    v == null || v === "" ? null : scrub(v, max);

  // Recursively redact a structured, caller-supplied payload (e.g. the CoVe
  // report) while preserving its shape. Every STRING leaf flows through the same
  // secret/PII scrubber as flat fields (so credentials/SSN/CC are ALWAYS
  // stripped, contact info per `redactContactInfo`); non-strings pass through.
  // Depth-bounded to defend against pathologically deep / cyclic input.
  const scrubDeep = (v: any, depth = 0): any => {
    if (depth > 8) return "…[depth-capped]";
    if (typeof v === "string") return scrub(v, 4000);
    if (Array.isArray(v)) return v.slice(0, 500).map((x) => scrubDeep(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = scrubDeep(val, depth + 1);
      return out;
    }
    return v;
  };

  const goalContracts = (raw.contracts || []).map((c) => ({
    id: num(c.id),
    deliverableType: String(c.deliverableType ?? ""),
    requiredExtensions: Array.isArray(c.requiredExtensions) ? c.requiredExtensions.map(String) : [],
    requiredMimePattern: c.requiredMimePattern ?? null,
    minSizeBytes: num(c.minSizeBytes),
    maxSizeBytes: num(c.maxSizeBytes),
    renderCheck: String(c.renderCheck ?? "none"),
    description: scrub(c.description ?? "", 1000),
  }));

  const verifications = (raw.verifications || []).map((v) => {
    const failuresArr = Array.isArray(v.failures) ? v.failures : [];
    return {
      deliverableType: String(v.deliverableType ?? ""),
      status: String(v.status ?? ""),
      contractId: num(v.contractId),
      filePath: scrubOrNull(v.filePath, 400),
      fileUrl: scrubOrNull(v.fileUrl, 400),
      detectedExtension: v.detectedExtension ?? null,
      detectedMime: v.detectedMime ?? null,
      detectedSize: num(v.detectedSize),
      failures: failuresArr.map((f: any) => scrub(f, 500)),
      verifiedAt: isoOrNull(v.verifiedAt),
    };
  });

  const jury = (raw.jury || []).map((j) => ({
    question: scrub(j.question ?? "", 600),
    aggregatorModel: String(j.aggregatorModel ?? ""),
    proposerCount: num(j.proposerCount) ?? 0,
    proposerSuccessCount: num(j.proposerSuccessCount) ?? 0,
    concordance: num(j.concordance),
    shouldEscalate: !!j.shouldEscalate,
    invokedVia: j.invokedVia ?? null,
    createdAt: isoOrNull(j.createdAt),
  }));

  const intentChecks = (raw.intentChecks || []).map((i) => ({
    action: String(i.action ?? ""),
    source: String(i.source ?? ""),
    literalIntent: scrubOrNull(i.literalIntent, 400),
    flaggedCategories: Array.isArray(i.flaggedCategories) ? i.flaggedCategories.map(String) : [],
    reason: scrubOrNull(i.reason, 400),
    classifier: i.classifier ?? null,
    createdAt: isoOrNull(i.createdAt),
  }));

  const toolBlocks = (raw.toolBlocks || []).map((b) => ({
    toolName: String(b.toolName ?? ""),
    reason: scrub(b.reason ?? "", 400),
    invokedVia: b.invokedVia ?? null,
    createdAt: isoOrNull(b.createdAt),
  }));

  const delivery = (raw.deliveries || []).map((d) => ({
    orderId: d.orderId ?? null,
    productName: scrub(d.productName ?? "", 300),
    fileName: scrub(d.fileName ?? "", 300),
    customerName: scrub(d.customerName ?? "", 200),
    customerEmail: scrubOrNull(d.customerEmail, 254),
    status: String(d.status ?? ""),
    // Links can carry signed/tokenized (access-bearing) URLs — scrub them
    // through the same secret redactor before they reach a reviewer artifact.
    downloadLink: scrubOrNull(d.downloadLink, 600),
    shareableLink: scrubOrNull(d.shareableLink, 600),
    createdAt: isoOrNull(d.createdAt),
  }));

  const passed = verifications.filter((v) => v.status === "passed").length;
  const failed = verifications.filter((v) => v.status === "failed").length;
  const skipped = verifications.filter((v) => v.status === "skipped").length;
  const kappas = jury.map((j) => j.concordance).filter((k): k is number => k != null);
  const minKappa = kappas.length ? Math.min(...kappas) : null;
  const juryEscalations = jury.filter((j) => j.shouldEscalate).length;
  const intentBlocks = intentChecks.filter((i) => i.action === "block").length;

  const summary: EvidenceDocketSummary = {
    totalVerifications: verifications.length,
    passed,
    failed,
    skipped,
    minKappa,
    juryEscalations,
    intentBlocks,
    toolBlocks: toolBlocks.length,
    overallVerdict:
      failed === 0 && toolBlocks.length === 0 && intentBlocks === 0 && juryEscalations === 0
        ? "PASS"
        : "REVIEW",
  };

  return {
    meta: {
      docketVersion: 1,
      generatedAt: new Date().toISOString(),
      tenantId: opts.tenantId,
      conversationId: opts.conversationId ?? null,
      orderId: opts.orderId ?? null,
      windowStart: isoOrNull(raw.window?.startMs) ?? new Date(0).toISOString(),
      windowEnd: isoOrNull(raw.window?.endMs) ?? new Date().toISOString(),
    },
    goalContracts,
    verifications,
    cove: opts.coveReport == null ? null : scrubDeep(opts.coveReport),
    jury,
    security: { intentChecks, toolBlocks },
    delivery,
    replay: {
      runId: opts.runId ?? null,
      retrieval: opts.runId
        ? `Reconstruct agent state via getLedger("${opts.runId}") / getWorldAt in server/step-ledger.ts (steps stored in agent_knowledge as step:${opts.runId}:<seq>:<kind>).`
        : "No runId supplied — no step-ledger replay pointer for this docket.",
    },
    summary,
    redactionClasses: [...redactedClasses],
  };
}

// ---------------------------------------------------------------------------
// Pure renderers
// ---------------------------------------------------------------------------

export function renderDocketMarkdown(d: EvidenceDocket): string {
  const L: string[] = [];
  L.push(`# Evidence Docket`);
  L.push("");
  L.push(`**Overall verdict:** ${d.summary.overallVerdict}`);
  L.push("");
  L.push(`- Generated: ${d.meta.generatedAt}`);
  L.push(`- Tenant: ${d.meta.tenantId}`);
  L.push(`- Conversation: ${d.meta.conversationId ?? "(ad-hoc)"}`);
  if (d.meta.orderId) L.push(`- Order: ${d.meta.orderId}`);
  L.push(`- Window: ${d.meta.windowStart} → ${d.meta.windowEnd}`);
  if (d.redactionClasses.length) L.push(`- Redacted classes: ${d.redactionClasses.join(", ")}`);
  L.push("");

  L.push(`## Summary`);
  L.push(`| Metric | Value |`);
  L.push(`| --- | --- |`);
  L.push(`| Verifications (passed/failed/skipped) | ${d.summary.passed} / ${d.summary.failed} / ${d.summary.skipped} |`);
  L.push(`| Min jury κ | ${d.summary.minKappa == null ? "n/a" : d.summary.minKappa.toFixed(3)} |`);
  L.push(`| Jury escalations | ${d.summary.juryEscalations} |`);
  L.push(`| Intent-gate blocks | ${d.summary.intentBlocks} |`);
  L.push(`| Tool-policy blocks | ${d.summary.toolBlocks} |`);
  L.push("");

  L.push(`## Goal contracts`);
  if (!d.goalContracts.length) L.push(`_None referenced._`);
  for (const c of d.goalContracts) {
    L.push(`- **${c.deliverableType}** (id ${c.id ?? "—"}): render=${c.renderCheck}, ext=[${c.requiredExtensions.join(", ")}], mime=${c.requiredMimePattern ?? "any"}, size=${c.minSizeBytes ?? 0}..${c.maxSizeBytes ?? "∞"} — ${c.description}`);
  }
  L.push("");

  L.push(`## Completion verifications`);
  if (!d.verifications.length) L.push(`_No verification rows._`);
  for (const v of d.verifications) {
    L.push(`- [${v.status.toUpperCase()}] ${v.deliverableType} — ${v.filePath ?? v.fileUrl ?? "(no path)"} (${v.detectedMime ?? "?"}, ${v.detectedSize ?? "?"} bytes) @ ${v.verifiedAt ?? "?"}`);
    for (const f of v.failures) L.push(`  - ⚠ ${f}`);
  }
  L.push("");

  L.push(`## Chain-of-Verification (CoVe)`);
  L.push(d.cove ? "```json\n" + JSON.stringify(d.cove, null, 2) + "\n```" : "_Not supplied inline (CoVe reports are not persisted)._");
  L.push("");

  L.push(`## Jury concordance (κ)`);
  if (!d.jury.length) L.push(`_No jury rows in window._`);
  for (const j of d.jury) {
    L.push(`- κ=${j.concordance == null ? "n/a" : j.concordance.toFixed(3)}${j.shouldEscalate ? " ⚑ ESCALATE" : ""} — ${j.aggregatorModel} (${j.proposerSuccessCount}/${j.proposerCount} proposers, via ${j.invokedVia ?? "?"}) @ ${j.createdAt ?? "?"}`);
    L.push(`  - Q: ${j.question}`);
  }
  L.push("");

  L.push(`## Security audit`);
  L.push(`### Intent-gate checks`);
  if (!d.security.intentChecks.length) L.push(`_None._`);
  for (const i of d.security.intentChecks) {
    L.push(`- [${i.action.toUpperCase()}] source=${i.source} cats=[${i.flaggedCategories.join(", ")}] @ ${i.createdAt ?? "?"}${i.reason ? ` — ${i.reason}` : ""}`);
  }
  L.push(`### Tool-policy blocks`);
  if (!d.security.toolBlocks.length) L.push(`_None._`);
  for (const b of d.security.toolBlocks) {
    L.push(`- ${b.toolName} — ${b.reason} (via ${b.invokedVia ?? "?"}) @ ${b.createdAt ?? "?"}`);
  }
  L.push("");

  L.push(`## Delivery record`);
  if (!d.delivery.length) L.push(`_No delivery rows._`);
  for (const x of d.delivery) {
    L.push(`- [${x.status}] ${x.productName} → ${x.fileName}${x.orderId ? ` (order ${x.orderId})` : ""} @ ${x.createdAt ?? "?"}`);
  }
  L.push("");

  L.push(`## Replay pointer`);
  L.push(`- runId: ${d.replay.runId ?? "—"}`);
  L.push(`- ${d.replay.retrieval}`);
  L.push("");

  L.push(`## Reviewer decision`);
  L.push(`_External / institutional reviewer — record your disposition below._`);
  L.push("");
  L.push(`- [ ] ACCEPT  - [ ] REJECT  - [ ] REVISE  - [ ] DISSENT`);
  L.push(`- Reviewer: ______________________  Date: ____________`);
  L.push(`- Notes:`);
  L.push("");

  return L.join("\n");
}

function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDocketHtml(d: EvidenceDocket): string {
  const verdictColor = d.summary.overallVerdict === "PASS" ? "#137333" : "#b06000";
  const rows = (arr: string[]) => (arr.length ? arr.join("") : `<p class="empty">None.</p>`);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence Docket — tenant ${esc(d.meta.tenantId)} conversation ${esc(d.meta.conversationId ?? "adhoc")}</title>
<meta name="description" content="Portable per-deliverable Evidence Docket: goal contract, verification verdicts, jury concordance, security audit, and replay pointer for end-to-end review.">
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem; max-width: 60rem; margin-inline: auto; line-height: 1.5; }
  h1 { margin-bottom: .25rem; }
  .verdict { display: inline-block; font-weight: 700; color: #fff; background: ${verdictColor}; padding: .2rem .7rem; border-radius: 999px; font-size: .95rem; }
  .meta { color: #666; font-size: .9rem; margin: .5rem 0 1.5rem; }
  section { border: 1px solid #e2e2e2; border-radius: .6rem; padding: 1rem 1.25rem; margin: 1rem 0; }
  h2 { margin-top: 0; font-size: 1.15rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  td, th { border: 1px solid #e2e2e2; padding: .35rem .55rem; text-align: left; vertical-align: top; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
  pre { background: #f6f6f6; padding: .75rem; border-radius: .4rem; overflow-x: auto; }
  .empty { color: #999; font-style: italic; }
  .pill { font-size: .72rem; padding: .1rem .45rem; border-radius: 999px; background: #eee; }
  .fail { color: #b00020; }
  ul { padding-left: 1.1rem; }
  .decision label { display: inline-block; margin-right: 1.2rem; }
</style></head>
<body>
<h1>Evidence Docket</h1>
<div><span class="verdict">${esc(d.summary.overallVerdict)}</span></div>
<p class="meta">
  Generated ${esc(d.meta.generatedAt)} · tenant ${esc(d.meta.tenantId)} · conversation ${esc(d.meta.conversationId ?? "(ad-hoc)")}${d.meta.orderId ? ` · order ${esc(d.meta.orderId)}` : ""}<br>
  Window ${esc(d.meta.windowStart)} → ${esc(d.meta.windowEnd)}${d.redactionClasses.length ? `<br>Redacted: ${esc(d.redactionClasses.join(", "))}` : ""}
</p>

<section><h2>Summary</h2>
<table>
  <tr><th>Verifications (pass/fail/skip)</th><td>${d.summary.passed} / <span class="${d.summary.failed ? "fail" : ""}">${d.summary.failed}</span> / ${d.summary.skipped}</td></tr>
  <tr><th>Min jury κ</th><td>${d.summary.minKappa == null ? "n/a" : d.summary.minKappa.toFixed(3)}</td></tr>
  <tr><th>Jury escalations</th><td>${d.summary.juryEscalations}</td></tr>
  <tr><th>Intent-gate blocks</th><td>${d.summary.intentBlocks}</td></tr>
  <tr><th>Tool-policy blocks</th><td>${d.summary.toolBlocks}</td></tr>
</table></section>

<section><h2>Goal contracts</h2>
${rows(d.goalContracts.map((c) => `<p><strong>${esc(c.deliverableType)}</strong> <span class="pill">${esc(c.renderCheck)}</span><br><code>ext=[${esc(c.requiredExtensions.join(", "))}] mime=${esc(c.requiredMimePattern ?? "any")} size=${esc(c.minSizeBytes ?? 0)}..${esc(c.maxSizeBytes ?? "∞")}</code><br>${esc(c.description)}</p>`))}
</section>

<section><h2>Completion verifications</h2>
${rows(d.verifications.map((v) => `<p><span class="pill">${esc(v.status)}</span> <strong>${esc(v.deliverableType)}</strong> — <code>${esc(v.filePath ?? v.fileUrl ?? "(no path)")}</code><br><small>${esc(v.detectedMime ?? "?")} · ${esc(v.detectedSize ?? "?")} bytes · ${esc(v.verifiedAt ?? "?")}</small>${v.failures.length ? `<ul>${v.failures.map((f) => `<li class="fail">${esc(f)}</li>`).join("")}</ul>` : ""}</p>`))}
</section>

<section><h2>Chain-of-Verification (CoVe)</h2>
${d.cove ? `<pre>${esc(JSON.stringify(d.cove, null, 2))}</pre>` : `<p class="empty">Not supplied inline (CoVe reports are not persisted).</p>`}
</section>

<section><h2>Jury concordance (κ)</h2>
${rows(d.jury.map((j) => `<p>κ=<strong>${j.concordance == null ? "n/a" : esc(j.concordance.toFixed(3))}</strong>${j.shouldEscalate ? ` <span class="pill fail">ESCALATE</span>` : ""} — ${esc(j.aggregatorModel)} <small>(${esc(j.proposerSuccessCount)}/${esc(j.proposerCount)} proposers · ${esc(j.invokedVia ?? "?")} · ${esc(j.createdAt ?? "?")})</small><br><small>Q: ${esc(j.question)}</small></p>`))}
</section>

<section><h2>Security audit</h2>
<h3>Intent-gate checks</h3>
${rows(d.security.intentChecks.map((i) => `<p><span class="pill">${esc(i.action)}</span> source=${esc(i.source)} <small>${esc(i.createdAt ?? "?")}</small>${i.flaggedCategories.length ? `<br>cats: ${esc(i.flaggedCategories.join(", "))}` : ""}${i.reason ? `<br>${esc(i.reason)}` : ""}</p>`))}
<h3>Tool-policy blocks</h3>
${rows(d.security.toolBlocks.map((b) => `<p class="fail"><strong>${esc(b.toolName)}</strong> — ${esc(b.reason)} <small>(${esc(b.invokedVia ?? "?")} · ${esc(b.createdAt ?? "?")})</small></p>`))}
</section>

<section><h2>Delivery record</h2>
${rows(d.delivery.map((x) => `<p><span class="pill">${esc(x.status)}</span> ${esc(x.productName)} → <code>${esc(x.fileName)}</code>${x.orderId ? ` <small>(order ${esc(x.orderId)})</small>` : ""} <small>${esc(x.createdAt ?? "?")}</small></p>`))}
</section>

<section><h2>Replay pointer</h2>
<p>runId: <code>${esc(d.replay.runId ?? "—")}</code></p>
<p><small>${esc(d.replay.retrieval)}</small></p>
</section>

<section class="decision"><h2>Reviewer decision</h2>
<p class="empty">External / institutional reviewer — record your disposition.</p>
<p><label><input type="checkbox"> ACCEPT</label><label><input type="checkbox"> REJECT</label><label><input type="checkbox"> REVISE</label><label><input type="checkbox"> DISSENT</label></p>
<p>Reviewer: __________________________ Date: ______________</p>
</section>

</body></html>`;
}

// ---------------------------------------------------------------------------
// DB gather (tenant-scoped) + public entry point
// ---------------------------------------------------------------------------

/**
 * Fetch every docket source, ALWAYS scoped to `opts.tenantId`. Dynamic-imports
 * `./db` so the pure functions above stay pool-free for unit tests.
 */
export async function gatherDocketData(opts: EvidenceDocketOptions): Promise<RawDocketData> {
  const { db } = await import("./db");
  const {
    deliverableContracts,
    deliveryVerifications,
    securityIntentChecks,
    securityToolBlocks,
    deliveryLogs,
  } = await import("@shared/schema");
  const { and, eq, gte, lte, desc, inArray, sql } = await import("drizzle-orm");

  const tenantId = opts.tenantId;
  const maxRows = Math.min(Math.max(opts.maxRows ?? 50, 1), 200);

  // 1. Verifications — exact tie on conversationId when present.
  const verifWhere = opts.conversationId != null
    ? and(eq(deliveryVerifications.tenantId, tenantId), eq(deliveryVerifications.conversationId, opts.conversationId))
    : eq(deliveryVerifications.tenantId, tenantId);
  const verifications = await db
    .select()
    .from(deliveryVerifications)
    .where(verifWhere)
    .orderBy(desc(deliveryVerifications.verifiedAt))
    .limit(maxRows);

  // Derive the advisory time window (for the conversation-less tables) from the
  // verification timestamps when not explicitly given, else last 24h.
  const now = Date.now();
  let startMs = opts.windowStartMs;
  let endMs = opts.windowEndMs;
  if (startMs == null || endMs == null) {
    const times = verifications
      .map((v: any) => (v.verifiedAt ? new Date(v.verifiedAt).getTime() : NaN))
      .filter((n: number) => Number.isFinite(n));
    if (times.length) {
      const min = Math.min(...times);
      const max = Math.max(...times);
      startMs = startMs ?? min - 60 * 60 * 1000;
      endMs = endMs ?? max + 60 * 60 * 1000;
    } else {
      startMs = startMs ?? now - 24 * 60 * 60 * 1000;
      endMs = endMs ?? now;
    }
  }
  const winStart = new Date(startMs);
  const winEnd = new Date(endMs);

  // 2. Goal contracts referenced by the verifications.
  const contractIds = Array.from(
    new Set(verifications.map((v: any) => v.contractId).filter((id: any): id is number => typeof id === "number")),
  );
  const contracts = contractIds.length
    ? await db.select().from(deliverableContracts).where(inArray(deliverableContracts.id, contractIds))
    : [];

  // 3. Intent checks — exact tie on conversationId when present.
  const intentWhere = opts.conversationId != null
    ? and(eq(securityIntentChecks.tenantId, tenantId), eq(securityIntentChecks.conversationId, opts.conversationId))
    : and(eq(securityIntentChecks.tenantId, tenantId), gte(securityIntentChecks.createdAt, winStart), lte(securityIntentChecks.createdAt, winEnd));
  const intentChecks = await db
    .select()
    .from(securityIntentChecks)
    .where(intentWhere)
    .orderBy(desc(securityIntentChecks.createdAt))
    .limit(maxRows);

  // 4. Tool blocks — no conversation_id column; tenant + window (advisory).
  const toolBlocks = await db
    .select()
    .from(securityToolBlocks)
    .where(and(eq(securityToolBlocks.tenantId, tenantId), gte(securityToolBlocks.createdAt, winStart), lte(securityToolBlocks.createdAt, winEnd)))
    .orderBy(desc(securityToolBlocks.createdAt))
    .limit(maxRows);

  // 5. Jury κ — no conversation_id column; tenant + window (advisory). Read via
  // a raw parameterized query: the live moa_responses table (created by raw SQL
  // in server/moa.ts) carries `concordance` + `should_escalate` columns that the
  // Drizzle schema does NOT declare, so a drizzle .select() would silently drop
  // κ. Tenant-scoped + parameterized (never sql.raw with input).
  const juryRes = await db.execute(sql`
    SELECT question, aggregator_model, proposer_count, proposer_success_count,
           concordance, should_escalate, invoked_via, created_at
    FROM moa_responses
    WHERE tenant_id = ${tenantId}
      AND created_at >= ${winStart} AND created_at <= ${winEnd}
    ORDER BY created_at DESC
    LIMIT ${maxRows}
  `);
  const jury = (((juryRes as any).rows || juryRes || []) as any[]).map((r) => ({
    question: r.question,
    aggregatorModel: r.aggregator_model,
    proposerCount: r.proposer_count,
    proposerSuccessCount: r.proposer_success_count,
    concordance: r.concordance,
    shouldEscalate: r.should_escalate,
    invokedVia: r.invoked_via,
    createdAt: r.created_at,
  }));

  // 6. Delivery logs — exact tie on orderId when present, else tenant + window.
  const deliveryWhere = opts.orderId
    ? and(eq(deliveryLogs.tenantId, tenantId), eq(deliveryLogs.orderId, opts.orderId))
    : and(eq(deliveryLogs.tenantId, tenantId), gte(deliveryLogs.createdAt, winStart), lte(deliveryLogs.createdAt, winEnd));
  const deliveries = await db
    .select()
    .from(deliveryLogs)
    .where(deliveryWhere)
    .orderBy(desc(deliveryLogs.createdAt))
    .limit(maxRows);

  return {
    contracts,
    verifications,
    jury,
    intentChecks,
    toolBlocks,
    deliveries,
    window: { startMs: startMs!, endMs: endMs! },
  };
}

/**
 * Build the docket end-to-end: tenant-scoped gather → pure assemble → render.
 * Returns the structured docket plus the rendered JSON / Markdown / HTML.
 */
export async function buildEvidenceDocket(opts: EvidenceDocketOptions): Promise<{
  docket: EvidenceDocket;
  json: string;
  markdown: string;
  html: string;
}> {
  const raw = await gatherDocketData(opts);
  const docket = assembleDocket(raw, opts);
  return {
    docket,
    json: JSON.stringify(docket, null, 2),
    markdown: renderDocketMarkdown(docket),
    html: renderDocketHtml(docket),
  };
}
