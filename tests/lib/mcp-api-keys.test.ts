// R113.7 Round C — Static-source invariants for the VCA MCP server +
// per-tenant MCP API keys.
//
// Runner: node --import tsx --test (via tests/run.sh).
//
// Matches the project pattern: we do NOT spin up a real DB here (server/db
// imports an active connection pool that blocks clean process exit in
// node:test). Instead these tests pin the *shape* of the Round C code:
// the key format + crypto contract, the bearer-auth path, the tenant
// resolution rule (key → tenant, never client-supplied), the curated
// 8-tool surface, the absence of money-movement / mass-comms tools in
// that surface, the TOOL_POLICIES registration of the destructive +
// sensitive entries, the CSRF-skip placement (under /mcp not /api),
// and the UI route registration.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ──────────────────────────────────────────────────────────────────────────
// Section 1 — Key crypto + storage contract.
// ──────────────────────────────────────────────────────────────────────────

test("mcp-api-keys: file exists with documented public API", () => {
  const src = read("server/lib/mcp-api-keys.ts");
  assert.ok(src.includes("export async function createApiKey"), "createApiKey export");
  assert.ok(src.includes("export async function listApiKeys"), "listApiKeys export");
  assert.ok(src.includes("export async function revokeApiKey"), "revokeApiKey export");
  assert.ok(src.includes("export async function verifyApiKey"), "verifyApiKey export");
});

test("mcp-api-keys: plaintext format is mcp_<8>_<32> with base64url chars", () => {
  const src = read("server/lib/mcp-api-keys.ts");
  // Key generator yields prefix(6 bytes→base64url→slice 8) + secret(24 bytes→base64url→slice 32).
  assert.ok(/randomBytes\(6\)\.toString\("base64url"\)\.slice\(0,\s*8\)/.test(src), "8-char prefix from base64url");
  assert.ok(/randomBytes\(24\)\.toString\("base64url"\)\.slice\(0,\s*32\)/.test(src), "32-char secret from base64url");
  assert.ok(src.includes('`mcp_${prefix}_${secret}`'), "plaintext shape mcp_<prefix>_<secret>");
  // Regex inside verifyApiKey must match exactly the generator format.
  assert.ok(/\/\^mcp_\(\[A-Za-z0-9_-\]\{8\}\)_\(\[A-Za-z0-9_-\]\{32\}\)\$\//.test(src), "verify regex matches generator");
});

test("mcp-api-keys: only sha256 hash is persisted — never plaintext", () => {
  const src = read("server/lib/mcp-api-keys.ts");
  assert.ok(src.includes('createHash("sha256").update(plaintext)'), "sha256 of plaintext computed");
  // INSERT writes key_hash, never plaintext.
  const insertMatch = src.match(/INSERT INTO mcp_api_keys[\s\S]*?RETURNING/);
  assert.ok(insertMatch, "INSERT statement present");
  assert.ok(insertMatch![0].includes("key_hash"), "INSERT writes key_hash");
  assert.ok(!insertMatch![0].includes("${plaintext}"), "INSERT must NOT bind plaintext");
});

test("mcp-api-keys: verifyApiKey uses constant-time comparison", () => {
  const src = read("server/lib/mcp-api-keys.ts");
  assert.ok(src.includes("timingSafeEqual"), "timingSafeEqual imported + used");
  // Must check revoked_at BEFORE returning success.
  const verifyBlock = src.match(/export async function verifyApiKey[\s\S]*?\n}\n/);
  assert.ok(verifyBlock, "verifyApiKey body present");
  assert.ok(verifyBlock![0].includes("revoked_at"), "verify checks revoked_at");
  assert.ok(/if\s*\(\s*row\.revoked_at\s*\)\s*return null/.test(verifyBlock![0]), "revoked → null");
});

