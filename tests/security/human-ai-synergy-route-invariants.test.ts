import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("human-ai synergy route security invariants", () => {
  const source = readFileSync("server/routes/human-ai-synergy.ts", "utf8");
  it("uses the exact kill switch and authenticated tenant resolver", () => {
    assert.match(source, /HUMAN_AI_SYNERGY_TRIAL_ENABLED === "1"/);
    assert.match(source, /deps\.getTenant\(req\)/);
    assert.match(source, /eq\(synergyTrials\.tenantId, tenantId\)/);
  });
  it("does not accept tenant identity from the request body", () => {
    assert.doesNotMatch(source, /body\.tenantId|tenantId\s*=\s*body/);
    assert.match(source, /requireOwnerAdmin/);
  });
  it("enforces bounded idempotency and stores aggregate result", () => {
    assert.match(source, /keyPattern/);
    assert.match(source, /result:\s*scored/);
    assert.match(source, /idempotent/);
  });
  it("uses the server-owned rubric and bounded frontend metadata", () => {
    assert.match(source, /human-ai-synergy-v1/);
    assert.match(source, /trialName/);
    assert.match(source, /notes/);
    assert.doesNotMatch(source, /body\.rubricVersion/);
  });
  it("audits security input with persisted measurements and rejects whitespace", () => {
    assert.match(source, /measurements:\s*\{\s*securityPass,\s*arms\s*\}/);
    assert.match(source, /trim\(\)/);
    assert.match(source, /409/);
    assert.match(source, /idempotency conflict/);
  });
});