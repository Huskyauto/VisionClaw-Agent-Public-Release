import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { getPublicCatalog, lookupProduct } from "../server/product-catalog";

const root = process.cwd();
const webhook = fs.readFileSync(path.join(root, "server/webhookHandlers.ts"), "utf8");
const adminRoutes = fs.readFileSync(path.join(root, "server/routes/admin.ts"), "utf8");
const reviewQueue = fs.readFileSync(path.join(root, "server/service-review-queue.ts"), "utf8");
const serviceOrders = fs.readFileSync(path.join(root, "client/src/pages/admin-service-orders.tsx"), "utf8");
const SKUS = ["sample-agency-audit-starter", "sample-agency-audit-full"] as const;

function withFlag(value: string | undefined, run: () => void) {
  const previous = process.env.AI_TASK_FIT_AUDIT_ENABLED;
  if (value === undefined) delete process.env.AI_TASK_FIT_AUDIT_ENABLED;
  else process.env.AI_TASK_FIT_AUDIT_ENABLED = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env.AI_TASK_FIT_AUDIT_ENABLED;
    else process.env.AI_TASK_FIT_AUDIT_ENABLED = previous;
  }
}

test("task-fit audit products fail closed unless the server flag is exact 1", () => {
  for (const value of [undefined, "", "0", "true", "TRUE", " 1 "]) {
    withFlag(value, () => {
      assert.equal(SKUS.some(sku => getPublicCatalog().some(product => product.sku === sku)), false);
      for (const sku of SKUS) assert.equal(lookupProduct(sku), null);
    });
  }
  withFlag("1", () => {
    assert.deepEqual(SKUS.map(sku => lookupProduct(sku)?.priceCents), [49700, 199700]);
    assert.deepEqual(SKUS.map(sku => getPublicCatalog().find(product => product.sku === sku)?.priceCents), [49700, 199700]);
  });
});

test("both packages are manual services with bounded customer intake", () => {
  withFlag("1", () => {
    for (const sku of SKUS) {
      const product = lookupProduct(sku);
      assert.equal(product?.kind, "service");
      assert.equal(product?.serviceType, "human-agency-audit");
      assert.ok(product?.intakeFields?.length);
      for (const field of product?.intakeFields || []) {
        assert.ok((field.maxLength || 0) > 0);
        assert.equal(field.type, "select", `sensitive audit intake must use selectors: ${field.key}`);
        assert.ok((field.options?.length || 0) > 0);
      }
      const goal = product?.intakeFields?.find(field => field.key === "primary_goal");
      assert.equal(goal?.required, true);
      assert.deepEqual(goal?.options?.map(option => option.value), [
        "time-savings", "customer-response", "quality-rework", "reporting-visibility", "other-interview",
      ]);
    }
  });
});

test("paid audit webhook queues one manual order and returns before any generator or delivery", () => {
  const branch = webhook.slice(
    webhook.indexOf("product.serviceType === 'human-agency-audit'"),
    webhook.indexOf("product.serviceType === 'research-report'"),
  );
  assert.match(branch, /await addReviewItem/);
  assert.match(branch, /durable: true/);
  assert.match(branch, /filePath: ''/);
  assert.match(branch, /status: 'pending'/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /fulfillResearchReport|fulfillReadinessAudit|deliverDigitalProduct/);
});

test("manual audit delivery stays owner-reviewed and PDF-gated", () => {
  assert.match(reviewQueue, /sample-agency-audit-[\s\S]*eligible: false/);
  assert.match(adminRoutes, /tenantId !== ADMIN_TENANT_ID \|\| !isAdminRequest\(req\)/);
  assert.match(adminRoutes, /attach-pdf[\s\S]*mimeType !== "application\/pdf"/);
  assert.match(adminRoutes, /bytes\.length > 15 \* 1024 \* 1024/);
  assert.match(adminRoutes, /toString\("ascii"\) !== "%PDF-"/);
  assert.match(adminRoutes, /Attach a valid PDF before approval/);
  assert.match(serviceOrders, /input-attach-pdf-/);
  assert.match(serviceOrders, /Attach final PDF/);
});