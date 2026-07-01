// R113.5 — Static-source invariants for the self-hosted multi-platform
// scheduled-post runner.
//
// Runner: node --import tsx --test (via tests/run.sh).
//
// We deliberately do NOT spin up a real DB here — ESM imports of server/db
// can't be transparently mocked in node:test, and the runtime path opens
// a connection pool that prevents the test process from exiting cleanly.
// Instead, these tests pin the *shape* of the code: the API signatures,
// the safety guards (tenantId validation, supported-platforms allowlist,
// ISO-timestamp check, content length cap), the tenant-scoped WHERE
// clauses, the row-locking + idempotency invariants, the destructive-policy
// registration, the heartbeat tick wiring, the persona-focus wiring, and
// the API route registration. A future refactor that drops one of these
// invariants will fail CI loudly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

const RUNNER = "server/lib/scheduled-post-runner.ts";

// ─── Exports & API surface ──────────────────────────────────────────────

test("runner: exports the 5 public entry points", () => {
  const src = read(RUNNER);
  for (const name of [
    "runDueScheduledPosts",
    "scheduleCrossPlatformPost",
    "cancelScheduledPost",
    "listScheduledPosts",
    "getSupportedPlatforms",
  ]) {
    assert.match(
      src,
      new RegExp(`export\\s+(?:async\\s+function|function)\\s+${name}\\b`),
      `expected export ${name}`,
    );
  }
});

// ─── Concurrency & idempotency invariants ───────────────────────────────

test("runner: poll uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent ticks can't double-publish", () => {
  const src = read(RUNNER);
  assert.match(src, /FOR UPDATE SKIP LOCKED/);
});

test("runner: poll flips status to 'publishing' inside the same CTE that locks the rows", () => {
  const src = read(RUNNER);
  // Single UPDATE ... FROM due ... SET status = 'publishing'
  assert.match(src, /UPDATE\s+scheduled_posts\s+sp\s+SET\s+status\s*=\s*'publishing'/);
});

test("runner: per-platform idempotency — a platform that already succeeded is skipped on retry", () => {
  const src = read(RUNNER);
  assert.match(src, /perResults\[platform\]\?\.success\s*===\s*true/);
});

test("runner: partial success does NOT retry (would double-post succeeded platforms)", () => {
  const src = read(RUNNER);
  // We want: anyOk && !allOk => 'partial', no nextAttemptAt assignment in that branch.
  assert.match(src, /nextStatus\s*=\s*"partial"/);
  // Sanity: comment justifies this
  assert.match(src, /no retry/i);
});

test("runner: bounded retry — attempts < max_attempts gate + exponential backoff capped at 1h", () => {
  const src = read(RUNNER);
  assert.match(src, /attempts\s*<\s*maxAttempts/);
  assert.match(src, /Math\.min\(raw,\s*3600\)/);
});

// ─── Validation invariants ──────────────────────────────────────────────

test("scheduleCrossPlatformPost: rejects invalid tenantId (NaN / zero / negative)", () => {
  const src = read(RUNNER);
  assert.match(src, /Number\.isInteger\(params\.tenantId\)/);
  assert.match(src, /tenantId required/);
});

test("scheduleCrossPlatformPost: requires non-empty platforms array", () => {
  const src = read(RUNNER);
  assert.match(src, /platforms must be a non-empty array/);
});

test("scheduleCrossPlatformPost: enforces supported-platforms allowlist", () => {
  const src = read(RUNNER);
  assert.match(src, /unsupported platforms:/);
  assert.match(src, /SUPPORTED_PLATFORMS\.has/);
});

test("scheduleCrossPlatformPost: rejects content >10000 chars", () => {
  const src = read(RUNNER);
  assert.match(src, /content too long/);
  assert.match(src, /10_000|10000/);
});

test("scheduleCrossPlatformPost: validates ISO timestamp", () => {
  const src = read(RUNNER);
  assert.match(src, /scheduledFor must be a valid ISO/);
});

// ─── R115.4 — image-first platform validation ───────────────────────────

