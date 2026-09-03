/**
 * tests/unit/repo-surgeon-audit-relax.test.ts
 *
 * Pins the SECURITY-CORE BOUNDARY for the audit-sourced autopilot (the nightly
 * tenant-isolation audit → jury → repo-surgeon auto-fix path):
 *
 *   - schema / auth / payments / safety fixes ALWAYS require owner HITL
 *   - tenant-isolation WHERE-clause / ownership-check fixes may auto-apply
 *
 * The path-only HARD_HITL_SURFACE_RE has a known blind spot: auth/payment/schema
 * logic embedded INSIDE a broad aggregator file (server/routes.ts, tools.ts,
 * chat-engine.ts) whose FILENAME doesn't match. proposalTouchesHardContent()
 * closes it by scanning the edit's own diff content. These tests prove a
 * payment/auth edit in a broad file is caught (→ HITL) while a pure
 * tenant-isolation fix in the SAME broad file is not (→ eligible for autopilot).
 *
 * Run: node --import tsx --test tests/unit/repo-surgeon-audit-relax.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isHardHitlSurface,
  proposalTouchesHardContent,
  isWithinPinnedScope,
  resolveHardZoneTouch,
  type FixProposal,
} from "../../server/agentic/repo-surgeon";

const baseProposal = (edits: { path: string; find: string; replace: string }[]): FixProposal => ({
  diagnosis: "d",
  rootCause: "r",
  precedent: "p",
  edits,
});

// ── resolveHardZoneTouch (HIGH-3 resolved-path hard-zone gate) ────────────────
// Authoritative, realpath-canonicalized classifier: any touch to a HARD path
// surface OR a SECURITY-CORE/CI surface forces HITL, symlink/alias-proof.
test("resolveHardZoneTouch: a real security-core file (the autopilot itself) is hard", () => {
  // Resolved against the real cwd — these files exist, so realpathSync succeeds.
  assert.equal(resolveHardZoneTouch(["server/agentic/repo-surgeon.ts"]).hard, true);
  assert.equal(resolveHardZoneTouch(["scripts/drain-jury-queue.ts"]).hard, true);
  assert.equal(resolveHardZoneTouch(["server/agentic/jury-queue-integrity.ts"]).hard, true);
});

test("resolveHardZoneTouch: a real hard path surface (schema) is hard", () => {
  assert.equal(resolveHardZoneTouch(["shared/schema.ts"]).hard, true);
});

test("resolveHardZoneTouch: a plain non-hard existing file is NOT hard", () => {
  assert.equal(resolveHardZoneTouch(["tsconfig.json"]).hard, false);
});

test("resolveHardZoneTouch: a SYMLINK aliasing a security-core file is still hard", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rhz-sym-"));
  try {
    fs.mkdirSync(path.join(root, "server", "agentic"), { recursive: true });
    const real = path.join(root, "server", "agentic", "repo-surgeon.ts");
    fs.writeFileSync(real, "// real");
    fs.symlinkSync(real, path.join(root, "innocent.ts"));
    // The textual path "innocent.ts" matches no rule; only realpath resolution catches it.
    const r = resolveHardZoneTouch(["innocent.ts"], root);
    assert.equal(r.hard, true, "symlink alias of a security-core file must resolve hard");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveHardZoneTouch: a NEW file under an existing CI dir is hard (ancestor realpath)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rhz-new-"));
  try {
    fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    // evil.yml does not exist yet → resolved via its existing ancestor dir.
    const r = resolveHardZoneTouch([".github/workflows/evil.yml"], root);
    assert.equal(r.hard, true, "a new file inside .github/workflows must be hard");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveHardZoneTouch: a path escaping the repo root is hard (sentinel)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rhz-esc-"));
  try {
    const r = resolveHardZoneTouch(["../../../../etc/passwd"], root);
    assert.equal(r.hard, true, "an out-of-repo escape must fail closed to hard");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveHardZoneTouch: a plain non-hard new file in an existing dir is NOT hard", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rhz-ok-"));
  try {
    fs.mkdirSync(path.join(root, "client", "src"), { recursive: true });
    const r = resolveHardZoneTouch(["client/src/NewWidget.tsx"], root);
    assert.equal(r.hard, false, "an ordinary component file must stay autopilot-eligible");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveHardZoneTouch: empty / undefined input is not hard (no false pause)", () => {
  assert.equal(resolveHardZoneTouch([]).hard, false);
  assert.equal(resolveHardZoneTouch(undefined as any).hard, false);
});

// ── Path-level hard surface (the always-HITL files) ──────────────────────────

test("isHardHitlSurface: schema / auth / payment PATHS are hard (always HITL)", () => {
  for (const f of [
    "shared/schema.ts",
    "server/auth.ts",
    "server/replitAuth.ts",
    "shared/models/auth.ts",
    "server/routes/stripe.ts",
    "server/safety/destructive-tool-policy.ts",
    "drizzle.config.ts",
  ]) {
    assert.equal(isHardHitlSurface([f]).hard, true, `expected ${f} to be a hard surface`);
  }
});

test("isHardHitlSurface: broad aggregators are NOT path-hard (rely on content gate)", () => {
  for (const f of ["server/routes.ts", "server/tools.ts", "server/chat-engine.ts", "server/routes/projects.ts"]) {
    assert.equal(isHardHitlSurface([f]).hard, false, `expected ${f} NOT to be path-hard`);
  }
});

// ── Content-level hard surface (the in-file blind spot) ──────────────────────

test("proposalTouchesHardContent: payment edit INSIDE a broad file is caught", () => {
  const p = baseProposal([
    {
      path: "server/routes.ts",
      find: "const session = await stripe.checkout.sessions.create({ line_items });",
      replace: "const session = await stripe.checkout.sessions.create({ line_items, customer });",
    },
  ]);
  assert.equal(proposalTouchesHardContent(p).hard, true, "payment/stripe edit must be flagged hard");
});

test("proposalTouchesHardContent: auth/session edit INSIDE a broad file is caught", () => {
  const p = baseProposal([
    {
      path: "server/routes.ts",
      find: "if (!req.session.userId) return res.sendStatus(401);",
      replace: "if (!req.session.userId || !isAuthenticated(req)) return res.sendStatus(401);",
    },
  ]);
  assert.equal(proposalTouchesHardContent(p).hard, true, "auth/session edit must be flagged hard");
});

test("proposalTouchesHardContent: schema DDL edit is caught", () => {
  const p = baseProposal([
    { path: "server/migrate.ts", find: "// add col", replace: "await db.execute(sql`ALTER TABLE leads ADD COLUMN x int`);" },
  ]);
  assert.equal(proposalTouchesHardContent(p).hard, true, "ALTER TABLE must be flagged hard");
});

test("proposalTouchesHardContent: pure tenant-isolation WHERE-clause fix is NOT hard", () => {
  const p = baseProposal([
    {
      path: "server/routes.ts",
      find: "const rows = await db.select().from(leads).where(eq(leads.id, id));",
      replace:
        "const rows = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, req.tenantId)));",
    },
  ]);
  assert.equal(proposalTouchesHardContent(p).hard, false, "a plain tenant_id WHERE fix must stay autopilot-eligible");
});

test("proposalTouchesHardContent: ownership-check fix in a non-sensitive file is NOT hard", () => {
  const p = baseProposal([
    {
      path: "server/tools.ts",
      find: "const project = await getProject(projectId);",
      replace: "await assertProjectInTenant(projectId, tenantId);\n  const project = await getProject(projectId);",
    },
  ]);
  assert.equal(proposalTouchesHardContent(p).hard, false, "an ownership-check fix must stay autopilot-eligible");
});

test("proposalTouchesHardContent: new-file body is scanned too", () => {
  const p: FixProposal = {
    diagnosis: "d",
    rootCause: "r",
    precedent: "p",
    edits: [],
    newFiles: [{ path: "server/helpers/x.ts", content: "export const PIN = process.env.ADMIN_PIN;" }],
  };
  assert.equal(proposalTouchesHardContent(p).hard, true, "a new file referencing ADMIN_PIN must be flagged hard");
});

// ── Scope pin: touched ⊆ candidateFiles (HIGH-2, fail-closed) ────────────────

test("isWithinPinnedScope: touched file inside the pin is in scope", () => {
  assert.equal(isWithinPinnedScope(["server/routes.ts"], ["server/routes.ts"]), true);
});

test("isWithinPinnedScope: an out-of-scope touched file denies the relax", () => {
  // finding pinned file A, but the proposal also edits unrelated file B → deny
  assert.equal(
    isWithinPinnedScope(["server/routes.ts", "server/tools.ts"], ["server/routes.ts"]),
    false,
    "any touched file outside candidateFiles must force HITL",
  );
});

test("isWithinPinnedScope: empty / absent pin fails closed", () => {
  assert.equal(isWithinPinnedScope(["server/routes.ts"], []), false, "empty pin must deny");
  assert.equal(isWithinPinnedScope(["server/routes.ts"], undefined), false, "absent pin must deny");
});

test("isWithinPinnedScope: empty touched set is not auto-eligible", () => {
  assert.equal(isWithinPinnedScope([], ["server/routes.ts"]), false, "no touched files must not relax");
});

test("isWithinPinnedScope: path normalization (./ and // and backslashes) still matches", () => {
  assert.equal(isWithinPinnedScope(["./server/routes.ts"], ["server/routes.ts"]), true);
  assert.equal(isWithinPinnedScope(["server//routes.ts"], ["server/routes.ts"]), true);
  assert.equal(isWithinPinnedScope(["server\\routes.ts"], ["server/routes.ts"]), true);
});

test("isWithinPinnedScope: a normalized mismatch still denies (no false widening)", () => {
  assert.equal(
    isWithinPinnedScope(["server/routes/projects.ts"], ["server/routes.ts"]),
    false,
    "a different file that merely shares a prefix must NOT be treated as in-scope",
  );
});
