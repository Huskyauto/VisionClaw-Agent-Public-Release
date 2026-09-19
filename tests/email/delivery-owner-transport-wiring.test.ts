/**
 * Static integration guard for the task-161 delivery-pipeline wiring.
 * Parsed statically to avoid DB/provider side effects while proving the host
 * calls the independently tested owner transport and does not initialize
 * AgentMail before choosing the owner branch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const source = readFileSync(path.join(ROOT, "server/delivery-pipeline.ts"), "utf8");

test("delivery pipeline owner path is independent of AgentMail initialization", () => {
  const start = source.indexOf("const ownerRecipient =");
  const end = source.indexOf("emailSent = true;", start);
  assert.ok(start >= 0 && end > start, "could not locate delivery email routing block");
  const block = source.slice(start, end);

  assert.match(block, /shouldAttemptDeliveryEmail\s*\(\s*\{/);
  assert.match(block, /if\s*\(\s*ownerRecipient\s*\)[\s\S]*sendOwnerEmailVerified\s*\(/);
  assert.doesNotMatch(
    block,
    /getPrimaryInboxId\s*\(/,
    "owner routing block must not initialize AgentMail before Gmail is selected",
  );
});