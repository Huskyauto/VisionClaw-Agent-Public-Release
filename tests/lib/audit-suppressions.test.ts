// Query-free tests for the human-verified tenant-isolation-audit suppression
// allowlist (server/lib/audit-suppressions.ts). Fail-closed invariants:
// missing/unparseable/malformed input suppresses NOTHING.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSuppressions, matchSuppression, extractStructuralAnchor, loadDeferrals, matchDeferral, type SuppressionEntry, type DeferralEntry } from "../../server/lib/audit-suppressions";

const PATTERNS = new Set(["internal-worker-pk", "system-sweep", "fk-transitive"]);

function tmpFile(content: string | null): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "supp-")), "suppressions.json");
  if (content !== null) fs.writeFileSync(p, content);
  return p;
}

const goodEntry: SuppressionEntry = {
  file: "server/agentic/runs.ts",
  pattern: "internal-worker-pk",
  match: "updateRunState() uses WHERE id = runId",
  anchor: "update:agent_runs",
  reason: "internal helper, id is server-generated",
  verifiedBy: "triage-campaign",
  date: "2026-07-25",
};

test("missing file → empty (fail closed, no throw)", () => {
  assert.deepEqual(loadSuppressions("/nonexistent/supp.json", PATTERNS), []);
});

test("unparseable JSON → empty + logged", () => {
  const logs: string[] = [];
  const out = loadSuppressions(tmpFile("{not json"), PATTERNS, (m) => logs.push(m));
  assert.deepEqual(out, []);
  assert.ok(logs.some((l) => l.includes("UNPARSEABLE")));
});

test("non-array root → empty", () => {
  assert.deepEqual(loadSuppressions(tmpFile('{"file":"x"}'), PATTERNS), []);
});

test("malformed entries skipped, valid kept", () => {
  const entries = [
    goodEntry,
    { ...goodEntry, pattern: "looks-internal" }, // unrecognized pattern
    { ...goodEntry, match: "too short" }, // < 12 chars
    { ...goodEntry, reason: "" }, // empty reason
    { ...goodEntry, verifiedBy: undefined }, // missing verifier
    { ...goodEntry, anchor: undefined }, // missing structural anchor
    { ...goodEntry, anchor: "Not A Valid Anchor" }, // malformed anchor shape
  ];
  const logs: string[] = [];
  const out = loadSuppressions(tmpFile(JSON.stringify(entries)), PATTERNS, (m) => logs.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0].match, goodEntry.match);
  assert.equal(logs.filter((l) => l.includes("malformed")).length, 6);
});

test("matchSuppression: exact file + issue substring required", () => {
  const entries = [goodEntry];
  assert.ok(
    matchSuppression(
      { file: "server/agentic/runs.ts", issue: "UPDATE agent_runs in updateRunState() uses WHERE id = runId without tenant scoping" },
      entries,
    ),
  );
  // wrong file → no match
  assert.equal(
    matchSuppression({ file: "server/other.ts", issue: "updateRunState() uses WHERE id = runId" }, entries),
    undefined,
  );
  // issue text without the match substring → no match
  assert.equal(
    matchSuppression({ file: "server/agentic/runs.ts", issue: "completeRun() uses WHERE id = runId" }, entries),
    undefined,
  );
});

test("low-specificity match keys are rejected by the loader (fail closed)", () => {
  const entries = [
    { ...goodEntry, match: "project_files_x" }, // bare identifier ≥12 but <40 → rejected
    { ...goodEntry, match: "conversations.messages" }, // bare dotted identifier → rejected
    { ...goodEntry, match: "short frag ok?" }, // structural but <20 chars → rejected
    goodEntry, // multi-token code fragment ≥20 → kept
  ];
  const logs: string[] = [];
  const out = loadSuppressions(tmpFile(JSON.stringify(entries)), PATTERNS, (m) => logs.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0].match, goodEntry.match);
  assert.equal(logs.filter((l) => l.includes("low-specificity")).length, 3);
});

