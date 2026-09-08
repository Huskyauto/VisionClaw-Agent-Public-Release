import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRecentUserRoutingContext,
  getLatestUserRoutingMessage,
  getMandatoryContextTools,
} from "../../server/lib/tool-routing-context";
import { routeTools } from "../../server/tool-router";

test("CMMC follow-ups keep the SAM discovery tool callable", () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "Build the CMMC contractor roster from SAM.gov for Illinois and Wisconsin." },
    { role: "assistant", content: "I found the capability but have not produced the roster." },
    { role: "user", content: "Continue after the .gov API addition." },
  ]);

  assert.match(context, /cmmc/i);
  assert.match(context, /continue after the \.gov api addition/i);
  assert.equal(
    getLatestUserRoutingMessage([
      { role: "user", content: "Build the CMMC contractor roster." },
      { role: "assistant", content: "I found the capability." },
      { role: "user", content: "Continue after the .gov API addition." },
    ]),
    "continue after the .gov api addition.",
  );
  assert.deepEqual(getMandatoryContextTools(context), ["discover_cmmc_prospects"]);
});

test("unrelated follow-ups do not surface the CMMC discovery tool", () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "Draft a newsletter about product updates." },
    { role: "assistant", content: "What audience should it target?" },
    { role: "user", content: "Use our existing customer audience." },
  ]);

  assert.deepEqual(getMandatoryContextTools(context), []);
});

test("a person named Sam does not activate the CMMC authoritative-source lock", () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "Ask Sam to browse the design examples." },
  ]);
  assert.deepEqual(getMandatoryContextTools(context), []);
});

test("a hyphenated CAGE-code request activates the authoritative-source lock", () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "Find verified Illinois companies with a CAGE-code." },
  ]);
  assert.deepEqual(getMandatoryContextTools(context), ["discover_cmmc_prospects"]);
});

test("a named-company CAGE request selects the direct SAM lookup instead of roster discovery", async () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "What is the CAGE code for Acme Defense, Inc. in SAM.gov?" },
  ]);
  assert.deepEqual(getMandatoryContextTools(context), ["lookup_sam_exact_company"]);

  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const routed = await routeTools(
    [
      "discover_cmmc_prospects", "lookup_sam_company_cage", "lookup_sam_exact_company", "browser",
      "web_search", "web_fetch", "deep_research", "delegate_task",
      "read_file", "write_file",
    ].map(definition),
    [{ role: "user", content: "What is the CAGE code for Acme Defense, Inc. in SAM.gov?" }],
    { maxTools: 40 },
  );
  const names = routed.tools.map((tool) => tool.function.name);
  assert.ok(names.includes("lookup_sam_exact_company"));
  assert.ok(!names.includes("lookup_sam_company_cage"));
  assert.ok(!names.includes("discover_cmmc_prospects"));
  assert.ok(!names.includes("browser"));
  assert.ok(!names.includes("web_search"));
});

test("a tier-group company verification request selects the paced SAM batch lookup", async () => {
  const context = buildRecentUserRoutingContext([
    { role: "user", content: "Look up every company in the Tier 1 group in SAM.gov and verify their CAGE and UEI." },
  ]);
  assert.deepEqual(getMandatoryContextTools(context), ["lookup_sam_company_cage"]);

  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const routed = await routeTools(
    [
      "discover_cmmc_prospects", "lookup_sam_company_cage", "lookup_sam_exact_company", "browser",
      "web_search", "web_fetch", "deep_research", "delegate_task",
      "read_file", "write_file",
    ].map(definition),
    [{ role: "user", content: "Look up every company in the Tier 1 group in SAM.gov and verify their CAGE and UEI." }],
    { maxTools: 40 },
  );
  const names = routed.tools.map((tool) => tool.function.name);
  assert.ok(names.includes("lookup_sam_company_cage"));
  assert.ok(!names.includes("lookup_sam_exact_company"));
  assert.ok(!names.includes("discover_cmmc_prospects"));
  assert.ok(!names.includes("browser"));
  assert.ok(!names.includes("web_search"));
});

