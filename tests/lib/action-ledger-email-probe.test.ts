/**
 * Action Ledger S4 — sent-mail verify probe + advisory abort context (feature
 * contract: data/feature-contracts/action-ledger/ — spec.md + plan.md § S4).
 *
 * Proves:
 *   - the pure header matcher finds the ledger-key header case-insensitively
 *     and never matches on absence / wrong key,
 *   - the probe registry routes send_email → emailVerifyProbe (and leaves the
 *     Stripe routing untouched),
 *   - sendEmailInternal stamps the X-VC-Ledger-Key header ONLY under a ledger
 *     ALS context (static text-scan — server/email.ts is never imported, no
 *     provider client / pg pool touched),
 *   - the tool-abort ALS context threads a signal into the async subtree and
 *     is absent outside it (parity),
 *   - fetchWithTimeout adopts the ALS signal only as a fallback (explicit
 *     caller signal wins — static scan).
 *
 * NEVER imports server/tools.ts or server/email.ts (pg-pool / provider-client
 * hang class); everything here is pure modules + static text scans.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  matchEmailMessageByLedgerKey,
  getVerifyProbe,
  emailVerifyProbe,
  stripeVerifyProbe,
  EMAIL_LEDGERED_TOOLS,
  EMAIL_LEDGER_HEADER,
} from "../../server/lib/action-ledger-probes";
import {
  runWithToolAbortSignal,
  getCurrentToolAbortSignal,
} from "../../server/lib/tool-abort-context";

// ---------- pure matcher ----------

test("S4 matcher: exact lowercase header match", () => {
  const hit = matchEmailMessageByLedgerKey(
    [{ messageId: "m1", headers: { [EMAIL_LEDGER_HEADER]: "vc-al1-abc" } }],
    "vc-al1-abc",
  );
  assert.equal(hit?.messageId, "m1");
});

test("S4 matcher: header name matched case-insensitively (provider casing)", () => {
  const hit = matchEmailMessageByLedgerKey(
    [
      { messageId: "m0", headers: { "X-Other": "vc-al1-abc" } },
      { messageId: "m2", headers: { "X-VC-Ledger-Key": "vc-al1-abc" } },
    ],
    "vc-al1-abc",
  );
  assert.equal(hit?.messageId, "m2");
});

test("S4 matcher: header VALUE is exact — no partial/case-fuzzy value match", () => {
  assert.equal(
    matchEmailMessageByLedgerKey(
      [{ messageId: "m1", headers: { "x-vc-ledger-key": "VC-AL1-ABC" } }],
      "vc-al1-abc",
    ),
    undefined,
  );
});

test("S4 matcher: no headers / null headers / empty key never match", () => {
  assert.equal(matchEmailMessageByLedgerKey([{ messageId: "m1" }], "k"), undefined);
  assert.equal(matchEmailMessageByLedgerKey([{ messageId: "m1", headers: null }], "k"), undefined);
  assert.equal(
    matchEmailMessageByLedgerKey([{ messageId: "m1", headers: { "x-vc-ledger-key": "" } }], ""),
    undefined,
    "empty idempotency key must never match",
  );
});

// ---------- registry routing ----------

test("S4 registry: send_email routes to the email probe; stripe routing untouched", () => {
  assert.ok(EMAIL_LEDGERED_TOOLS.has("send_email"));
  assert.equal(getVerifyProbe("send_email"), emailVerifyProbe);
  assert.equal(getVerifyProbe("stripe_create_payout"), stripeVerifyProbe);
  assert.equal(getVerifyProbe("read_file"), undefined);
});

test("S4 probe stance: probe module never returns failed without proven (static)", () => {
  const src = readFileSync(path.join(process.cwd(), "server/lib/action-ledger-probes.ts"), "utf8");
  // Every `outcome: "failed"` literal in the module must carry proven: true.
  const failed = src.match(/outcome:\s*"failed"[^}]*/g) ?? [];
  for (const f of failed) {
    assert.ok(f.includes("proven"), `failed outcome without proven flag: ${f.slice(0, 80)}`);
  }
});

// ---------- email header stamp seam (static scan) ----------

const emailSrc = readFileSync(path.join(process.cwd(), "server/email.ts"), "utf8");

test("S4 seam: sendEmailInternal stamps X-VC-Ledger-Key from the ledger ALS context", () => {
  assert.ok(
    emailSrc.includes("getCurrentLedgerAttempt"),
    "email.ts must read the ledger ALS context",
  );
  assert.ok(
    emailSrc.includes('"X-VC-Ledger-Key"'),
    "email.ts must stamp the ledger-key header",
  );
});

test("S4 seam: header casing agrees between stamp and probe (lowercase compare)", () => {
  assert.equal("X-VC-Ledger-Key".toLowerCase(), EMAIL_LEDGER_HEADER);
});

// ---------- advisory abort context ----------

test("S4 abort ctx: signal visible inside the subtree, absent outside", async () => {
  assert.equal(getCurrentToolAbortSignal(), undefined, "no signal outside a wrapped dispatch");
  const ctrl = new AbortController();
  const seen = await runWithToolAbortSignal(ctrl.signal, async () => {
    await new Promise(r => setImmediate(r)); // survive an async hop
    return getCurrentToolAbortSignal();
  });
  assert.equal(seen, ctrl.signal);
  assert.equal(getCurrentToolAbortSignal(), undefined, "context must not leak after run");
});

test("S4 abort ctx: nested runs shadow correctly", async () => {
  const outer = new AbortController();
  const innerC = new AbortController();
  await runWithToolAbortSignal(outer.signal, async () => {
    assert.equal(getCurrentToolAbortSignal(), outer.signal);
    await runWithToolAbortSignal(innerC.signal, async () => {
      assert.equal(getCurrentToolAbortSignal(), innerC.signal);
    });
    assert.equal(getCurrentToolAbortSignal(), outer.signal);
  });
});

// ---------- fetchWithTimeout fallback seam (static scan) ----------

test("S4 seam: fetchWithTimeout adopts ALS signal only when no explicit signal", () => {
  const src = readFileSync(path.join(process.cwd(), "server/lib/fetch-with-timeout.ts"), "utf8");
  assert.ok(src.includes("getCurrentToolAbortSignal"), "fetchWithTimeout must consult the ALS signal");
  assert.ok(
    src.includes("if (!callerSignal)"),
    "explicit caller-supplied signal must win over the ALS fallback",
  );
});

// ---------- executeToolWithTimeout threading seam (static scan) ----------

test("S4 seam: executeToolWithTimeout wraps executeTool in runWithToolAbortSignal", () => {
  const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
  assert.ok(
    toolsSrc.includes("runWithToolAbortSignal(controller.signal, () => executeTool(name, params))"),
    "the dispatch inside the Promise.race must run under the abort ALS context",
  );
});

test("S4 seam: dispatcher surfaces the ALS signal on ToolContext", () => {
  const dispatcherSrc = readFileSync(path.join(process.cwd(), "server/tools/dispatcher.ts"), "utf8");
  assert.ok(dispatcherSrc.includes("abortSignal: getCurrentToolAbortSignal()"));
});
