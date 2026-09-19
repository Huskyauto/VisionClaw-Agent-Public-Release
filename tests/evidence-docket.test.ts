/**
 * Hermetic unit test for the Evidence Docket PURE assembly + renderers.
 *
 * Imports ONLY the pool-free exports (`assembleDocket` / `renderDocketMarkdown`
 * / `renderDocketHtml`). It must NEVER import `gatherDocketData` /
 * `buildEvidenceDocket` — those dynamic-import `./db`, which opens a pg pool and
 * hangs `node --test` to the 124 timeout (see memory: node-test-db-pool-hang).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleDocket,
  renderDocketMarkdown,
  renderDocketHtml,
  type RawDocketData,
  type EvidenceDocketOptions,
} from "../server/evidence-docket";

const WINDOW = { startMs: 1_700_000_000_000, endMs: 1_700_000_100_000 };

function cleanRaw(): RawDocketData {
  return {
    contracts: [
      {
        id: 7,
        deliverableType: "pdf_report",
        requiredExtensions: ["pdf"],
        requiredMimePattern: "application/pdf",
        minSizeBytes: 1024,
        maxSizeBytes: null,
        renderCheck: "pdf_pages",
        description: "A branded PDF report.",
      },
    ],
    verifications: [
      {
        deliverableType: "pdf_report",
        status: "passed",
        contractId: 7,
        filePath: "/uploads/delivery-1-report.pdf",
        fileUrl: null,
        detectedExtension: "pdf",
        detectedMime: "application/pdf",
        detectedSize: 20480,
        failures: [],
        verifiedAt: new Date(WINDOW.startMs + 500).toISOString(),
      },
    ],
    jury: [
      {
        question: "Is the plan sound?",
        aggregatorModel: "anthropic/claude",
        proposerCount: 3,
        proposerSuccessCount: 3,
        concordance: 0.82,
        shouldEscalate: false,
        invokedVia: "ensemble_query",
        createdAt: new Date(WINDOW.startMs + 100).toISOString(),
      },
    ],
    intentChecks: [
      {
        action: "allow",
        source: "user",
        literalIntent: "generate a report",
        flaggedCategories: [],
        reason: null,
        classifier: "intent-gate",
        createdAt: new Date(WINDOW.startMs + 50).toISOString(),
      },
    ],
    toolBlocks: [],
    deliveries: [
      {
        orderId: "ord-1",
        productName: "Report",
        fileName: "report.pdf",
        customerName: "Acme Co",
        customerEmail: "buyer@acme.example",
        status: "completed",
        downloadLink: "https://drive.example/d/1",
        shareableLink: "https://drive.example/s/1",
        createdAt: new Date(WINDOW.startMs + 900).toISOString(),
      },
    ],
    window: WINDOW,
  };
}

const baseOpts: EvidenceDocketOptions = { tenantId: 42, conversationId: 99, orderId: "ord-1", runId: "run-abc" };

test("clean data assembles to a PASS verdict", () => {
  const d = assembleDocket(cleanRaw(), baseOpts);
  assert.equal(d.summary.overallVerdict, "PASS");
  assert.equal(d.summary.passed, 1);
  assert.equal(d.summary.failed, 0);
  assert.equal(d.summary.minKappa, 0.82);
  assert.equal(d.summary.juryEscalations, 0);
  assert.equal(d.meta.tenantId, 42);
  assert.equal(d.meta.conversationId, 99);
  assert.equal(d.replay.runId, "run-abc");
  assert.match(d.replay.retrieval, /run-abc/);
});

test("failed verification flips verdict to REVIEW", () => {
  const raw = cleanRaw();
  raw.verifications[0].status = "failed";
  raw.verifications[0].failures = ["missing pages"];
  const d = assembleDocket(raw, baseOpts);
  assert.equal(d.summary.overallVerdict, "REVIEW");
  assert.equal(d.summary.failed, 1);
});

test("tool block or low-κ escalation flips verdict to REVIEW", () => {
  const raw = cleanRaw();
  raw.jury[0].concordance = 0.3;
  raw.jury[0].shouldEscalate = true;
  const d = assembleDocket(raw, baseOpts);
  assert.equal(d.summary.overallVerdict, "REVIEW");
  assert.equal(d.summary.juryEscalations, 1);
});

test("intent block flips verdict to REVIEW", () => {
  const raw = cleanRaw();
  raw.intentChecks[0].action = "block";
  const d = assembleDocket(raw, baseOpts);
  assert.equal(d.summary.overallVerdict, "REVIEW");
  assert.equal(d.summary.intentBlocks, 1);
});

test("customer contact PII is stripped by default (reviewer audience)", () => {
  const d = assembleDocket(cleanRaw(), baseOpts);
  const email = d.delivery[0].customerEmail ?? "";
  assert.ok(!email.includes("buyer@acme.example"), "raw email must not survive default redaction");
  assert.ok(d.redactionClasses.includes("email"), "email class recorded in redaction classes");
});

test("customer contact PII is preserved when includeCustomerPii=true", () => {
  const d = assembleDocket(cleanRaw(), { ...baseOpts, includeCustomerPii: true });
  assert.equal(d.delivery[0].customerEmail, "buyer@acme.example");
});

test("secrets are ALWAYS stripped even with includeCustomerPii=true", () => {
  const raw = cleanRaw();
  raw.verifications[0].failures = ["token REDACTED_STRIPE_LIVE_KEY leaked"];
  const d = assembleDocket(raw, { ...baseOpts, includeCustomerPii: true });
  const joined = d.verifications[0].failures.join(" ");
  assert.ok(!joined.includes("REDACTED_STRIPE_LIVE_KEY"), "secret must be redacted regardless");
});

test("secrets in the CoVe report are recursively stripped, structure preserved", () => {
  const cove = {
    verdict: "pass",
    checks: [
      { claim: "cited source", note: "api key REDACTED_STRIPE_LIVE_KEY in log" },
      { claim: "nested", detail: { deeper: "another REDACTED_STRIPE_LIVE_KEY here" } },
    ],
    score: 0.9,
  };
  const d = assembleDocket(cleanRaw(), { ...baseOpts, coveReport: cove });
  const serialized = JSON.stringify(d.cove);
  assert.ok(!serialized.includes("REDACTED_STRIPE_LIVE_KEY"), "top-level secret in cove must be redacted");
  assert.ok(!serialized.includes("REDACTED_STRIPE_LIVE_KEY"), "nested secret in cove must be redacted");
  // structure preserved
  assert.equal((d.cove as any).verdict, "pass");
  assert.equal((d.cove as any).score, 0.9);
  assert.equal((d.cove as any).checks.length, 2);
});

test("access-bearing delivery links are scrubbed of secret-shaped tokens", () => {
  const raw = cleanRaw();
  raw.deliveries[0].downloadLink = "https://drive.example/d/1?token=REDACTED_STRIPE_LIVE_KEY";
  const d = assembleDocket(raw, baseOpts);
  const link = d.delivery[0].downloadLink ?? "";
  assert.ok(!link.includes("REDACTED_STRIPE_LIVE_KEY"), "signed token in a delivery link must be redacted");
});

test("null CoVe report stays null (no redaction artifact injected)", () => {
  const d = assembleDocket(cleanRaw(), baseOpts);
  assert.equal(d.cove, null);
});

test("redacted CoVe/link secrets never reappear in rendered markdown or html", () => {
  const raw = cleanRaw();
  raw.deliveries[0].downloadLink = "https://drive.example/d/1?token=REDACTED_STRIPE_LIVE_KEY";
  const cove = { checks: [{ note: "leaked REDACTED_STRIPE_LIVE_KEY token" }] };
  const d = assembleDocket(raw, { ...baseOpts, coveReport: cove });
  const md = renderDocketMarkdown(d);
  const html = renderDocketHtml(d);
  for (const out of [md, html]) {
    assert.ok(!out.includes("REDACTED_STRIPE_LIVE_KEY"), "delivery-link secret must not survive into rendered output");
    assert.ok(!out.includes("REDACTED_STRIPE_LIVE_KEY"), "cove secret must not survive into rendered output");
  }
});

test("empty raw data assembles without throwing and is PASS", () => {
  const empty: RawDocketData = {
    contracts: [], verifications: [], jury: [], intentChecks: [], toolBlocks: [], deliveries: [],
    window: WINDOW,
  };
  const d = assembleDocket(empty, { tenantId: 1 });
  assert.equal(d.summary.overallVerdict, "PASS");
  assert.equal(d.summary.totalVerifications, 0);
  assert.equal(d.summary.minKappa, null);
  assert.equal(d.replay.runId, null);
});

test("markdown renderer emits the verdict and section headers", () => {
  const md = renderDocketMarkdown(assembleDocket(cleanRaw(), baseOpts));
  assert.equal(typeof md, "string");
  assert.ok(md.length > 0);
  assert.match(md, /PASS/);
});

test("html renderer emits a well-formed document", () => {
  const html = renderDocketHtml(assembleDocket(cleanRaw(), baseOpts));
  assert.match(html, /<html/i);
  assert.match(html, /<\/html>/i);
});

test("html renderer escapes angle brackets from free text", () => {
  const raw = cleanRaw();
  raw.contracts[0].description = "<script>alert('x')</script>";
  const html = renderDocketHtml(assembleDocket(raw, baseOpts));
  assert.ok(!html.includes("<script>alert"), "raw script tag must be HTML-escaped");
});
