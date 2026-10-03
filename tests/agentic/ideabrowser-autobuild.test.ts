// Tests for the IdeaBrowser auto-build loop — the rail that ingests the daily
// "Idea of the Day" emails, scores them, picks the top untouched S/A-tier idea,
// and generates a build-ready wedge package. dev/workspace-only; mirrors the
// autonomous_closer. We inject all deps so nothing touches Gmail, the DB, the
// LLM, or the filesystem.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  runIdeabrowserAutoBuild,
  type AutoBuildDeps,
  type BuildCandidate,
} from "../../server/agentic/ideabrowser-autobuild";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function cand(id: number, tier = "S", composite = 90): BuildCandidate {
  return { id, name: `idea ${id}`, description: "d", tier, composite };
}

type Calls = {
  ingested: number;
  scored: number;
  fetched: number;
  claimed: number[];
  released: number[];
  generated: number[];
  persisted: number[];
  built: number[];
  notified: string[];
};
function freshCalls(): Calls {
  return { ingested: 0, scored: 0, fetched: 0, claimed: [], released: [], generated: [], persisted: [], built: [], notified: [] };
}

// A stateful candidate queue: fetchTopCandidate returns the head; claimCandidate
// pops it (so the next fetch picks a different idea, mirroring the real
// claim-stamp that the SQL WHERE excludes); markBuilt confirms. Mirrors the real
// concurrency-safe flow where a claimed/built project is excluded next pick.
function makeDeps(over: Partial<AutoBuildDeps>, calls: Calls, queue: BuildCandidate[] = []): Partial<AutoBuildDeps> {
  return {
    async ingest() { calls.ingested++; return { fetched: 1, newlyStored: 1, createdProjectIds: [1], errors: [] }; },
    async score() { calls.scored++; return { ok: true }; },
    async fetchTopCandidate() { calls.fetched++; return queue.length ? queue[0] : null; },
    async claimCandidate(id) { calls.claimed.push(id); const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); return true; },
    async releaseClaim(id) { calls.released.push(id); },
    async generatePackage(c) { calls.generated.push(c.id); return { markdown: `# package ${c.id}`, model: "test-model" }; },
    async persistPackage(c) { calls.persisted.push(c.id); return `project-assets/autobuild/project-${c.id}.md`; },
    async markBuilt(id) { calls.built.push(id); return true; },
    async notifyOwner(subject) { calls.notified.push(subject); },
    ...over,
  };
}