test("a NEW finding in the same file sharing only a table token is NOT suppressed", () => {
  const entries = [goodEntry];
  // new, different finding mentions runId/agent_runs but not the anchored fragment
  assert.equal(
    matchSuppression(
      { file: "server/agentic/runs.ts", issue: "DELETE from agent_runs WHERE created_at < cutoff has no tenant filter (runId table sweep)" },
      entries,
    ),
    undefined,
  );
});

test("adversarial: same match phrase but different op/table fingerprint is NOT suppressed", () => {
  const entries = [goodEntry]; // anchor update:agent_runs
  // A NEW finding that quotes the SAME code fragment (match substring present!)
  // but describes a DIFFERENT operation/table — anchor mismatch must block it.
  const issue = "DELETE FROM agent_approvals near updateRunState() uses WHERE id = runId with no tenant filter";
  assert.equal(extractStructuralAnchor(issue), "delete:agent_approvals");
  assert.equal(matchSuppression({ file: "server/agentic/runs.ts", issue }, entries), undefined);
});

test("extractStructuralAnchor: deterministic across SQL, prose, and code shapes", () => {
  assert.equal(
    extractStructuralAnchor("UPDATE ai_insights is executed without tenant_id constraint (UPDATE ai_insights SET x)"),
    "update:ai_insights",
  );
  assert.equal(
    extractStructuralAnchor("createInvoice inserts an invoices row referencing a caller-supplied customer_id"),
    "insert:createinvoice",
  );
  // suffixed SQL verbs canonicalize to the base op
  assert.equal(
    extractStructuralAnchor("backfillJob SELECTs rows from `custom_tools_x` with no tenant filter"),
    "select:custom_tools_x",
  );
  // pure prose with NO identifiable op/table/code ⇒ null (never suppressible)
  assert.equal(extractStructuralAnchor("Nested template inlines request-derived payload data blob here"), null);
  assert.equal(extractStructuralAnchor("bad"), null);
});

test("anchor quality: prose stopwords never become anchors; SQL scan skips prose-shaped matches", () => {
  // "UPDATE against ..." — 'against' is prose, but the real statement follows.
  assert.equal(
    extractStructuralAnchor("UPDATE against tenant-scoped data is unsafe; the code runs UPDATE agent_jobs SET status='x'"),
    "update:agent_jobs",
  );
  // 'will'/'that'/'against' can never be the rhs of an anchor
  for (const issue of ["UPDATE will occur later", "UPDATE that runs nightly", "UPDATE against everything"]) {
    const a = extractStructuralAnchor(issue);
    assert.ok(a === null || !/(will|that|against)$/.test(a), `prose anchor leaked: ${a} from "${issue}"`);
  }
});

test("loader rejects text: digests and stopword/prose anchors (fail closed)", () => {
  const entries = [
    goodEntry,
    { ...goodEntry, anchor: "text:abc123def456" }, // digest fallback banned in prod
    { ...goodEntry, anchor: "update:against" }, // stopword rhs
    { ...goodEntry, anchor: "update:will" }, // stopword rhs
    { ...goodEntry, anchor: "frobnicate:agent_runs" }, // unknown op prefix
  ];
  const logs: string[] = [];
  const out = loadSuppressions(tmpFile(JSON.stringify(entries)), PATTERNS, (m) => logs.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0].anchor, "update:agent_runs");
  assert.equal(logs.filter((l) => l.includes("malformed")).length, 4);
});

test("adversarial: code-anchor collision requires the SAME code fragment, not just any code", () => {
  const entry: SuppressionEntry = {
    ...goodEntry,
    match: "inlines ${payload.blob} directly into pg literal",
    anchor: extractStructuralAnchor("Nested template inlines ${payload.blob} directly into pg literal here")!,
  };
  assert.ok(entry.anchor.startsWith("code:"), `expected code anchor, got ${entry.anchor}`);
  // different code fragment in the same file → different code: anchor → no match
  assert.equal(
    matchSuppression(
      { file: goodEntry.file, issue: "Nested template inlines ${payload.blob} directly into pg literal here but ALSO ${other.secret} elsewhere" },
      [{ ...entry, anchor: "code:othersecretfragmentxx" }],
    ),
    undefined,
  );
  // same fragment → matches
  assert.ok(
    matchSuppression(
      { file: goodEntry.file, issue: "Nested template inlines ${payload.blob} directly into pg literal here" },
      [entry],
    ),
  );
});