test("mcp-api-keys: tenant_id INTEGER NOT NULL pinned in CREATE-via-comment", () => {
  // Schema added via psql (not shared/schema.ts) per project convention.
  // Pin the column shape via the lib's INSERT/SELECT statements that depend on it.
  const src = read("server/lib/mcp-api-keys.ts");
  assert.ok(/WHERE tenant_id = \$\{tenantId\}|WHERE tenant_id = \$\{T1\}/.test(src) || src.includes("tenant_id = ${"), "every read pins tenant_id");
  // listApiKeys MUST filter by tenant_id.
  const list = src.match(/export async function listApiKeys[\s\S]*?\n}\n/);
  assert.ok(list, "listApiKeys body present");
  assert.ok(list![0].includes("WHERE tenant_id ="), "listApiKeys filters by tenant_id");
  // revokeApiKey MUST scope by tenant_id (no cross-tenant revoke).
  const revoke = src.match(/export async function revokeApiKey[\s\S]*?\n}\n/);
  assert.ok(revoke![0].includes("AND tenant_id ="), "revokeApiKey AND tenant_id");
});

test("mcp-api-keys: scopes[] built as Postgres array literal (no raw JS array bind)", () => {
  // Per replit.md gotcha: text[] columns require {x,y}::text[] literal.
  const src = read("server/lib/mcp-api-keys.ts");
  assert.ok(src.includes("::text[]"), "scopes bound with ::text[] cast");
  assert.ok(src.includes("scopes.map((s) => `\"${s.replace"), "scopes literal escapes quotes");
});

// ──────────────────────────────────────────────────────────────────────────
// Section 2 — MCP server tool-surface allowlist + auth path.
// ──────────────────────────────────────────────────────────────────────────

test("mcp-server: file exists with the curated 8-tool surface", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes("export const MCP_TOOL_NAMES"), "MCP_TOOL_NAMES exported");
  const expected = [
    "schedule_cross_platform_post",
    "cancel_scheduled_post",
    "list_scheduled_posts",
    "get_scheduled_post",
    "list_personas",
    "lookup_output_skill",
    "list_output_skills",
    "get_platform_info",
  ];
  for (const t of expected) {
    assert.ok(src.includes(`"${t}"`), `${t} listed in MCP_TOOL_NAMES`);
    assert.ok(src.includes(`registerTool(\n    "${t}"`), `${t} registered with McpServer`);
  }
});

test("mcp-server: forbidden tools (money-movement / mass-comms) NOT in surface", () => {
  const src = read("server/routes/mcp-server.ts");
  // Allow these substrings to appear in comments/descriptions but NOT as registerTool names.
  const forbiddenToolCalls = [
    'registerTool(\n    "send_email"',
    'registerTool(\n    "send_sms"',
    'registerTool(\n    "create_invoice"',
    'registerTool(\n    "transfer_',
    'registerTool(\n    "wire_',
    'registerTool(\n    "payout',
    'registerTool(\n    "reveal_secret',
  ];
  for (const f of forbiddenToolCalls) {
    assert.ok(!src.includes(f), `${f.slice(20, -1)} must NOT be exposed via MCP`);
  }
});

test("mcp-server: bearer auth required and tenantId resolved from key (not header)", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes("/^Bearer\\s+(.+)$/i"), "Bearer scheme regex present");
  assert.ok(src.includes("await verifyApiKey"), "calls verifyApiKey on presented token");
  // tenantId MUST come from the verified key (auth.tenantId), not from req body/headers.
  assert.ok(src.includes("auth.tenantId"), "tenantId pulled from verified key");
  // Sanity: req.headers['x-tenant-id'] / req.body.tenantId must NEVER be read in the MCP handler.
  const mcpHandler = src.match(/app\.post\("\/mcp",[\s\S]*?\n  \}\);\n/);
  assert.ok(mcpHandler, "POST /mcp handler present");
  assert.ok(!/req\.body\.tenantId|req\.headers\["x-tenant-id"\]|req\.query\.tenantId/.test(mcpHandler![0]),
    "MCP handler must NOT read tenantId from client");
});

