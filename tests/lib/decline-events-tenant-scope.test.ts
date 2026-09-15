import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("server/lib/decline-events.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("caller-supplied persona is validated against the tenant mapping before insert", () => {
  const check = src.indexOf("SELECT id FROM tenant_persona_names");
  const insert = src.indexOf("INSERT INTO decline_events");
  assert.ok(check >= 0 && check < insert);
  assert.match(
    src.slice(check, insert),
    /WHERE tenant_id = \$\{opts\.tenantId\} AND persona_id = \$\{opts\.personaId\}/,
  );
});

test("caller-supplied conversation is validated against its tenant before insert", () => {
  const check = src.indexOf("SELECT id FROM conversations");
  const insert = src.indexOf("INSERT INTO decline_events");
  assert.ok(check >= 0 && check < insert);
  assert.match(
    src.slice(check, insert),
    /WHERE tenant_id = \$\{opts\.tenantId\} AND id = \$\{opts\.conversationId\}/,
  );
});

test("missing ownership fails closed before decline event insertion", () => {
  assert.match(src, /persona\.rows \?\? persona[\s\S]*length === 0[\s\S]*return \{ ok: false/);
  assert.match(src, /conversation\.rows \?\? conversation[\s\S]*length === 0[\s\S]*return \{ ok: false/);
});