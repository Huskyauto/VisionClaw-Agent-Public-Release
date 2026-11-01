import assert from "node:assert/strict";
import test from "node:test";
import { resolveChatModelInfo } from "../../server/lib/chat-model-identity";

const fixed = [{ id: "gpt-5.4", provider: "replit" }];
const dynamic = { id: "cheaperinference/gpt-5.4", provider: "cheaperinference" };

test("an authorized model offered by the live owner picker is accepted without substitution", async () => {
  assert.equal(await resolveChatModelInfo(dynamic.id, fixed, async () => [dynamic]), dynamic);
});

test("ordinary models need no catalog and unknown/unauthorized IDs remain rejected", async () => {
  let loads = 0;
  const load = async () => { loads++; return [dynamic]; };
  assert.equal(await resolveChatModelInfo("gpt-5.4", fixed, load), fixed[0]);
  assert.equal(await resolveChatModelInfo(dynamic.id, fixed), undefined);
  assert.equal(await resolveChatModelInfo("other/unregistered", fixed, load), undefined);
  assert.equal(loads, 0);
  assert.equal(await resolveChatModelInfo("cheaperinference/absent", fixed, load), undefined);
  assert.equal(await resolveChatModelInfo(dynamic.id, fixed, async () => [{ ...dynamic, provider: "replit" }]), undefined);
});