test("mcp-server: 401 on missing or invalid bearer", () => {
  const src = read("server/routes/mcp-server.ts");
  const mcpHandler = src.match(/app\.post\("\/mcp",[\s\S]*?\n  \}\);\n/);
  assert.ok(mcpHandler, "POST /mcp handler present");
  assert.ok(/res\.status\(401\)/.test(mcpHandler![0]), "401 returned for auth failure");
  assert.ok(mcpHandler![0].includes("Missing Bearer token") || mcpHandler![0].includes("Bearer"), "auth error message");
  assert.ok(mcpHandler![0].includes("Invalid or revoked MCP API key"), "revoked-key error message");
});

test("mcp-server: scope enforcement — every tool callsite calls hasScope() (Architect HIGH-1)", () => {
  const src = read("server/routes/mcp-server.ts");
  const buildBlock = src.match(/function buildMcpServer[\s\S]*?return server;\s*\n\}/);
  assert.ok(buildBlock, "buildMcpServer body present");
  const tools = [
    "schedule_cross_platform_post",
    "cancel_scheduled_post",
    "list_scheduled_posts",
    "get_scheduled_post",
    "list_personas",
    "lookup_output_skill",
    "list_output_skills",
    "get_platform_info",
  ];
  for (const t of tools) {
    assert.ok(
      buildBlock![0].includes(`TOOL_SCOPE_REQUIREMENTS.${t}`) &&
        buildBlock![0].includes(`denyForScope("${t}"`),
      `${t} must check hasScope() and call denyForScope() on miss`,
    );
  }
});

test("mcp-server: hasScope() fail-closed for empty scopes", async () => {
  const { hasScope } = await import("../../server/routes/mcp-server");
  assert.equal(hasScope([], "catalog:read"), false, "empty array → deny");
  assert.equal(hasScope([], "scheduler:write"), false, "empty array → deny destructive");
  assert.equal(hasScope(null as any, "catalog:read"), false, "null → deny");
  assert.equal(hasScope(undefined as any, "catalog:read"), false, "undefined → deny");
});

test("mcp-server: hasScope() exact match", async () => {
  const { hasScope } = await import("../../server/routes/mcp-server");
  assert.equal(hasScope(["catalog:read"], "catalog:read"), true);
  assert.equal(hasScope(["catalog:read"], "scheduler:write"), false, "catalog:read does NOT cover scheduler:write");
  assert.equal(hasScope(["scheduler:read"], "scheduler:write"), false, "scheduler:read does NOT cover scheduler:write");
});

test("mcp-server: hasScope() wildcard '*' grants everything", async () => {
  const { hasScope } = await import("../../server/routes/mcp-server");
  assert.equal(hasScope(["*"], "scheduler:write"), true);
  assert.equal(hasScope(["*"], "scheduler:read"), true);
  assert.equal(hasScope(["*"], "catalog:read"), true);
});

test("mcp-server: TOOL_SCOPE_REQUIREMENTS covers all 8 tools and only valid scopes", async () => {
  const mod = await import("../../server/routes/mcp-server");
  const required = mod.TOOL_SCOPE_REQUIREMENTS;
  const validScopes = new Set(Object.keys(mod.MCP_SCOPES));
  for (const tool of mod.MCP_TOOL_NAMES) {
    const scope = (required as any)[tool];
    assert.ok(scope, `${tool} has a scope requirement`);
    assert.ok(validScopes.has(scope), `${tool} scope '${scope}' is in MCP_SCOPES registry`);
  }
});

test("mcp-server: destructive tools require 'scheduler:write' specifically (not read scopes)", async () => {
  const mod = await import("../../server/routes/mcp-server");
  assert.equal(mod.TOOL_SCOPE_REQUIREMENTS.schedule_cross_platform_post, "scheduler:write");
  assert.equal(mod.TOOL_SCOPE_REQUIREMENTS.cancel_scheduled_post, "scheduler:write");
});