test("supplied multi-company phrasing routes to batch lookup while unsupplied rosters route to discovery", () => {
  const batchRequests = [
    "Tier 1: Acme Defense, Beta Manufacturing. Look up their SAM.gov CAGEs.",
    "Look up Acme Defense and Beta Manufacturing in SAM.gov.",
    "Look up Acme Defense, Beta Manufacturing in SAM.gov.",
    "Verify Acme Defense, Beta Manufacturing in SAM.gov.",
    "Check Acme Defense, Beta Manufacturing against SAM.gov.",
    "Find Acme Defense, Beta Manufacturing in SAM.gov.",
    "Verify these companies in SAM.gov: Acme Defense; Beta Manufacturing.",
    "Companies: Acme Defense, Beta Manufacturing. Verify CAGEs in SAM.gov.",
    "Here is our roster: Acme Defense, Beta Manufacturing. Verify them against SAM.gov.",
    "Companies:\n- Acme Defense\n- Beta Manufacturing\nVerify them in SAM.gov.",
  ];
  for (const content of batchRequests) {
    const context = buildRecentUserRoutingContext([{ role: "user", content }]);
    assert.deepEqual(getMandatoryContextTools(context), ["lookup_sam_company_cage"], content);
  }

  const discoveryRequests = [
    "Build a CMMC roster of all companies in Illinois from SAM.gov.",
    "List all federal contractors in Ohio with CAGE codes.",
    "Create a Tier 1 roster of federal contractors in Ohio from SAM.gov.",
    "Verify all companies in Illinois against SAM.gov.",
    "Check every federal contractor in Ohio in SAM.gov.",
    "Check the roster of companies in Illinois against SAM.gov.",
  ];
  for (const content of discoveryRequests) {
    const context = buildRecentUserRoutingContext([{ role: "user", content }]);
    assert.deepEqual(getMandatoryContextTools(context), ["discover_cmmc_prospects"], content);
  }

  const singleContext = buildRecentUserRoutingContext([
    { role: "user", content: "Look up Acme Defense and its SAM.gov registration." },
  ]);
  assert.deepEqual(getMandatoryContextTools(singleContext), ["lookup_sam_exact_company"]);
  assert.deepEqual(
    getMandatoryContextTools(buildRecentUserRoutingContext([
      { role: "user", content: "Look up Acme Defense in SAM.gov." },
    ])),
    ["lookup_sam_exact_company"],
  );
  for (const content of [
    "Look up Acme, Inc. in SAM.gov.",
    "Look up Smith, Johnson & Co. in SAM.gov.",
  ]) {
    assert.deepEqual(
      getMandatoryContextTools(buildRecentUserRoutingContext([{ role: "user", content }])),
      ["lookup_sam_exact_company"],
      content,
    );
  }
});

test("mandatory SAM modes survive the production tool cap", async () => {
  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const filler = Array.from({ length: 40 }, (_, index) => `always_filler_${index}`);
  for (const [content, required] of [
    ["Look up Acme Defense in SAM.gov.", "lookup_sam_exact_company"],
    ["Companies: Acme Defense, Beta Manufacturing. Verify them in SAM.gov.", "lookup_sam_company_cage"],
    ["Build a CMMC roster of all companies in Illinois from SAM.gov.", "discover_cmmc_prospects"],
  ]) {
    const routed = await routeTools(
      [...filler, "lookup_sam_exact_company", "lookup_sam_company_cage", "discover_cmmc_prospects"].map(definition),
      [{ role: "user", content }],
      { maxTools: 25 },
    );
    assert.ok(routed.tools.some((tool) => tool.function.name === required), `${required}: ${content}`);
  }
});

test("mandatory SAM mode survives the persona continuation cap branch", async () => {
  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const routed = await routeTools(
    [
      "read_file", "write_file", "create_note", "search_memory",
      "lookup_sam_exact_company", "lookup_sam_company_cage", "discover_cmmc_prospects",
    ].map(definition),
    [
      { role: "user", content: "Build a CMMC roster of all companies in Illinois from SAM.gov." },
      { role: "assistant", content: "I can do that." },
      { role: "user", content: "go" },
    ],
    { maxTools: 25, personaRole: "Operations" },
  );
  assert.ok(routed.tools.some((tool) => tool.function.name === "discover_cmmc_prospects"));
});

test("CMMC rate-limit follow-ups suppress browser and stealth fallbacks", async () => {
  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const routed = await routeTools(
    [
      "discover_cmmc_prospects", "browser", "stealth_browse", "stealth_browse_camofox",
      "web_search", "web_fetch", "deep_research", "delegate_task",
      "read_file", "write_file", "create_note", "search_memory",
    ].map(definition),
    [{ role: "user", content: "The CMMC SAM.gov run hit 429. Complete the Illinois Wisconsin roster." }],
    { maxTools: 40 },
  );
  const names = routed.tools.map((tool) => tool.function.name);
  assert.ok(names.includes("discover_cmmc_prospects"));
  assert.ok(!names.includes("browser"));
  assert.ok(!names.includes("stealth_browse"));
  assert.ok(!names.includes("stealth_browse_camofox"));
  assert.ok(!names.includes("web_search"));
  assert.ok(!names.includes("web_fetch"));
  assert.ok(!names.includes("deep_research"));
  assert.ok(!names.includes("delegate_task"));
});

test("vague CMMC continuation still suppresses browser through router fallback", async () => {
  const definition = (name: string) => ({
    type: "function" as const,
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  });
  const routed = await routeTools(
    [
      "discover_cmmc_prospects", "browser", "stealth_browse", "stealth_browse_camofox",
      "web_search", "web_fetch", "deep_research", "delegate_task", "read_file", "write_file",
    ].map(definition),
    [
      { role: "user", content: "Build the CMMC Illinois Wisconsin report from SAM.gov." },
      { role: "assistant", content: "The upstream call was temporarily unavailable." },
      { role: "user", content: "Continue after the API addition." },
    ],
    { maxTools: 40 },
  );
  const names = routed.tools.map((tool) => tool.function.name);
  assert.ok(names.includes("discover_cmmc_prospects"));
  assert.ok(!names.includes("browser"));
  assert.ok(!names.includes("stealth_browse"));
  assert.ok(!names.includes("stealth_browse_camofox"));
  assert.ok(!names.includes("web_search"));
  assert.ok(!names.includes("web_fetch"));
  assert.ok(!names.includes("deep_research"));
  assert.ok(!names.includes("delegate_task"));
});