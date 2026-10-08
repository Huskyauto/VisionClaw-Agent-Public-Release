/**
 * Derived API capture safety — value-free body projection.
 *
 * The HIGH finding this pins: key-based redaction cannot catch credentials/PII
 * in neutral fields ({"data":"<bearer>"}). projectBodyShape must therefore
 * never retain ANY captured value — only key names and type names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectBodyShape, redactUrl } from "../../server/lib/derived-api";

const SECRET = "eyJhbGciOiJIUzI1NiJ9.SECRETPAYLOAD.abc123signature";

test("JSON body: credential in a NEUTRAL field never survives projection", () => {
  const out = projectBodyShape(JSON.stringify({ data: SECRET, user: { email: "bob@example.com" } }));
  assert.ok(out);
  assert.ok(!out!.includes(SECRET), "secret value leaked");
  assert.ok(!out!.includes("bob@example.com"), "PII value leaked");
  const parsed = JSON.parse(out!);
  assert.equal(parsed.data, "string");
  assert.equal(parsed.user.email, "string");
});

test("JSON arrays: skeleton keeps shape + count, drops every value", () => {
  const out = projectBodyShape(JSON.stringify([{ id: 7, token: SECRET }, { id: 8 }, { id: 9 }]));
  assert.ok(out && !out.includes(SECRET) && !out.includes("7"));
  const parsed = JSON.parse(out!);
  assert.equal(parsed[0].id, "number");
  assert.equal(parsed[1], "…x3");
});

test("form-encoded body: keys only, values dropped", () => {
  const out = projectBodyShape(`q=hello&session=${SECRET}`, "application/x-www-form-urlencoded");
  assert.equal(out, "q=<value>&session=<value>");
});

test("unstructured bodies (HTML/plain text) are dropped entirely", () => {
  assert.equal(projectBodyShape(`<html>token: ${SECRET}</html>`, "text/html"), undefined);
  assert.equal(projectBodyShape(`my api key is ${SECRET}`, "text/plain"), undefined);
});

test("malformed JSON falls through to drop, never raw retention", () => {
  const out = projectBodyShape(`{"data": "${SECRET}"`, "application/json"); // truncated JSON
  assert.ok(!out || !out.includes(SECRET), "malformed JSON leaked raw value");
});

test("empty/undefined bodies stay undefined", () => {
  assert.equal(projectBodyShape(undefined), undefined);
  assert.equal(projectBodyShape(""), undefined);
});

test("redactUrl strips userinfo and EVERY query value (neutral keys included)", () => {
  const out = redactUrl(`https://user:pass@api.example.com/v1?apikey=${SECRET}&page=2`);
  assert.ok(!out.includes("pass") && !out.includes(SECRET));
  assert.ok(out.includes("page={value}"), "query key names preserved as placeholders");
  assert.ok(!out.includes("page=2"), "raw query values must not survive");
});

test("redactUrl: JWT/PII in NEUTRAL query params never survives", () => {
  const out = redactUrl(`https://api.example.com/search?data=${SECRET}&email=bob%40example.com`);
  assert.ok(!out.includes(SECRET) && !out.includes("bob%40example.com") && !out.includes("bob@example.com"));
  assert.ok(out.includes("data={value}") && out.includes("email={value}"));
});

test("redactUrl: unparseable input is dropped, never returned raw", () => {
  assert.equal(redactUrl(`not a url ${SECRET}`), "[unparseable-url-redacted]");
});

test("redactUrl: opaque tokens/emails in PATH segments never survive", () => {
  const out = redactUrl(`https://api.example.com/reset/${SECRET}/confirm`);
  assert.ok(!out.includes(SECRET), "path token leaked");
  assert.ok(out.includes("/reset/{value}/confirm"), "static route words preserved");
  const out2 = redactUrl("https://api.example.com/users/bob%40example.com/profile");
  assert.ok(!out2.includes("bob") && out2.includes("/users/{value}/profile"));
});

test("redactUrl: lowercase usernames and opaque lowercase tokens never survive", () => {
  const out = redactUrl("https://api.example.com/users/alice/profile");
  assert.ok(!out.includes("alice"), "lowercase username leaked");
  assert.ok(out.includes("/users/{value}/profile"));
  const out2 = redactUrl("https://api.example.com/reset/abcdefghijklmnopqrst");
  assert.ok(!out2.includes("abcdefghijklmnopqrst"), "lowercase opaque token leaked");
  const out3 = redactUrl("https://api.example.com/resource/abc123def456");
  assert.ok(!out3.includes("abc123def456"), "short opaque id leaked");
});

test("redactUrl: numeric ids, UUIDs, and fragments are projected out", () => {
  const out = redactUrl("https://api.example.com/v2/orders/123456/items/550e8400-e29b-41d4-a716-446655440000#frag");
  assert.ok(out.includes("/v2/orders/{value}/items/{value}"));
  assert.ok(!out.includes("123456") && !out.includes("550e8400") && !out.includes("#frag"));
});