test("mcp-server: /api/mcp-keys CRUD rejects vc_* bearer auth (Architect MED-2)", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes("requireSessionAuth"), "requireSessionAuth helper present");
  assert.ok(/\/\^Bearer\\s\+vc_\/i/.test(src), "vc_ prefix rejected with 403");
  assert.ok(src.includes("vc_* API keys are not accepted"), "explicit rejection message");
  // All 3 CRUD routes go through requireSessionAuth.
  const crudBlock = src.match(/app\.post\("\/api\/mcp-keys"[\s\S]*?app\.delete\("\/api\/mcp-keys\/:id"[\s\S]*?\}\);/);
  assert.ok(crudBlock, "CRUD block present");
  const callCount = (crudBlock![0].match(/requireSessionAuth\(req, res\)/g) || []).length;
  assert.equal(callCount, 3, `expected 3 requireSessionAuth() calls (POST/GET/DELETE), got ${callCount}`);
});

test("mcp-server: unknown scopes rejected at creation", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes("Unknown scope(s):"), "unknown-scope error message");
  assert.ok(/const validScopes = new Set\(Object\.keys\(MCP_SCOPES\)\)/.test(src), "scopes validated against MCP_SCOPES");
});

test("mcp-server: default scope on empty input is 'catalog:read' (fail-closed)", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes('rawScopes.length > 0 ? rawScopes : ["catalog:read"]'), "default to catalog:read, NOT '*'");
  // Must NOT default to wildcard or scheduler:write.
  assert.ok(!src.includes('rawScopes.length > 0 ? rawScopes : ["*"]'), "must NOT default to wildcard");
  assert.ok(!src.includes('rawScopes.length > 0 ? rawScopes : ["scheduler:write"]'), "must NOT default to destructive");
});

test("mcp-server: each tool body uses auth.tenantId (no global / owner default)", () => {
  const src = read("server/routes/mcp-server.ts");
  // Count occurrences of auth.tenantId inside the build function — must be ≥ 4
  // (scheduler trio + list_scheduled_posts + get_scheduled_post all use it).
  const buildBlock = src.match(/function buildMcpServer[\s\S]*?\n}\n/);
  assert.ok(buildBlock, "buildMcpServer body present");
  const occurrences = (buildBlock![0].match(/auth\.tenantId/g) || []).length;
  assert.ok(occurrences >= 4, `expected ≥4 auth.tenantId uses, got ${occurrences}`);
});

test("mcp-server: stateless transport (no sessionIdGenerator)", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes("sessionIdGenerator: undefined"), "stateless Streamable HTTP transport");
});

test("mcp-server: cleanup on res close (no leak)", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes('res.on("close"'), "cleanup hook on res close");
  assert.ok(src.includes("transport.close()"), "transport closed");
  assert.ok(src.includes("server.close()"), "server closed");
});

// ──────────────────────────────────────────────────────────────────────────
// Section 3 — Health endpoint + admin CRUD routes.
// ──────────────────────────────────────────────────────────────────────────

test("mcp-server: unauthenticated /mcp/health endpoint exists", () => {
  const src = read("server/routes/mcp-server.ts");
  assert.ok(src.includes('app.get("/mcp/health"'), "/mcp/health route");
});

test("mcp-server: admin CRUD routes are tenant-scoped via session", () => {
  const src = read("server/routes/mcp-server.ts");
  for (const m of ['app.post("/api/mcp-keys"', 'app.get("/api/mcp-keys"', 'app.delete("/api/mcp-keys/:id"']) {
    assert.ok(src.includes(m), `${m} present`);
  }
  // tenantId pulled via getTenantFromRequest, NOT from req.body.tenantId.
  const crud = src.split('app.get("/mcp/health"')[1] || "";
  assert.ok(/getTenantFromRequest\(req\)/.test(crud), "CRUD pulls tenantId from session helper");
});