test("adversarial: partial phrase overlap with an allowlisted entry is NOT suppressed", () => {
  const entries = [goodEntry]; // match: "updateRunState() uses WHERE id = runId", anchor update:agent_runs
  // A NEW finding in the SAME file with the SAME anchor that shares WORDS of the
  // match phrase but not the full verbatim substring must never be suppressed.
  const issue =
    "UPDATE agent_runs in retryRun() uses WHERE id = parentId without tenant scoping (similar to updateRunState pattern)";
  assert.equal(extractStructuralAnchor(issue), "update:agent_runs"); // anchor collides on purpose
  assert.ok(!issue.includes(goodEntry.match));
  assert.equal(matchSuppression({ file: goodEntry.file, issue }, entries), undefined);
});

test("shipped suppressions.json: every anchor is reproducible from its source snapshot finding (generation contract)", () => {
  // Every triage campaign ships its own snapshot (campaign-*-snapshot.json);
  // an entry is valid if ANY campaign snapshot contains its source finding.
  const snapshotFiles = fs
    .readdirSync("data/tenant-isolation-audit")
    .filter((f) => /^campaign-.*-snapshot\.json$/.test(f));
  assert.ok(snapshotFiles.length > 0, "no campaign snapshots found");
  const findings: Array<{ file: string; issue: string }> = snapshotFiles.flatMap(
    (f) => JSON.parse(fs.readFileSync(`data/tenant-isolation-audit/${f}`, "utf8")).findings,
  );
  const entries = JSON.parse(fs.readFileSync("data/tenant-isolation-audit/suppressions.json", "utf8"));
  const bad: string[] = [];
  for (const e of entries) {
    const ok = findings.some(
      (f) => f.file === e.file && f.issue.includes(e.match) && extractStructuralAnchor(f.issue) === e.anchor,
    );
    if (!ok) bad.push(`${e.file} :: ${e.anchor} :: ${e.match.slice(0, 40)}`);
  }
  assert.deepEqual(bad, [], `entries whose anchor is NOT reproducible via extractStructuralAnchor from a matching snapshot finding:\n${bad.join("\n")}`);
});

// ── codeLine (paraphrase-immune) matching ───────────────────────────────────

function tmpSource(content: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "supp-src-")), "mod.ts");
  fs.writeFileSync(p, content);
  return p;
}

test("codeLine: paraphrased issue at the SAME code site IS suppressed; different site is NOT", () => {
  const src = tmpSource(
    ["// header", "", "export async function updateRunState(runId: string) {",
      '  await db.execute(sql`UPDATE agent_runs SET state = ${s} WHERE id = ${runId}`);', "}",
      "export async function purgeOldRuns() {",
      "  await db.execute(sql`DELETE FROM agent_runs WHERE created_at < now()`);", "}"].join("\n"),
  );
  const entry: SuppressionEntry = {
    ...goodEntry,
    file: src,
    match: "updateRunState() runs UPDATE agent_runs WHERE id = runId with no tenant filter",
    codeLine: 'await db.execute(sql`UPDATE agent_runs SET state = ${s} WHERE id = ${runId}`);',
  };
  // Paraphrase (verbatim match absent) but line points at the verified site → suppressed.
  const paraphrase = "The helper updateRunState mutates agent_runs (UPDATE agent_runs SET state) constrained only by id";
  assert.ok(!paraphrase.includes(entry.match));
  assert.ok(matchSuppression({ file: src, issue: paraphrase, line: 4 }, [entry]));
  // Same anchor family but a line far from the verified site → NOT suppressed.
  assert.equal(matchSuppression({ file: src, issue: paraphrase, line: 40 }, [entry]), undefined);
  // No line on the finding → codeLine path fails closed.
  assert.equal(matchSuppression({ file: src, issue: paraphrase }, [entry]), undefined);
});

