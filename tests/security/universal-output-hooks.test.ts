import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync("server/tools.ts","utf8");
test("URL-only auto-email is not invoked in either lane; instant-play requires checked snapshot",()=>{
  assert.equal((source.match(/void maybeAutoDeliverByEmail\(/g)||[]).length,0);
  assert.match(source,/shouldPublishLocalProductOutput\(params\) && postflight\.report\.status === "checked"/);
  assert.ok(source.indexOf("postflightToolOutput(name, finalResult")<source.indexOf("finalResult = await attachInstantPlayUrls"));
  assert.match(source,/attachInstantPlayUrls\(name, finalResult, params, getVerifiedToolSnapshot\(outputAuthority\)\)/);
});
test("artifact identities are recorded only after intent transaction commits",()=>{
  const durable=fs.readFileSync("server/durable-artifacts.ts","utf8");
  assert.match(durable,/const committed = await db\.transaction/);
  assert.match(durable,/recordCommittedToolArtifact\(committed\);\s*return committed;/);
});