test("mcp-server: plaintext key returned only on POST create", () => {
  const src = read("server/routes/mcp-server.ts");
  // listApiKeys row shape does not include `plaintext` field.
  const lib = read("server/lib/mcp-api-keys.ts");
  const listRow = lib.match(/export interface McpApiKeyRow[\s\S]*?\n}/);
  assert.ok(listRow, "McpApiKeyRow shape present");
  assert.ok(!listRow![0].includes("plaintext"), "listed keys must NOT include plaintext");
  assert.ok(src.includes("will NOT be shown again"), "POST surfaces single-use warning");
});

// ──────────────────────────────────────────────────────────────────────────
// Section 4 — Routes mounted, UI wired, TOOL_POLICIES registered.
// ──────────────────────────────────────────────────────────────────────────

test("routes.ts mounts registerMcpServerRoutes after registerMcpRoutes (distinct)", () => {
  const src = read("server/routes.ts");
  assert.ok(src.includes('import { registerMcpServerRoutes } from "./routes/mcp-server"'), "import present");
  assert.ok(src.includes("registerMcpServerRoutes(app,"), "registration call present");
  // Distinct from the legacy MCP CLIENT routes — both must mount.
  assert.ok(src.includes("registerMcpRoutes(app,"), "legacy MCP client routes still mounted");
});

test("client App.tsx wires /mcp-keys page", () => {
  const src = read("client/src/App.tsx");
  assert.ok(src.includes('lazy(() => import("@/pages/mcp-keys"))'), "lazy import of mcp-keys page");
  assert.ok(src.includes('<Route path="/mcp-keys"'), "/mcp-keys route registered");
});

test("client UI page exists and uses CSRF-aware apiRequest", () => {
  assert.ok(existsSync(join(ROOT, "client/src/pages/mcp-keys.tsx")), "mcp-keys.tsx exists");
  const src = read("client/src/pages/mcp-keys.tsx");
  assert.ok(src.includes('apiRequest("POST", "/api/mcp-keys"'), "POST goes through apiRequest");
  assert.ok(src.includes('apiRequest("DELETE", `/api/mcp-keys/${'), "DELETE goes through apiRequest");
  // Plaintext appears at most once and explicitly marked "shown only once".
  assert.ok(src.includes("only time the plaintext will be visible") || src.includes("shown again"), "single-use warning copy");
});

test("sidebar exposes link-mcp-keys nav entry", () => {
  const src = read("client/src/components/app-sidebar.tsx");
  assert.ok(src.includes('data-testid="link-mcp-keys"'), "sidebar nav entry");
  assert.ok(src.includes('href="/mcp-keys"'), "sidebar href");
});

test("TOOL_POLICIES still registers the destructive + sensitive Round C tools", async () => {
  const { TOOL_POLICIES } = await import("../../server/safety/destructive-tool-policy");
  assert.ok(TOOL_POLICIES["schedule_cross_platform_post"], "schedule_cross_platform_post registered");
  assert.equal(TOOL_POLICIES["schedule_cross_platform_post"].risk, "destructive");
  assert.ok(TOOL_POLICIES["cancel_scheduled_post"], "cancel_scheduled_post registered");
  assert.ok(["sensitive", "destructive"].includes(TOOL_POLICIES["cancel_scheduled_post"].risk),
    "cancel_scheduled_post risk in {sensitive,destructive}");
});

test("MCP surface count == 8 (matches Round C contract)", () => {
  const src = read("server/routes/mcp-server.ts");
  const arr = src.match(/MCP_TOOL_NAMES = \[([\s\S]*?)\] as const/);
  assert.ok(arr, "MCP_TOOL_NAMES array present");
  const names = arr![1].match(/"[a-z_]+"/g) || [];
  assert.equal(names.length, 8, `expected 8 tools in MCP surface, got ${names.length}`);
});
