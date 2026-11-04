import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "esbuild";
import { missionLinkMetadata, resolveStripeMissionId } from "../../server/lib/mission-stripe-association";

const parse = (metadata: any): number | null => {
  const value = metadata?.mission_id;
  return /^[1-9]\d*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
};

test("mission link metadata reaches the eventual PaymentIntent, not just the link/session", () => {
  const fields = missionLinkMetadata("audit-report", 42);
  assert.deepEqual(fields.metadata, { bundle_sku: "audit-report", mission_id: "42" });
  assert.deepEqual(fields.payment_intent_data.metadata, fields.metadata);
  assert.deepEqual(missionLinkMetadata("audit-report", null).metadata, { bundle_sku: "audit-report" });
  assert.throws(() => missionLinkMetadata("audit-report", -1));
});

test("legacy link payment resolves immutable checkout-session metadata by exact PaymentIntent", async () => {
  const calls: string[] = [];
  const id = await resolveStripeMissionId("payment", { id: "pi_old", metadata: {} }, {
    parse,
    retrieveIntent: async () => { throw new Error("unexpected read"); },
    listSessions: async intent => {
      calls.push(intent);
      return { data: [{ payment_intent: "pi_old", payment_link: "plink_old", metadata: { mission_id: "42" } }] };
    },
  });
  assert.equal(id, 42);
  assert.deepEqual(calls, ["pi_old"]);
});

test("refund without charge metadata follows its exact parent PaymentIntent", async () => {
  const id = await resolveStripeMissionId("refund", { id: "ch_1", payment_intent: "pi_1", metadata: {} }, {
    parse,
    retrieveIntent: async id => { assert.equal(id, "pi_1"); return { id, metadata: { mission_id: "42" } }; },
    listSessions: async () => { throw new Error("unexpected read"); },
  });
  assert.equal(id, 42);
});

test("legacy refund can follow PaymentIntent to the original link session", async () => {
  assert.equal(await resolveStripeMissionId("refund", { id: "ch_1", payment_intent: "pi_old" }, {
    parse,
    retrieveIntent: async id => ({ id, metadata: {} }),
    listSessions: async () => ({ data: [{ payment_intent: "pi_old", payment_link: "plink_old", metadata: { mission_id: "42" } }] }),
  }), 42);
});

test("ambiguous/foreign session identities and malformed explicit mission metadata fail closed", async () => {
  for (const result of [
    { data: [{ payment_intent: "pi_foreign", payment_link: "plink_1", metadata: { mission_id: "42" } }] },
    { data: [{ payment_intent: "pi_1", metadata: { mission_id: "42" } }] },
    { data: [{ payment_intent: "pi_1", payment_link: "plink_1", metadata: { mission_id: "42" } }], has_more: true },
    { data: [{}, {}] },
  ]) {
    assert.equal(await resolveStripeMissionId("payment", { id: "pi_1" }, {
      parse, retrieveIntent: async () => { throw new Error("unexpected"); },
      listSessions: async () => result,
    }), null);
  }
  assert.equal(await resolveStripeMissionId("payment", { id: "pi_1", metadata: { mission_id: "garbage" } }, {
    parse, retrieveIntent: async () => { throw new Error("unexpected"); },
    listSessions: async () => { throw new Error("must not reinterpret malformed explicit association"); },
  }), null);
});

test("ordinary unlinked payments no-op; provider failure bubbles for webhook retry", async () => {
  assert.equal(await resolveStripeMissionId("payment", { id: "pi_1" }, {
    parse, retrieveIntent: async () => ({}), listSessions: async () => ({ data: [] }),
  }), null);
  await assert.rejects(resolveStripeMissionId("payment", { id: "pi_1" }, {
    parse, retrieveIntent: async () => ({}), listSessions: async () => { throw new Error("provider unavailable"); },
  }), /provider unavailable/);
});

test("actual payment-link handler stamps new links, repairs reuse, and denies foreign mission before Stripe", async () => {
  const source = readFileSync("server/tools/domains/commerce/handlers.ts", "utf8");
  const ast = ts.createSourceFile("commerce.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createPaymentLinkHandler")!;
  assert.ok(node);
  const code = transformSync(`export ${node.getText(ast).replace(/import\("([^"]+)"\)/g, 'importModule("$1")')}`,
    { loader: "ts", format: "cjs" }).code;
  for (const scenario of ["new", "reused", "foreign"]) {
    const calls: any[] = [];
    const module: any = { exports: {} };
    const row: any = {
      product_name: "Audit", mission_id: 42, active: true, price_cents: 35000,
      stripe_product_id: "prod_1", stripe_price_id: "price_1",
      ...(scenario === "reused" ? { stripe_payment_link_id: "plink_1", stripe_payment_link_url: "https://example.test/pay" } : {}),
    };
    const stripe = { paymentLinks: {
      create: async (params: any, options: any) => { calls.push({ op: "create", params, options }); return { id: "plink_1", url: "https://example.test/pay" }; },
      update: async (id: string, params: any, options: any) => { calls.push({ op: "update", id, params, options }); return {}; },
    } };
    const services = {
      getProductBySku: async (tid: number) => { assert.equal(tid, 1); return row; },
      getMission: async (tid: number, id: number) => { assert.equal(tid, 1); assert.equal(id, 42); return scenario === "foreign" ? null : { id }; },
      saveStripeRefs: async () => {},
      getUncachableStripeClient: async () => stripe,
      withLedgerIdempotency: (options: any) => options,
      missionLinkMetadata,
    };
    vm.runInNewContext(code, {
      module, exports: module.exports, ownerGate: async () => ({ tenantId: 1 }),
      importModule: async () => services,
    });
    const result = await module.exports.createPaymentLinkHandler({ sku: "audit-report" }, {});
    if (scenario === "foreign") {
      assert.match(result.error, /outside the owner tenant/);
      assert.equal(calls.length, 0);
    } else {
      assert.equal(result.error, undefined);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].op, scenario === "new" ? "create" : "update");
      assert.equal(calls[0].params.payment_intent_data.metadata.mission_id, "42");
      assert.match(calls[0].options.idempotencyKey, /v2/);
    }
  }
});