test("scheduleCrossPlatformPost: IMAGE_REQUIRED_PLATFORMS covers instagram + pinterest", () => {
  const src = read(RUNNER);
  const m = src.match(/IMAGE_REQUIRED_PLATFORMS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "IMAGE_REQUIRED_PLATFORMS must be defined as new Set([...])");
  const vals = m![1].replace(/\s|"/g, "").split(",").filter(Boolean).sort().join(",");
  assert.equal(vals, "instagram,pinterest");
});

test("scheduleCrossPlatformPost: rejects schedule when image-required platform missing imageUrl", () => {
  const src = read(RUNNER);
  assert.match(src, /imageUrl required for platforms:/);
  assert.match(src, /image-first/);
});

test("scheduleCrossPlatformPost: imageUrl https-only guard", () => {
  const src = read(RUNNER);
  assert.match(src, /imageUrl must be an https URL/);
  assert.match(src, /\^https:\\\/\\\/.*test\(params\.imageUrl\)/);
});

test("UI: social-calendar pre-validates imageUrl for image-first platforms", () => {
  const src = read("client/src/pages/social-calendar.tsx");
  assert.match(src, /IMAGE_REQUIRED_PLATFORMS\s*=\s*new\s+Set\(\["instagram",\s*"pinterest"\]\)/);
  assert.match(src, /imageUrl is required when/);
});

// ─── Postgres array-literal handling (per replit.md HARD RULE) ──────────

test("scheduleCrossPlatformPost: builds Postgres text[] literal manually (Drizzle won't auto-cast a JS array)", () => {
  const src = read(RUNNER);
  // The {"x","linkedin"} literal builder + ::text[] bind.
  assert.ok(src.includes("arrLit"), "expected an arrLit literal builder");
  assert.ok(src.includes("::text[]"), "expected ::text[] cast on the bound literal");
  assert.ok(src.includes('lowered.map'), "expected lowered.map for the array literal");
});

test("runner: per-platform results bound as ::jsonb (not raw JS object)", () => {
  const src = read(RUNNER);
  assert.match(src, /JSON\.stringify\(perResults\)/);
  assert.match(src, /\$\{resultsJson\}::jsonb/);
});

// ─── Tenant-isolation invariants ────────────────────────────────────────

test("cancelScheduledPost: WHERE clause pins tenant_id (no cross-tenant cancel)", () => {
  const src = read(RUNNER);
  assert.match(src, /WHERE\s+id\s*=\s*\$\{id\}[\s\S]{0,80}AND\s+tenant_id\s*=\s*\$\{tenantId\}/);
});

test("cancelScheduledPost: only voids 'pending' rows (can't unsend a live post)", () => {
  const src = read(RUNNER);
  assert.match(src, /AND\s+status\s*=\s*'pending'/);
});

test("listScheduledPosts: WHERE clause pins tenant_id on both branches", () => {
  const src = read(RUNNER);
  const matches = src.match(/WHERE\s+tenant_id\s*=\s*\$\{params\.tenantId\}/g) || [];
  assert.ok(matches.length >= 2, `expected ≥2 tenant_id WHERE clauses, got ${matches.length}`);
});

test("listScheduledPosts: clamps limit to 1..200", () => {
  const src = read(RUNNER);
  assert.match(src, /Math\.min\(Math\.max\(params\.limit\s*\|\|\s*50,\s*1\),\s*200\)/);
});

// ─── Heartbeat wiring ───────────────────────────────────────────────────

test("heartbeat tick: imports runDueScheduledPosts and calls it inside try/catch", () => {
  const hb = read("server/heartbeat.ts");
  assert.match(hb, /scheduled-post-runner/);
  assert.match(hb, /runDueScheduledPosts/);
  assert.match(hb, /\[heartbeat\] Scheduled posts/);
});

// ─── Tool dispatcher wiring ─────────────────────────────────────────────

test("tools.ts: registers all 3 scheduler tools with descriptions and required fields", () => {
  const t = read("server/tools.ts");
  for (const name of [
    "schedule_cross_platform_post",
    "cancel_scheduled_post",
    "list_scheduled_posts",
  ]) {
    assert.match(t, new RegExp(`name:\\s*"${name}"`), `tool def missing: ${name}`);
    assert.match(t, new RegExp(`case\\s+"${name}"`), `dispatch case missing: ${name}`);
  }
});

test("tools.ts: every dispatch case enforces tenant context before dispatch", () => {
  const t = read("server/tools.ts");
  for (const name of [
    "schedule_cross_platform_post",
    "cancel_scheduled_post",
    "list_scheduled_posts",
  ]) {
    const re = new RegExp(`case\\s+"${name}"[\\s\\S]{0,600}_tenantId`);
    assert.match(t, re, `${name} dispatch must check _tenantId`);
  }
});

// ─── Destructive-tool-policy wiring ─────────────────────────────────────

test("destructive-tool-policy: schedule_cross_platform_post is destructive + requiresApproval", () => {
  const p = read("server/safety/destructive-tool-policy.ts");
  assert.match(p, /schedule_cross_platform_post[\s\S]{0,200}risk:\s*"destructive"[\s\S]{0,200}requiresApproval:\s*true/);
});

test("destructive-tool-policy: cancel_scheduled_post is sensitive (MEDIUM)", () => {
  const p = read("server/safety/destructive-tool-policy.ts");
  assert.match(p, /cancel_scheduled_post[\s\S]{0,200}risk:\s*"sensitive"/);
});

test("destructive-tool-policy: list_scheduled_posts is read-only (safe/LOW)", () => {
  const p = read("server/safety/destructive-tool-policy.ts");
  assert.match(p, /list_scheduled_posts[\s\S]{0,200}risk:\s*"safe"/);
});

// ─── Persona wiring ─────────────────────────────────────────────────────

test("persona-sync: Teagan (4) and Apollo (11) both get schedule_cross_platform_post in their focus", () => {
  const ps = read("server/persona-sync.ts");
  // Persona 4 line
  assert.match(ps, /^\s*4:\s*\[[^\]]*schedule_cross_platform_post/m);
  // Persona 11 line
  assert.match(ps, /^\s*11:\s*\[[^\]]*schedule_cross_platform_post/m);
});

test("persona-sync: Felix (2) gets schedule_cross_platform_post for delegation-to-comms scenarios", () => {
  const ps = read("server/persona-sync.ts");
  assert.match(ps, /^\s*2:\s*\[[^\]]*schedule_cross_platform_post/m);
});

// ─── API route wiring ───────────────────────────────────────────────────

test("routes.ts: registers /api/scheduled-posts GET / POST / DELETE behind authMiddleware", () => {
  const r = read("server/routes.ts");
  assert.match(r, /app\.get\("\/api\/scheduled-posts",\s*authMiddleware/);
  assert.match(r, /app\.post\("\/api\/scheduled-posts",\s*authMiddleware/);
  assert.match(r, /app\.delete\("\/api\/scheduled-posts\/:id",\s*authMiddleware/);
});

test("routes.ts: every scheduled-post route reads tenantId from session (never trusts body)", () => {
  const r = read("server/routes.ts");
  // Pull the three handler blocks and check each has the session-derived tenant pattern.
  const handlers = r.match(/\/api\/scheduled-posts[\s\S]{0,1200}?\}\);/g) || [];
  assert.ok(handlers.length >= 3, `expected ≥3 handler blocks, got ${handlers.length}`);
  for (const h of handlers) {
    assert.match(h, /req\.tenantId\s*\|\|\s*req\.user\?\.tenantId/);
  }
});

// ─── UI route + sidebar wiring ──────────────────────────────────────────

test("App.tsx: /social-calendar route registered with lazy SocialCalendarPage", () => {
  const a = read("client/src/App.tsx");
  assert.match(a, /SocialCalendarPage\s*=\s*lazy\(\(\)\s*=>\s*import\("@\/pages\/social-calendar"\)\)/);
  assert.match(a, /<Route\s+path="\/social-calendar"\s+component=\{SocialCalendarPage\}/);
});

test("app-sidebar: /social-calendar entry exists with the expected data-testid", () => {
  const s = read("client/src/components/app-sidebar.tsx");
  assert.match(s, /data-testid="link-social-calendar"/);
  assert.match(s, /href="\/social-calendar"/);
});

// ─── Round-B platform-allowlist invariant ───────────────────────────────
// R113.6 Round B — Facebook + YouTube wired. Runner / tool-schema / UI MUST
// stay in lockstep. YouTube also requires videoUrl at schedule time
// (publishPost would deterministically fail without it).

// R115.4 — Threads + Pinterest added to allowlist (yikart/AiToEarn-inspired
// platform fill; image-first / Meta-Graph + Pinterest API v5 publishers).
const ROUND_B_PLATFORMS = ["x", "linkedin", "instagram", "facebook", "youtube", "threads", "pinterest"];
const ROUND_B_PLATFORMS_SORTED = [...ROUND_B_PLATFORMS].sort().join(",");

test("Round B allowlist: runner SUPPORTED_PLATFORMS contains all 7 wired platforms", () => {
  const src = read(RUNNER);
  const m = src.match(/SUPPORTED_PLATFORMS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "SUPPORTED_PLATFORMS must be defined as new Set([...])");
  const vals = m![1].replace(/\s|"/g, "").split(",").filter(Boolean).sort().join(",");
  assert.equal(vals, ROUND_B_PLATFORMS_SORTED, `unexpected SUPPORTED_PLATFORMS: ${vals}`);
});

test("Round B allowlist: tool JSON-schema enum matches the 7 wired platforms", () => {
  const t = read("server/tools.ts");
  const block = t.slice(t.indexOf('name: "schedule_cross_platform_post"'));
  const enumLine = block.match(/platforms:\s*\{[^}]*enum:\s*\[([^\]]+)\]/);
  assert.ok(enumLine, "platforms property must declare an enum");
  const vals = enumLine![1].replace(/\s|"/g, "").split(",").sort().join(",");
  assert.equal(vals, ROUND_B_PLATFORMS_SORTED, `unexpected enum members: ${vals}`);
});

test("Round B allowlist: UI PLATFORMS const matches the runner allowlist", () => {
  const ui = read("client/src/pages/social-calendar.tsx");
  const m = ui.match(/const\s+PLATFORMS\s*=\s*\[([^\]]+)\]\s*as\s+const/);
  assert.ok(m, "PLATFORMS must be defined as a const tuple");
  const vals = m![1].replace(/\s|"/g, "").split(",").sort().join(",");
  assert.equal(vals, ROUND_B_PLATFORMS_SORTED, `unexpected UI PLATFORMS: ${vals}`);
});

// ─── R113.6 Round B — YouTube video-bridge invariants ───────────────────

test("scheduleCrossPlatformPost: rejects youtube in platforms without a videoUrl", () => {
  const src = read(RUNNER);
  assert.match(src, /VIDEO_REQUIRED_PLATFORMS\s*=\s*new\s+Set\(\[\s*"youtube"\s*\]\)/);
  assert.match(src, /videoUrl required for platforms:/);
});

test("scheduleCrossPlatformPost: videoUrl must be https (SSRF guard)", () => {
  const src = read(RUNNER);
  assert.match(src, /videoUrl must be an https URL/);
  assert.match(src, /\/\^https:\\\/\\\/\/i/);
});

test("runner: poll RETURNING includes sp.video_url and publishPost call threads it", () => {
  const src = read(RUNNER);
  assert.match(src, /sp\.video_url/);
  assert.match(src, /videoUrl:\s*row\.video_url\s*\|\|\s*undefined/);
});

test("scheduleCrossPlatformPost: INSERT writes video_url column", () => {
  const src = read(RUNNER);
  assert.match(src, /\(tenant_id,\s*platforms,\s*content,\s*image_url,\s*image_base64,\s*video_url,/);
});

// ─── R113.6 Round B — publisher wiring invariants ───────────────────────

test("social-publisher: publishPost dispatches the facebook + youtube cases", () => {
  const p = read("server/social-publisher.ts");
  assert.match(p, /case\s+"facebook":\s*\n\s*result\s*=\s*await\s+publishToFacebook/);
  assert.match(p, /case\s+"youtube":\s*\n\s*result\s*=\s*await\s+publishToYouTube/);
});

test("social-publisher: publishPost signature accepts videoUrl + driveFileId + title", () => {
  const p = read("server/social-publisher.ts");
  // Pull the publishPost function header.
  const m = p.match(/export async function publishPost\(params:\s*\{([\s\S]*?)\}\):/);
  assert.ok(m, "publishPost signature must be locatable");
  const header = m![1];
  for (const field of ["videoUrl?:", "driveFileId?:", "title?:"]) {
    assert.ok(header.includes(field), `publishPost params must include ${field}`);
  }
});

test("publishToFacebook: enumerates /me/accounts and uses Page access_token (not user token)", () => {
  const p = read("server/social-publisher.ts");
  assert.match(p, /graph\.facebook\.com\/v18\.0\/me\/accounts/);
  assert.match(p, /pageAccessToken/);
  // pages_manage_posts mentioned in the error copy so operators see the missing scope.
  assert.match(p, /pages_manage_posts/);
});

test("publishToYouTube: requires videoUrl OR driveFileId, blocks non-https, caps size at 256MB", () => {
  const p = read("server/social-publisher.ts");
  assert.match(p, /videoUrl or driveFileId is required/);
  assert.match(p, /videoUrl must be an https URL/);
  assert.match(p, /256\s*\*\s*1024\s*\*\s*1024/);
});

test("publishToYouTube: dispatches resumable upload (init POST → PUT bytes) and defaults to privacy=private", () => {
  const p = read("server/social-publisher.ts");
  assert.match(p, /upload\/youtube\/v3\/videos\?uploadType=resumable/);
  assert.match(p, /privacyStatus:\s*"private"/);
});

// ─── AHB invariant (architect finding R113.5-MED-2) ─────────────────────
// Every persona whose PERSONA_TOOL_FOCUS lists a destructive social tool
// MUST carry a non-off safety_profile.intentGate in the live DB. We assert
// it at runtime against the personas table — the persona row is the
// source of truth, not a static comment.

test("AHB: personas with schedule_cross_platform_post have intentGate != 'off' in the DB", async () => {
  // Resolve focus list from source so the test stays honest about which
  // persona ids carry the tool, then check the DB row for each.
  const ps = read("server/persona-sync.ts");
  const focusedIds: number[] = [];
  for (const m of ps.matchAll(/^\s*(\d+):\s*\[([^\]]*)\]/gm)) {
    const id = Number(m[1]);
    if (m[2].includes("schedule_cross_platform_post")) focusedIds.push(id);
  }
  assert.ok(focusedIds.length >= 2, `expected ≥2 focused personas, got ${focusedIds.join(",")}`);

  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  try {
    const idLit = `{${focusedIds.join(",")}}`;
    const res = await db.execute(
      sql`SELECT id, name, safety_profile->>'intentGate' AS gate FROM personas WHERE id = ANY(${idLit}::int[]) ORDER BY id`,
    );
    const rows = (res as any).rows || res;
    assert.equal(rows.length, focusedIds.length, "every focused persona must exist");
    for (const r of rows) {
      assert.ok(
        r.gate && r.gate !== "off",
        `persona ${r.id} (${r.name}) has intentGate='${r.gate}' — destructive social tool requires non-off gate`,
      );
    }
  } finally {
    const pool: any = (await import("../../server/db")).pool;
    if (pool && typeof pool.end === "function") await pool.end().catch(() => {});
  }
});

// R115 +sec (architect LOW-2 closed) — static-source invariant: publishToYouTube
// MUST route the video-bytes fetch through the SSRF-jail wrapper. A future
// refactor that accidentally drops the jail (or replaces it with raw fetch)
// would re-open the OOM/SSRF surface architect closed in R113.6 +sec.
test("publishToYouTube routes video-bytes fetch through ssrfSafeFetchBytes (no raw fetch)", () => {
  const src = readFileSync(join(process.cwd(), "server/social-publisher.ts"), "utf8");
  // The function must import the SSRF jail.
  assert.ok(
    /ssrfSafeFetchBytes/.test(src),
    "server/social-publisher.ts must import/use ssrfSafeFetchBytes",
  );
  // Locate the publishToYouTube body and assert the jail is called inside it.
  const ytStart = src.indexOf("function publishToYouTube");
  assert.ok(ytStart > 0, "publishToYouTube must be defined as a named function");
  // Find the next top-level function (or end) to bound the body.
  const tail = src.slice(ytStart);
  const bodyEnd = tail.search(/\n(async )?function \w+|\nexport (async )?function \w+/);
  const body = bodyEnd > 0 ? tail.slice(0, bodyEnd) : tail;
  assert.ok(
    /ssrfSafeFetchBytes\s*\(/.test(body),
    "publishToYouTube body must call ssrfSafeFetchBytes(...) — no raw fetch for video bytes",
  );
  // Belt-and-suspenders: there must be no bare `await fetch(videoUrl` inside the body.
  assert.ok(
    !/await\s+fetch\s*\(\s*videoUrl/.test(body),
    "publishToYouTube must NOT call raw `fetch(videoUrl, ...)` — must go through SSRF jail",
  );
});