test("codeLine: anchor PARAPHRASE at the same site is suppressed when the issue still names the entry's identifier; unrelated identifier fails closed", () => {
  const src = tmpSource(
    ["// header", "", "export async function finalizeEvent(id: number) {",
      '  await db.execute(sql`UPDATE event_log SET done = true WHERE id = ${id}`);', "}"].join("\n"),
  );
  const entry: SuppressionEntry = {
    ...goodEntry,
    file: src,
    anchor: "update:finalizeevent", // fingerprinted off last night's wording
    match: "finalizeEvent updates without tenant scoping",
    codeLine: 'await db.execute(sql`UPDATE event_log SET done = true WHERE id = ${id}`);',
  };
  // Tonight's model fingerprints the SAME site as update:event_log — but the
  // issue text still names finalizeEvent, and the line is the verified site.
  const issue = "UPDATE on tenant-scoped table `event_log` executed without scoping by tenant_id (finalizeEvent called here)";
  assert.ok(matchSuppression({ file: src, issue, line: 4 }, [entry]));
  // An issue about a DIFFERENT identifier at a nearby line stays red.
  const other = "UPDATE on tenant-scoped table `event_log` in archiveOldEvents lacks tenant scoping";
  assert.equal(matchSuppression({ file: src, issue: other, line: 4 }, [entry]), undefined);
  // Short/unreliable entry identifiers never relax the anchor.
  const shortEntry = { ...entry, anchor: "op:id" };
  assert.equal(matchSuppression({ file: src, issue, line: 4 }, [shortEntry]), undefined);
});

test("codeLine: OPERATION mismatch at the SAME site fails closed even when the issue names the entry's identifier", () => {
  const src = tmpSource(
    ["// header", "", "export async function finalizeEvent(id: number) {",
      '  await db.execute(sql`UPDATE event_log SET done = true WHERE id = ${id}`);', "}"].join("\n"),
  );
  const entry: SuppressionEntry = {
    ...goodEntry,
    file: src,
    anchor: "update:finalizeevent",
    match: "finalizeEvent updates without tenant scoping",
    codeLine: 'await db.execute(sql`UPDATE event_log SET done = true WHERE id = ${id}`);',
  };
  // A NEW issue at the shared site describing a DIFFERENT SQL operation must
  // never be absorbed by the update-anchored entry, even though its prose
  // names finalizeEvent (the containing function).
  const deleteIssue = "DELETE FROM event_log rows executed inside finalizeEvent without any tenant_id constraint";
  assert.equal(extractStructuralAnchor(deleteIssue)?.startsWith("delete:"), true);
  assert.equal(matchSuppression({ file: src, issue: deleteIssue, line: 4 }, [entry]), undefined);
  const selectIssue = "SELECT * FROM event_log in finalizeEvent reads rows across all tenants (no tenant filter)";
  assert.equal(extractStructuralAnchor(selectIssue)?.startsWith("select:"), true);
  assert.equal(matchSuppression({ file: src, issue: selectIssue, line: 4 }, [entry]), undefined);
  // Same operation + same identifier still matches (the intended relaxation).
  const sameOp = "UPDATE on `event_log` table performed by finalizeEvent lacks a tenant_id predicate";
  assert.ok(matchSuppression({ file: src, issue: sameOp, line: 4 }, [entry]));
});

test("codeLine: unreadable file or vanished source line fails closed", () => {
  const entry: SuppressionEntry = {
    ...goodEntry,
    file: "/nonexistent/gone.ts",
    match: "updateRunState() runs UPDATE agent_runs WHERE id = runId with no tenant filter",
    codeLine: "await db.update(agentRuns).where(eq(agentRuns.id, runId));",
  };
  const issue = "UPDATE agent_runs by bare id in updateRunState without tenant scoping";
  assert.equal(matchSuppression({ file: "/nonexistent/gone.ts", issue, line: 4 }, [entry]), undefined);
  // Line no longer present in a readable file → also no match.
  const src = tmpSource("// the verified line was refactored away\nconst x = 1;\n");
  assert.equal(matchSuppression({ file: src, issue, line: 1 }, [{ ...entry, file: src }]), undefined);
});

test("loader: unusable codeLine is dropped but the entry survives verbatim-only", () => {
  const logs: string[] = [];
  const out = loadSuppressions(
    tmpFile(JSON.stringify([{ ...goodEntry, codeLine: "short" }])),
    PATTERNS,
    (m) => logs.push(m),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].codeLine, undefined);
  assert.ok(logs.some((l) => l.includes("unusable codeLine")));
});