async function run() {
  const prevEnv = process.env.NODE_ENV;
  const prevKill = process.env.IDEABROWSER_AUTOBUILD_DISABLED;
  const prevDry = process.env.IDEABROWSER_AUTOBUILD_DRYRUN;
  process.env.NODE_ENV = "test";
  delete process.env.IDEABROWSER_AUTOBUILD_DISABLED;
  delete process.env.IDEABROWSER_AUTOBUILD_DRYRUN;

  // 1. Prod hard-refuse — never builds on the ephemeral prod FS.
  {
    process.env.NODE_ENV = "production";
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps: makeDeps({}, calls) });
    assert(r.ran === false && !!r.skippedReason && r.skippedReason.includes("prod"), "prod → ran:false prod_disabled");
    assert(calls.ingested === 0 && calls.built.length === 0, "prod → nothing ingested/built");
    process.env.NODE_ENV = "test";
  }

  // 1b. Prod via REPLIT_DEPLOYMENT="1" (NODE_ENV non-prod) — must also hard-refuse.
  {
    const prevDep = process.env.REPLIT_DEPLOYMENT;
    process.env.REPLIT_DEPLOYMENT = "1";
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps: makeDeps({}, calls) });
    assert(r.ran === false && !!r.skippedReason && r.skippedReason.includes("prod"), "REPLIT_DEPLOYMENT=1 → ran:false prod_disabled");
    assert(calls.ingested === 0 && calls.built.length === 0, "REPLIT_DEPLOYMENT=1 → nothing ingested/built");
    if (prevDep === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = prevDep;
  }

  // 2. Kill switch.
  {
    process.env.IDEABROWSER_AUTOBUILD_DISABLED = "true";
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps: makeDeps({}, calls) });
    assert(r.ran === false && !!r.skippedReason && r.skippedReason.includes("kill_switch"), "kill switch → ran:false");
    assert(calls.ingested === 0, "kill switch → nothing ran");
    delete process.env.IDEABROWSER_AUTOBUILD_DISABLED;
  }

  // 3. No new idea → no-op (ingest+score still run, nothing built).
  {
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps: makeDeps({}, calls, []) });
    assert(r.ran === true && r.built.length === 0 && r.failed.length === 0, "no candidate → clean no-op");
    assert(calls.ingested === 1 && calls.scored === 1 && calls.fetched === 1, "no candidate → ingest+score+fetch ran");
    assert(calls.generated.length === 0, "no candidate → no LLM package generated");
  }

  // 4. Happy path — picks top S/A, generates, persists, marks built, notifies.
  {
    const queue = [cand(101, "S", 95)];
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps: makeDeps({}, calls, queue) });
    assert(r.built.length === 1 && r.built[0].id === 101, "happy path → built #101");
    assert(calls.generated.includes(101) && calls.persisted.includes(101) && calls.built.includes(101), "happy path → generate+persist+markBuilt");
    assert(calls.notified.length === 1, "happy path → owner notified once");
    assert(r.failed.length === 0, "happy path → no failures");
  }

  // 5. Dry run — no persist, no markBuilt, no notify; records intended build.
  {
    const queue = [cand(202, "A", 80)];
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, dryRun: true, deps: makeDeps({}, calls, queue) });
    assert(r.dryRun === true && r.built.length === 1 && r.built[0].file === "(dry-run)", "dryRun → records intended build, file=(dry-run)");
    assert(calls.persisted.length === 0 && calls.built.length === 0, "dryRun → no persist / no markBuilt");
    assert(calls.notified.length === 0, "dryRun → no notify");
  }

  // 6. maxBuilds cap — many candidates, only maxBuilds built.
  {
    const queue = [cand(301), cand(302), cand(303), cand(304)];
    const calls = freshCalls();
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 2, deps: makeDeps({}, calls, queue) });
    assert(r.built.length === 2, "maxBuilds=2 → exactly 2 built");
    assert(calls.built.length === 2 && queue.length === 2, "maxBuilds=2 → 2 popped, 2 remain");
  }

  // 7. notifyOwner failure is swallowed — build still succeeds.
  {
    const queue = [cand(401)];
    const calls = freshCalls();
    const deps = makeDeps({ async notifyOwner() { throw new Error("smtp down"); } }, calls, queue);
    let threw = false;
    let r: Awaited<ReturnType<typeof runIdeabrowserAutoBuild>> | null = null;
    try { r = await runIdeabrowserAutoBuild({ tenantId: 1, deps }); } catch { threw = true; }
    assert(!threw, "notify throw → run does not throw");
    assert(!!r && r.built.length === 1 && r.built[0].id === 401, "notify throw → build still recorded");
  }

  // 8. Ingest failure is captured but the run continues to score/fetch/build.
  {
    const queue = [cand(501)];
    const calls = freshCalls();
    const deps = makeDeps({ async ingest() { throw new Error("gmail 401"); } }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, deps });
    assert(r.failed.some((f) => f.stage === "ingest"), "ingest fail → recorded in failed[]");
    assert(r.built.length === 1 && r.built[0].id === 501, "ingest fail → still builds an already-scored idea");
  }

  // 9. Lost claim — a concurrent executor already owns the row. We must skip:
  //    no LLM call, no persist, no build, no notify.
  {
    const queue = [cand(601)];
    const calls = freshCalls();
    const deps = makeDeps({ async claimCandidate(id) { calls.claimed.push(id); return false; } }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 1, deps });
    assert(r.built.length === 0, "lost claim → nothing built");
    assert(calls.generated.length === 0 && calls.persisted.length === 0, "lost claim → no LLM call / no persist (no double-build spend)");
    assert(calls.notified.length === 0, "lost claim → owner not notified");
  }

  // 10. Lost mark race — claim won, but markBuilt CAS returns false (another
  //     executor stamped autobuild first). Must NOT record as built or notify.
  {
    const queue = [cand(701)];
    const calls = freshCalls();
    const deps = makeDeps({ async markBuilt(id) { calls.built.push(id); return false; } }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 1, deps });
    assert(r.built.length === 0, "lost mark race → not recorded as built");
    assert(r.failed.some((f) => f.stage === "mark"), "lost mark race → recorded as failed[mark]");
    assert(calls.notified.length === 0, "lost mark race → owner not notified");
  }

  // 11. Claim release on generate failure — when generatePackage throws after we
  //     won the claim, the claim must be released (retryable next run) and no file
  //     recorded as built.
  {
    const queue = [cand(801)];
    const calls = freshCalls();
    const deps = makeDeps({ async generatePackage() { throw new Error("LLM boom"); } }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 1, deps });
    assert(r.built.length === 0, "generate failure → nothing built");
    assert(r.failed.some((f) => f.stage === "build"), "generate failure → recorded as failed[build]");
    assert(calls.released.includes(801), "generate failure → claim released for retry");
  }

  // 12. Orphan-file cleanup on lost mark-race — persistPackage wrote a real file,
  //     then markBuilt lost the race. The orphan file must be removed.
  {
    const tmpFile = path.join(os.tmpdir(), `ideabuild-orphan-${Date.now()}.md`);
    const queue = [cand(901)];
    const calls = freshCalls();
    const deps = makeDeps({
      async persistPackage() { calls.persisted.push(901); fs.writeFileSync(tmpFile, "# orphan"); return tmpFile; },
      async markBuilt(id) { calls.built.push(id); return false; },
    }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 1, deps });
    assert(r.built.length === 0, "lost mark race → nothing built");
    assert(!fs.existsSync(tmpFile), "lost mark race → orphan package file cleaned up");
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); // belt-and-suspenders cleanup
  }

  // 13. Empty-package path also releases the claim (LLM returned nothing) so the
  //     idea is retryable next run rather than wedged for 1h.
  {
    const queue = [cand(1001)];
    const calls = freshCalls();
    const deps = makeDeps({ async generatePackage() { calls.generated.push(1001); return { markdown: "", model: "test-model" }; } }, calls, queue);
    const r = await runIdeabrowserAutoBuild({ tenantId: 1, maxBuilds: 1, deps });
    assert(r.built.length === 0 && calls.persisted.length === 0, "empty package → nothing built/persisted");
    assert(r.failed.some((f) => f.stage === "generate"), "empty package → recorded as failed[generate]");
    assert(calls.released.includes(1001), "empty package → claim released for retry");
  }

  // restore env
  if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
  if (prevKill === undefined) delete process.env.IDEABROWSER_AUTOBUILD_DISABLED; else process.env.IDEABROWSER_AUTOBUILD_DISABLED = prevKill;
  if (prevDry === undefined) delete process.env.IDEABROWSER_AUTOBUILD_DRYRUN; else process.env.IDEABROWSER_AUTOBUILD_DRYRUN = prevDry;

  console.log(`\nideabrowser-autobuild: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
