import test from "node:test";
import assert from "node:assert/strict";
import { externalToolArguments } from "../../server/tools/external-arguments";

test("external callers cannot forge any authority fields or tenant aliases", () => {
  const args = externalToolArguments({
    query: "safe input", _rateLimitChecked: true, _personaId: 1,
    _conversationId: 2, _projectId: 3, _allowedPaths: ["/"],
    _selfHeal: true, _approvedByGate: true, _futureBypass: true,
    _tenantId: 1, tenantId: 1, _invokedVia: "main_chat",
    _invokedByModel: false,
  }, 42);
  assert.equal(args.query, "safe input");
  assert.deepEqual(Object.keys(args).sort(),
    ["query", "_tenantId", "_invokedVia", "_invokedByModel"].sort());
  assert.equal(args._tenantId, 42);
  assert.equal(args._invokedVia, "mcp-server");
  assert.equal(args._invokedByModel, true);
  assert.throws(() => externalToolArguments({}, 0), /tenant/);
});
