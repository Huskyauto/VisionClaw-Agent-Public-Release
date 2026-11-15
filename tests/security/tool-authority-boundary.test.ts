import test from "node:test";
import assert from "node:assert/strict";
import { prepareToolInvocation, resolveToolPersonaId } from "../../server/tools/invocation-authority";

test("task arguments cannot choose any invocation authority", () => {
  const prepared = prepareToolInvocation({
    text: "ok", tenantId: 1, _tenantId: 1, _personaId: 1,
    _invokedVia: "main_chat", _rateLimitChecked: true, _selfHeal: true,
    _allowedPaths: ["/"], _newFutureBypass: true,
  }, { tenantId: 42, invokedVia: "mcp-server", actor: "external" });
  assert.equal(prepared._tenantId, 42);
  assert.equal(prepared._invokedVia, "mcp-server");
  assert.equal(prepared._personaId, undefined);
  assert.equal(prepared._rateLimitChecked, false);
  assert.equal(prepared._newFutureBypass, undefined);
  assert.equal(prepared._allowedPaths, undefined);
  assert.equal(prepared.tenantId, undefined);
  assert.equal(prepared.text, "ok");
});

test("legacy host persona names resolve uniquely, never from task arguments or system fallback", async () => {
  const lookup = async () => [{ id: 7, name: "Forge" }, { id: 8, name: "Felix" }];
  assert.equal(await resolveToolPersonaId({ actor: "persona", personaName: "Forge" }, lookup), 7);
  assert.equal(await resolveToolPersonaId({ actor: "external", personaName: "Forge" }, lookup), undefined);
  assert.equal(await resolveToolPersonaId({ actor: "system", personaName: "Forge" }, lookup), undefined);
  assert.equal(await resolveToolPersonaId({ actor: "persona", personaName: "unknown" }, lookup), undefined);
  assert.equal(await resolveToolPersonaId({ actor: "persona", personaName: "Forge" },
    async () => [{ id: 7, name: "Forge" }, { id: 8, name: "Forge" }]), undefined);
});

test("missing authority, malformed identity, and unspecified internal origin fail closed", () => {
  for (const ctx of [undefined, {}, { tenantId: 0 }, { tenantId: 1, invokedVia: "system" }]) {
    assert.throws(() => prepareToolInvocation({}, ctx as any), /authority|tenant|actor|channel/i);
  }
});

test("trusted metadata cannot replace authority and opaque server receipts survive", () => {
  const receipt = Symbol("server-receipt");
  const raw = Object.defineProperty({ value: 1 }, receipt, { value: "opaque", enumerable: false });
  const prepared = prepareToolInvocation(raw, {
    tenantId: 42, personaId: 7, actor: "persona", invokedVia: "chat_engine",
    metadata: { _tenantId: 1, _invokedVia: "main_chat", _projectDriveFolderId: "folder" },
  });
  assert.equal(prepared._tenantId, 42);
  assert.equal(prepared._invokedVia, "chat_engine");
  assert.equal(prepared._projectDriveFolderId, "folder");
  assert.equal(prepared[receipt], "opaque");
});