// ── dated deferrals ──────────────────────────────────────────────────────────

const goodDeferral: DeferralEntry = {
  file: "server/storage.ts",
  match: "getMemoryStats falls back to an unscoped read when tenantId omitted",
  anchor: "select:memory_entries",
  reason: "optional-tenant helper hardening parked",
  deferredBy: "campaign",
  date: "2026-08-01",
  reviewBy: "2026-09-30",
};

test("deferrals: missing/unparseable/malformed → nothing deferred (fail closed)", () => {
  assert.deepEqual(loadDeferrals("/nonexistent/deferrals.json"), []);
  const logs: string[] = [];
  assert.deepEqual(loadDeferrals(tmpFile("{bad"), (m) => logs.push(m)), []);
  assert.ok(logs.some((l) => l.includes("UNPARSEABLE")));
  const out = loadDeferrals(
    tmpFile(JSON.stringify([
      goodDeferral,
      { ...goodDeferral, reviewBy: "soon" }, // malformed date
      { ...goodDeferral, reviewBy: undefined },
      { ...goodDeferral, reason: "" },
    ])),
    (m) => logs.push(m),
    new Date("2026-08-15T00:00:00Z"),
  );
  assert.equal(out.length, 1);
});

test("deferrals: expire LOUDLY after reviewBy — finding goes red again", () => {
  const logs: string[] = [];
  const file = tmpFile(JSON.stringify([goodDeferral]));
  // Before expiry (and on the reviewBy day itself) → active.
  assert.equal(loadDeferrals(file, () => {}, new Date("2026-09-30T23:00:00Z")).length, 1);
  // After expiry → skipped with a loud log.
  assert.equal(loadDeferrals(file, (m) => logs.push(m), new Date("2026-10-01T01:00:00Z")).length, 0);
  assert.ok(logs.some((l) => l.includes("EXPIRED")));
});

test("matchDeferral: same file+anchor+verbatim match required", () => {
  const entries = [goodDeferral];
  assert.ok(
    matchDeferral(
      { file: goodDeferral.file, issue: "SELECT FROM memory_entries: getMemoryStats falls back to an unscoped read when tenantId omitted" },
      entries,
    ),
  );
  assert.equal(
    matchDeferral({ file: "server/other.ts", issue: "SELECT FROM memory_entries: getMemoryStats falls back to an unscoped read when tenantId omitted" }, entries),
    undefined,
  );
});

test("shipped deferrals.json: every entry loads (none silently rejected) and is dated+expiring", () => {
  const p = "data/tenant-isolation-audit/deferrals.json";
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const logs: string[] = [];
  // Fixed 'today' inside the deferral window so this test doesn't rot at expiry
  // (expiry going red in PROD is desired; this test only checks entry VALIDITY).
  const loaded = loadDeferrals(p, (m) => logs.push(m), new Date("2026-08-02T00:00:00Z"));
  assert.ok(Array.isArray(raw) && raw.length > 0, "shipped deferrals must be non-empty");
  assert.equal(loaded.length, raw.length, `loader rejected shipped deferrals: ${logs.slice(0, 3).join(" | ")}`);
  for (const e of loaded) assert.match(e.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
});

test("shipped suppressions.json: every entry passes the specificity gate", () => {
  const PROD_PATTERNS = new Set(["fk-transitive", "internal-worker-pk", "global-table", "signed-url", "upstream-verified", "system-sweep"]);
  const raw = JSON.parse(fs.readFileSync("data/tenant-isolation-audit/suppressions.json", "utf8"));
  const logs: string[] = [];
  const loaded = loadSuppressions("data/tenant-isolation-audit/suppressions.json", PROD_PATTERNS, (m) => logs.push(m));
  assert.ok(Array.isArray(raw) && raw.length > 0, "shipped allowlist must be non-empty");
  assert.equal(loaded.length, raw.length, `loader rejected ${raw.length - loaded.length} shipped entries: ${logs.slice(0, 3).join(" | ")}`);
});
