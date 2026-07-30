// Query-free tests for the human-verified tenant-isolation-audit suppression
// allowlist (server/lib/audit-suppressions.ts). Fail-closed invariants:
// missing/unparseable/malformed input suppresses NOTHING.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSuppressions, matchSuppression, extractStructuralAnchor, type SuppressionEntry } from "../../server/lib/audit-suppressions";

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
  const snapshot = JSON.parse(
    fs.readFileSync("data/tenant-isolation-audit/campaign-2026-07-25-snapshot.json", "utf8"),
  );
  const findings: Array<{ file: string; issue: string }> = snapshot.findings;
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

test("shipped suppressions.json: every entry passes the specificity gate", () => {
  const PROD_PATTERNS = new Set(["fk-transitive", "internal-worker-pk", "global-table", "signed-url", "upstream-verified", "system-sweep"]);
  const raw = JSON.parse(fs.readFileSync("data/tenant-isolation-audit/suppressions.json", "utf8"));
  const logs: string[] = [];
  const loaded = loadSuppressions("data/tenant-isolation-audit/suppressions.json", PROD_PATTERNS, (m) => logs.push(m));
  assert.ok(Array.isArray(raw) && raw.length > 0, "shipped allowlist must be non-empty");
  assert.equal(loaded.length, raw.length, `loader rejected ${raw.length - loaded.length} shipped entries: ${logs.slice(0, 3).join(" | ")}`);
});
