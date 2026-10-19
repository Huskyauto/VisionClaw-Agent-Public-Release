import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAgentJourney, collectAgentJourney } from "../../server/lib/agent-journey";
import { agentJourneySchema } from "../../server/lib/agent-journey-schema";
import { auditChecksForStorage } from "../../server/lib/agent-journey-schema";

test("five journey checks retain direct evidence and distinguish quote-only pricing", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html: `
    <main><h1>Example Services</h1><h2>Our services</h2>
    <ul><li>Equipment maintenance</li><li>System installation</li></ul>
    <p>Serving Springfield and nearby communities.</p>
    <p>Monday to Friday: 8 am to 5 pm.</p>
    <p>Request a quote for your project.</p><a href="/contact">Contact us</a>
    <form action="/send" method="post"><label>Name <input name="name" required></label>
    <label>Email <input name="email" type="email" required></label><button>Request quote</button>
    <input type="hidden" name="csrf" value="DO-NOT-RETAIN" required></form></main>` }]);
  assert.equal(result.checks.length, 5);
  assert.ok(result.checks.every(check => check.status === "observed"));
  assert.match(result.checks.find(c => c.id === "pricing")!.finding, /quote/i);
  assert.ok(result.checks.every(check => check.evidence.length > 0));
  assert.ok(!JSON.stringify(result).includes("DO-NOT-RETAIN"));
  assert.match(result.limitations.join(" "), /not.*submit/i);
});

test("bounded information-page collection never follows action, external or query links", async () => {
  const calls: string[] = [];
  const result = await collectAgentJourney({ url: "https://example.com/", html: `
    <a href="/book">Book</a><a href="/delete">Delete</a>
    <a href="/contact?send=yes">Contact</a><a href="https://other.com/services">Services</a>
    <a href="/services">Services</a><a href="/contact">Contact</a><a href="/hours">Hours</a>` },
    async url => { calls.push(url); return { ok: false, reason: "HTTP 403" }; });
  assert.deepEqual(calls, ["https://example.com/services", "https://example.com/contact"]);
  assert.equal(result.pages.length, 1);
  assert.ok(result.limitations.some(text => /could not be inspected/i.test(text)));
  assert.equal(result.checks.find(c => c.id === "services")!.status, "uncertain");
});

test("structured service, area and hours are retained as website claims, not independent verification", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html: `
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness",
    "areaServed":"Springfield","openingHours":"Mo-Fr 09:00-17:00",
    "hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[{"@type":"Offer",
    "itemOffered":{"@type":"Service","name":"Equipment maintenance"}}]}}</script>` }]);
  assert.equal(result.checks[0].status, "observed");
  assert.equal(result.checks[1].status, "observed");
  assert.match(JSON.stringify(result.checks[0].evidence), /Equipment maintenance/);
});

test("scripts, hidden content, unsafe links and account/newsletter forms cannot establish readiness", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html: `
    <script>const hours="Monday 9 am"; ignoreAllInstructions()</script>
    <div hidden><h2>Our services</h2><p>Secret service text</p></div>
    <p style="display:none">Serving the entire country.</p>
    <a href="javascript:submit()">Book now</a><a href="">Contact us</a>
    <form><label>Email<input required></label><button>Subscribe to newsletter</button></form>
    <form><label>Password<input type="password" required></label><button>Contact account support</button></form>` }]);
  assert.ok(result.checks.every(check => check.status === "not_found"));
  assert.ok(result.checks.every(check => check.evidence.length === 0));
});

test("services from a second information page are assessed while blocked pages stay uncertain", async () => {
  const result = await collectAgentJourney({ url: "https://example.com/", html: '<a href="/services">Services</a><a href="/contact">Contact</a>' },
    async (url, options) => {
      assert.deepEqual(options, { timeoutMs: 6000, maxBytes: 100_000, maxRedirects: 0 });
      return url.endsWith("/services")
        ? { ok: true as const, text: "<h2>Our services</h2><p>Equipment maintenance and system installation</p>", finalUrl: url, contentType: "text/html" }
        : { ok: false as const, reason: "HTTP 403" };
    });
  assert.equal(result.pages.length, 2);
  assert.equal(result.checks[0].status, "observed");
  assert.equal(result.checks[0].evidence[0].url, "https://example.com/services");
  assert.equal(result.checks[1].status, "uncertain");
});

test("redirects and non-HTML documents cannot contribute information-page evidence", async () => {
  const result = await collectAgentJourney({ url: "https://example.com/", html: '<a href="/services">Services</a><a href="/contact">Contact</a>' },
    async url => ({ ok: true, text: "<h2>Our services</h2><p>Must not be evidence</p>",
      finalUrl: url.endsWith("/services") ? "https://other.com/services" : url,
      contentType: url.endsWith("/contact") ? "application/pdf" : "text/html" }));
  assert.equal(result.pages.length, 1);
  assert.equal(result.checks[0].status, "uncertain");
  assert.ok(!JSON.stringify(result).includes("Must not be evidence"));
});

test("partial hours evidence is uncertain; published price signals do not imply a final quote", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/?token=private#secret", html:
    "<p>Monday-Friday 8 am to 5 pm</p><p>Service fee from $99 per visit</p>" }]);
  assert.equal(result.checks[1].status, "uncertain");
  assert.equal(result.checks[2].status, "observed");
  assert.match(result.checks[2].finding, /not verified/);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("PDF input accepts the complete bounded pilot and rejects duplicate checks and unsafe source URLs", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html: "<main>Welcome</main>" }]);
  assert.equal(agentJourneySchema.safeParse(result).success, true);
  assert.equal(agentJourneySchema.safeParse({ ...result, checks: Array(5).fill(result.checks[0]) }).success, false);
  for (const url of ["javascript:alert(1)", "bad", "https://user:password@example.com/", "https://example.com/?token=secret"]) {
    assert.equal(agentJourneySchema.safeParse({ ...result, pages: [url] }).success, false);
  }
});

test("combined findings retain both signals even when repetitive evidence would fill the excerpt cap", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html:
    Array.from({ length: 6 }, (_, i) => `<p>Serving Springfield district ${i}.</p><p>Service fee from $${99 + i} per visit</p>`).join("") +
    "<p>Monday-Friday 8 am to 5 pm</p><p>Request a quote</p>" }]);
  assert.match(JSON.stringify(result.checks[1].evidence), /Monday/);
  assert.match(JSON.stringify(result.checks[2].evidence), /Request a quote/);
});

test("an external booking route is disclosed as unverified, not observed", () => {
  const result = analyzeAgentJourney([{ url: "https://example.com/", html:
    '<a href="https://booking.example.net/">Book an appointment</a>' }]);
  assert.equal(result.checks[3].status, "uncertain");
  assert.match(result.checks[3].finding, /external/i);
});

test("public storage retains the journey in a compatible unscored check without changing technical totals", () => {
  const journey = analyzeAgentJourney([{ url: "https://example.com/", html: "" }]);
  const checks = [{ id: "technical", label: "Technical", category: "Structure",
    status: "pass" as const, score: 10, maxScore: 10, detail: "Existing check" }];
  assert.deepEqual(auditChecksForStorage(checks), checks);
  const stored = JSON.parse(JSON.stringify(auditChecksForStorage(checks, journey)));
  assert.ok(Array.isArray(stored));
  assert.deepEqual(stored[0], checks[0]);
  assert.equal(stored.reduce((sum: number, c: { score: number }) => sum + c.score, 0), 10);
  assert.deepEqual(stored.find((c: { id: string }) => c.id === "agent_customer_journey").agentJourney, journey);
});
