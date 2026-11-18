import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentReadyPackage } from "../../server/lib/agent-ready-package";
import { verifyAgentReadyInstallation } from "../../server/lib/agent-ready-verification";

const input = {
  company: "Example Heating",
  website: "https://example.com/",
  description: "Heating repair and maintenance for local homes.",
  businessType: "HVACBusiness",
  services: ["Furnace repair"],
  pageUrls: ["https://example.com/services"],
  confirmed: true,
};

test("confirmed business facts produce a website-only Poppy package without invented capabilities", () => {
  const result = buildAgentReadyPackage(input);
  const manifest = JSON.parse(result.files.find(f => f.path === ".well-known/poppy.json")!.content);
  assert.deepEqual(manifest, {
    protocol_version: "1.0",
    organization: { name: "Example Heating", domain: "example.com" },
    web: {},
  });
  assert.equal(result.packageId, buildAgentReadyPackage(input).packageId);
  assert.ok(result.files.some(f => f.path === "llms.txt"));
  assert.ok(result.files.some(f => f.path === "INSTALL.md"));
});

test("live comparison binds three installed public files to the exact package", async () => {
  const packet = buildAgentReadyPackage(input);
  const seen: string[] = [];
  const result = await verifyAgentReadyInstallation(packet, async url => {
    seen.push(url);
    const path = new URL(url).pathname;
    const file = path === "/" ? "structured-data.html" : path.slice(1);
    return {
      ok: true, status: 200, text: packet.files.find(f => f.path === file)!.content,
      finalUrl: url, contentType: path === "/" ? "text/html" : path.endsWith(".json") ? "application/json" : "text/plain",
    };
  });
  assert.equal(result.packageId, packet.packageId);
  assert.equal(seen.length, 3);
  assert.equal(result.checks.length, 3);
  assert.ok(result.checks.every(check => check.status === "pass"));
});

test("exports reject unconfirmed, private, credential-bearing and cross-domain inputs", () => {
  for (const bad of [
    { confirmed: false }, { company: "" }, { services: [] }, { services: Array(13).fill("Repair") },
    { website: "http://example.com" }, { website: "https://127.0.0.1" },
    { website: "https://[::1]/" }, { website: "https://2130706433" },
    { website: "https://localhost/" }, { website: "https://thing.internal" },
    { website: "https://user:secret@example.com" }, { website: "https://example.com/?token=private" },
    { website: "https://example.com/#secret" }, { website: "https://example.com:1234" },
    { website: "not a url" }, { website: "https://example.com/path" },
    { pageUrls: ["https://other.example.com/page"] }, { pageUrls: ["https://example.com/?key=secret"] },
    { filePath: "../../private" }, { tenantId: 2 }, { company: "Bad\u0000Name" },
  ]) assert.throws(() => buildAgentReadyPackage({ ...input, ...bad }), undefined, JSON.stringify(bad));
});

test("supplied HTML remains JSON data and cannot terminate the structured-data script", () => {
  const value = '</script><script>alert("not executable")</script>';
  const packet = buildAgentReadyPackage({ ...input, description: value });
  const html = packet.files.find(file => file.path === "structured-data.html")!.content;
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.match(html, /\\u003c/);
  const body = html.slice(html.indexOf("\n") + 1, html.lastIndexOf("</script>"));
  assert.equal(JSON.parse(body).description, value);
  const validation = JSON.parse(packet.files.find(file => file.path === "validation.json")!.content);
  assert.equal(validation.liveInstallation, "not_checked");
  assert.notEqual(packet.packageId, buildAgentReadyPackage(input).packageId);
});

test("exported facts include only supplied details and never replace robots.txt", () => {
  const packet = buildAgentReadyPackage({ ...input, serviceArea: "Madison", phone: "+1 608 555 0142", email: "hello@example.com" });
  const schema = JSON.parse(packet.files.find(file => file.path === "structured-data.jsonld")!.content);
  assert.equal(schema.areaServed, "Madison");
  assert.equal(schema.email, "hello@example.com");
  assert.equal(schema.address, undefined);
  assert.equal(schema.openingHours, undefined);
  assert.equal(schema.aggregateRating, undefined);
  assert.ok(!packet.files.some(file => file.path === "robots.txt"));
  assert.ok(packet.files.every(file => !file.path.includes("..") && !file.path.startsWith("/")));
  assert.doesNotMatch(JSON.stringify(packet.files.filter(file => file.path !== "INSTALL.md")), /agenticcorporation\.net|[Your Company]/);
});

test("failed, redirected, truncated and malformed live responses never receive a pass", async () => {
  const packet = buildAgentReadyPackage(input);
  for (const response of [
    { ok: false as const, reason: "HTTP 404" },
    { ok: false as const, reason: "upstream private error with credentials must not appear" },
    { ok: true as const, text: "{}", finalUrl: "https://elsewhere.com/", contentType: "application/json" },
    { ok: true as const, text: "{}", finalUrl: "https://example.com/", contentType: "text/plain", truncated: true },
  ]) {
    const result = await verifyAgentReadyInstallation(packet, async () => response);
    assert.ok(result.checks.every(check => check.status !== "pass"));
    assert.doesNotMatch(JSON.stringify(result), /credentials must not appear/);
  }
  const malformed = await verifyAgentReadyInstallation(packet, async url => ({
    ok: true, text: "{not JSON", finalUrl: url,
    contentType: url.endsWith(".json") ? "application/json" : url.endsWith("txt") ? "text/plain" : "text/html",
  }));
  assert.ok(malformed.checks.every(check => check.status === "fail"));
  const thrown = await verifyAgentReadyInstallation(packet, async () => { throw new Error("secret"); });
  assert.ok(thrown.checks.every(check => check.status === "unknown"));
  assert.doesNotMatch(JSON.stringify(thrown), /secret/);
});
