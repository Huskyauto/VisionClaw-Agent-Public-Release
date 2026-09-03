// Autonomous IdeaBrowser auto-build — closes the email → idea → build loop daily
// without a human gate. It (1) ingests new Greg-Isenberg "Idea of the Day" emails
// into idea-stage projects, (2) scores any new ones via the existing portfolio
// rubric, (3) picks the single highest-composite NEW S/A-tier idea that hasn't
// been built yet, and (4) autonomously generates a build-ready WEDGE PACKAGE
// (validation brief + buyer/pricing + MVP spec + landing-page copy + 7-day build
// plan), writes it into the repo, marks the project built, and notifies the owner.
//
// Design invariants (high blast-radius surface — read before editing):
//  - DEV/workspace ONLY. The package file is committed via Auto Git Push from the
//    workspace; the deployed prod FS is ephemeral so building there is useless and
//    would mark the shared-DB project 'autobuilt' before the file is persisted.
//    The heartbeat selection guards skip this task type in production; this module
//    also hard-refuses when NODE_ENV==='production'.
//  - Capped per run (IDEABROWSER_AUTOBUILD_MAX_BUILDS, default 1, ceil 3) so a
//    backlog of unscored ideas can't fan out into a burst of expensive builds.
//  - Idempotent: a built project gets metadata.autobuild + the 'autobuilt' tag and
//    is excluded from future candidate selection. Re-running is a safe no-op once
//    the day's top idea is built.
//  - Kill switch: IDEABROWSER_AUTOBUILD_DISABLED=true halts all runs.
//  - never-throws: returns a structured AutoBuildResult; all errors are logged and
//    surfaced in the result, never propagated to the heartbeat loop.

import { db } from "../db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { isProductionRuntime } from "../lib/runtime-env";

export interface BuildCandidate {
  id: number;
  name: string;
  description: string | null;
  tier: string | null;
  composite: number | null;
}

export interface AutoBuildDeps {
  /** Pull recent ideabrowser emails → new idea-stage projects. Returns new project ids + counts. */
  ingest: (tenantId: number, sinceDays: number) => Promise<{ fetched: number; newlyStored: number; createdProjectIds: number[]; errors: string[] }>;
  /** Score any unscored isenberg projects (sets metadata.priority + tier:* tags). */
  score: (tenantId: number) => Promise<{ ok: boolean; detail?: string }>;
  /** Highest-composite NEW S/A-tier project not yet autobuilt OR claimed (stale claims reclaimable), or null. */
  fetchTopCandidate: (tenantId: number) => Promise<BuildCandidate | null>;
  /**
   * Atomically claim the candidate BEFORE the expensive LLM call. CAS: succeeds
   * (true) only if the row is not already built and not freshly claimed by a
   * concurrent executor (a stale claim >1h is reclaimable so a crashed build
   * never permanently locks the idea). Returns false → another executor owns it;
   * skip without burning an LLM call. This is the concurrency guard that makes
   * "the same idea never double-builds" hold even if a manual run overlaps the
   * heartbeat on the shared DB.
   */
  claimCandidate: (id: number, tenantId: number) => Promise<boolean>;
  /**
   * Compensating release of a claim after a post-claim failure (generate/persist
   * threw, or the package was empty), so the idea becomes retryable immediately
   * instead of waiting out the 1h stale-claim window. CAS: only clears the claim
   * when the row is NOT already built, so it can never disturb a row another
   * executor finished building. Best-effort — failures are swallowed.
   */
  releaseClaim: (id: number, tenantId: number) => Promise<void>;
  /** LLM-generate the build-ready wedge package markdown for an idea. */
  generatePackage: (c: BuildCandidate, tenantId: number) => Promise<{ markdown: string; model: string }>;
  /** Write the package into the repo; returns the relative file path. */
  persistPackage: (c: BuildCandidate, markdown: string) => Promise<string>;
  /**
   * Mark the project built (metadata.autobuild + 'autobuilt' tag) so it's never
   * rebuilt. CAS + checked: returns true only when a row was actually updated
   * (NOT already built) — a zero-row result (lost race) returns false and MUST
   * NOT be recorded as a build or notified.
   */
  markBuilt: (id: number, tenantId: number, file: string, model: string) => Promise<boolean>;
  notifyOwner: (subject: string, body: string) => Promise<void>;
}

export interface AutoBuildResult {
  ran: boolean;
  skippedReason?: string;
  ingested: number;
  newProjects: number;
  built: { id: number; name: string; tier: string | null; file: string }[];
  failed: { id: number; stage: string; error?: string }[];
  dryRun: boolean;
}

function envMaxBuilds(): number {
  const raw = parseInt(process.env.IDEABROWSER_AUTOBUILD_MAX_BUILDS || "1", 10);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(raw, 3); // hard ceiling — never build more than 3 in one run
}

function envSinceDays(): number {
  const raw = parseInt(process.env.IDEABROWSER_INGEST_SINCE_DAYS || "2", 10);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(raw, 30);
}

const BUILD_SYSTEM_PROMPT =
  `You are a venture-grade product strategist for VisionClaw — a 16-persona AI corporate team (CEO + media + engineering + ops) that ships standalone products and productized "wedge" SaaS. ` +
  `Strengths: fast AI media generation, agent orchestration, multi-tenant SaaS infra, automated content engines. Weakness: solo-founder bandwidth, no enterprise sales motion. ` +
  `Given ONE early-stage idea, produce a concrete, build-ready WEDGE PACKAGE in clean Markdown with EXACTLY these sections:\n` +
  `## Validation Brief — the pain, who has it, why now, market size signal (1 short paragraph + 3-5 bullets).\n` +
  `## Ideal Customer Profile — the single sharpest buyer (role, context, trigger).\n` +
  `## Monetization — named buyer + a concrete price point + model (one-shot vs subscription), and the fastest path to first dollar.\n` +
  `## Thin-MVP Spec — the smallest shippable thing VisionClaw can build with its existing stack (bullet list of features; call out which persona/tool ships each).\n` +
  `## Landing Page Copy — hero headline, subhead, 3 value props, primary CTA, and one objection-handling line.\n` +
  `## 7-Day Build Plan — day-by-day, each day one concrete deliverable.\n` +
  `Be specific and decisive — name real numbers and a real buyer. No hedging, no "it depends". Keep it under ~900 words.`;

function defaultDeps(): AutoBuildDeps {
  return {
    async ingest(tenantId, sinceDays) {
      const { ingestNewIdeabrowser } = await import("../lib/ideabrowser-ingest");
      return ingestNewIdeabrowser({ tenantId, sinceDays });
    },
    async score(tenantId) {
      // Reuse the proven daily scorer (idempotent: skips projects that already
      // have metadata.priority). dev/workspace-only task → npx tsx is available.
      return new Promise((resolve) => {
        try {
          const { spawn } = require("child_process") as typeof import("child_process");
          const { sanitizeSpawnEnv } = require("../safety/spawn-env-guard") as typeof import("../safety/spawn-env-guard");
          const child = spawn("npx", ["tsx", "scripts/auto-score-new-isenberg.ts"], {
            stdio: "inherit",
            // Scrub loader-hijack env vars (LD_PRELOAD/DYLD_*/NODE_OPTIONS/NODE_PATH)
            // before the child inherits process.env — same hardening as research-engine.
            env: { ...sanitizeSpawnEnv(), TENANT_ID: String(tenantId) },
          });
          child.on("error", (e: any) => resolve({ ok: false, detail: e?.message || String(e) }));
          child.on("close", (code: number) => resolve({ ok: code === 0, detail: `exit ${code}` }));
        } catch (e: any) {
          resolve({ ok: false, detail: e?.message || String(e) });
        }
      });
    },
    async fetchTopCandidate(tenantId) {
      // Exclude rows already built AND rows freshly claimed by a concurrent
      // executor (claim <1h old). A stale claim (>1h) is treated as abandoned
      // and becomes eligible again — so a crashed build self-heals next run.
      const r = await db.execute(sql`
        SELECT id, name, description,
               (metadata->'priority'->>'tier') AS tier,
               (metadata->'priority'->>'composite')::int AS composite
        FROM projects
        WHERE tenant_id = ${tenantId}
          AND (metadata->'priority'->>'tier') IN ('S', 'A')
          AND NOT (metadata ? 'autobuild')
          AND (
            NOT (metadata ? 'autobuild_claim')
            OR (metadata->>'autobuild_claim')::timestamptz < now() - interval '1 hour'
          )
        ORDER BY (metadata->'priority'->>'composite')::int DESC NULLS LAST, id DESC
        LIMIT 1
      `);
      const rows = (r as any).rows || r || [];
      return rows.length ? (rows[0] as BuildCandidate) : null;
    },
    async claimCandidate(id, tenantId) {
      // Atomic CAS: stamp metadata.autobuild_claim only if not already built and
      // not freshly claimed. RETURNING id → a row came back iff WE won the claim.
      const r = await db.execute(sql`
        UPDATE projects
        SET metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('autobuild_claim', to_jsonb(now()::text))
        WHERE id = ${id} AND tenant_id = ${tenantId}
          AND NOT (metadata ? 'autobuild')
          AND (
            NOT (metadata ? 'autobuild_claim')
            OR (metadata->>'autobuild_claim')::timestamptz < now() - interval '1 hour'
          )
        RETURNING id
      `);
      const rows = (r as any).rows || r || [];
      return rows.length > 0;
    },
    async releaseClaim(id, tenantId) {
      // CAS: drop the claim stamp ONLY if the row isn't already built, so a
      // failed post-claim attempt frees the idea for retry without ever touching
      // a row another executor finished. Best-effort — never throws.
      try {
        await db.execute(sql`
          UPDATE projects
          SET metadata = metadata - 'autobuild_claim'
          WHERE id = ${id} AND tenant_id = ${tenantId}
            AND NOT (metadata ? 'autobuild')
        `);
      } catch (e: any) {
        console.warn(`[ideabrowser-autobuild] releaseClaim failed for #${id}: ${e?.message || e}`);
      }
    },
    async generatePackage(c, tenantId) {
      const { resilientChatCompletion } = await import("../lib/resilient-llm");
      const { getModelForTierAsync } = await import("../providers");
      const model = await getModelForTierAsync("balanced", tenantId);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      try {
        const rc = await resilientChatCompletion({
          requestedModel: model,
          tenantId,
          label: "ideabrowser-autobuild",
          signal: ctrl.signal,
          baseParams: {
            messages: [
              { role: "system", content: BUILD_SYSTEM_PROMPT },
              {
                role: "user",
                content: `Build the wedge package for this idea.\n\nIDEA: ${c.name}\n\nCONTEXT:\n${(c.description || "(no description)").slice(0, 2500)}`,
              },
            ],
            max_completion_tokens: 2400,
            temperature: 0.4,
          },
        });
        const markdown = String(rc?.response?.choices?.[0]?.message?.content || "").trim();
        return { markdown, model: rc?.usedModel || model };
      } finally {
        clearTimeout(timer);
      }
    },
    async persistPackage(c, markdown) {
      const dir = path.join("project-assets", "autobuild");
      fs.mkdirSync(dir, { recursive: true });
      const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      const file = path.join(dir, `project-${c.id}-${slug || "idea"}.md`);
      const header =
        `# Wedge Package — ${c.name}\n\n` +
        `> Autonomously generated by the IdeaBrowser auto-build loop on ${new Date().toISOString().slice(0, 10)}.\n` +
        `> Project #${c.id} · tier ${c.tier ?? "?"} · composite ${c.composite ?? "?"}.\n\n---\n\n`;
      fs.writeFileSync(file, header + markdown + "\n");
      return file;
    },
    async markBuilt(id, tenantId, file, model) {
      // CAS: only stamp autobuild if NOT already built. The claim is dropped at
      // the same time. RETURNING id → row updated iff we still owned the build.
      const meta = { autobuild: { builtAt: new Date().toISOString(), file, model } };
      const r = await db.execute(sql`
        UPDATE projects
        SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'autobuild_claim')
              || ${JSON.stringify(meta)}::jsonb,
            tags = (SELECT ARRAY(SELECT DISTINCT unnest(tags || ARRAY['autobuilt']::text[])))
        WHERE id = ${id} AND tenant_id = ${tenantId}
          AND NOT (metadata ? 'autobuild')
        RETURNING id
      `);
      const rows = (r as any).rows || r || [];
      return rows.length > 0;
    },
    async notifyOwner(subject, body) {
      // Real owner email — sendEmail's internal owner-digest gate (R103) collapses
      // these into the once-a-day report so it never spams Bob. Falls back to a
      // loud log if email isn't configured.
      try {
        const { sendEmail, getPrimaryInboxId, isEmailConfigured } = await import("../email");
        const to =
          process.env.OWNER_EMAIL ||
          process.env.OWNER_ALERT_EMAIL ||
          process.env.SITE_OWNER_EMAIL ||
          process.env.SITE_CONTACT_EMAIL ||
          "";
        if (!isEmailConfigured() || !to) {
          console.warn(`[ideabrowser-autobuild][OWNER] ${subject} :: ${body} (email not configured)`);
          return;
        }
        const inboxId = await getPrimaryInboxId();
        await sendEmail({ inboxId, to, subject, text: body });
      } catch (e: any) {
        console.warn(`[ideabrowser-autobuild][OWNER] ${subject} :: ${body} (email failed: ${e?.message || e})`);
      }
    },
  };
}

async function safeNotify(deps: AutoBuildDeps, subject: string, body: string): Promise<void> {
  try {
    await deps.notifyOwner(subject, body);
  } catch (e: any) {
    console.error(`[ideabrowser-autobuild] notifyOwner failed: ${e?.message || e}`);
  }
}

async function safeRelease(deps: AutoBuildDeps, id: number, tenantId: number): Promise<void> {
  try {
    await deps.releaseClaim(id, tenantId);
  } catch (e: any) {
    console.error(`[ideabrowser-autobuild] releaseClaim threw for #${id}: ${e?.message || e}`);
  }
}

// Best-effort removal of an orphan package file written before a build failed or
// lost the mark-race. ENOENT (already gone / never written) is fine — never throws.
function safeUnlink(file: string | null): void {
  if (!file) return;
  try {
    fs.unlinkSync(file);
    console.log(`[ideabrowser-autobuild] cleaned up orphan package file ${file}`);
  } catch (e: any) {
    if (e?.code !== "ENOENT") console.warn(`[ideabrowser-autobuild] orphan cleanup failed for ${file}: ${e?.message || e}`);
  }
}

export async function runIdeabrowserAutoBuild(opts: {
  tenantId?: number;
  dryRun?: boolean;
  maxBuilds?: number;
  sinceDays?: number;
  deps?: Partial<AutoBuildDeps>;
} = {}): Promise<AutoBuildResult> {
  const tenantId = opts.tenantId ?? 1;
  const dryRun = opts.dryRun ?? (process.env.IDEABROWSER_AUTOBUILD_DRYRUN === "true");
  const maxBuilds = opts.maxBuilds ?? envMaxBuilds();
  const sinceDays = opts.sinceDays ?? envSinceDays();
  const deps: AutoBuildDeps = { ...defaultDeps(), ...(opts.deps || {}) };

  const result: AutoBuildResult = {
    ran: true,
    ingested: 0,
    newProjects: 0,
    built: [],
    failed: [],
    dryRun,
  };

  if (process.env.IDEABROWSER_AUTOBUILD_DISABLED === "true") {
    return { ...result, ran: false, skippedReason: "kill_switch (IDEABROWSER_AUTOBUILD_DISABLED=true)" };
  }

  // Hard prod refusal — enforced HERE, independent of the heartbeat selection
  // guards, so a future route/script/manual call can never build on the ephemeral
  // prod FS (which would mark the shared-DB project 'autobuilt' before Auto Git
  // Push persists the file). dev/workspace only. Checks BOTH REPLIT_DEPLOYMENT
  // and NODE_ENV so an unset/misset NODE_ENV can't fail OPEN.
  if (isProductionRuntime()) {
    return { ...result, ran: false, skippedReason: "prod_disabled (dev/workspace only)" };
  }

  // 1. Ingest new ideabrowser emails → idea-stage projects.
  try {
    const ing = await deps.ingest(tenantId, sinceDays);
    result.ingested = ing.newlyStored;
    result.newProjects = ing.createdProjectIds.length;
    if (ing.errors.length) console.warn(`[ideabrowser-autobuild] ingest warnings: ${ing.errors.join("; ")}`);
  } catch (e: any) {
    console.error(`[ideabrowser-autobuild] ingest failed: ${e?.message || e}`);
    result.failed.push({ id: 0, stage: "ingest", error: e?.message || String(e) });
    // continue — there may still be previously-ingested, newly-scorable ideas.
  }

  // 2. Score any unscored isenberg projects.
  try {
    const sc = await deps.score(tenantId);
    if (!sc.ok) console.warn(`[ideabrowser-autobuild] score non-zero: ${sc.detail}`);
  } catch (e: any) {
    console.error(`[ideabrowser-autobuild] score failed: ${e?.message || e}`);
    result.failed.push({ id: 0, stage: "score", error: e?.message || String(e) });
    // continue — already-scored ideas from prior runs are still buildable.
  }

  // 3-4. Build up to maxBuilds top NEW S/A ideas (1/day by default).
  for (let i = 0; i < maxBuilds; i++) {
    let cand: BuildCandidate | null;
    try {
      cand = await deps.fetchTopCandidate(tenantId);
    } catch (e: any) {
      console.error(`[ideabrowser-autobuild] fetchTopCandidate failed: ${e?.message || e}`);
      result.failed.push({ id: 0, stage: "fetch-candidate", error: e?.message || String(e) });
      break;
    }
    if (!cand) break; // nothing new to build — done.

    if (dryRun) {
      result.built.push({ id: cand.id, name: cand.name, tier: cand.tier, file: "(dry-run)" });
      console.log(`[ideabrowser-autobuild] DRY RUN would build #${cand.id} ${cand.name} (tier ${cand.tier}, composite ${cand.composite})`);
      // In dry-run we cannot mark built, so break to avoid re-picking the same row forever.
      break;
    }

    // Atomically claim BEFORE the expensive LLM call. If a concurrent executor
    // (e.g. a manual run overlapping the heartbeat) already owns this row, skip
    // it and try the next candidate — never burn an LLM call on a double-build.
    let claimed = false;
    try {
      claimed = await deps.claimCandidate(cand.id, tenantId);
    } catch (e: any) {
      console.error(`[ideabrowser-autobuild] claim failed for #${cand.id}: ${e?.message || e}`);
      result.failed.push({ id: cand.id, stage: "claim", error: e?.message || String(e) });
      break; // claim is a DB write; if it errors, stop rather than thrash.
    }
    if (!claimed) {
      console.log(`[ideabrowser-autobuild] #${cand.id} already claimed/built by another executor — skipping`);
      continue; // fetchTopCandidate excludes it next iteration; try the next idea.
    }

    let persistedFile: string | null = null;
    try {
      const pkg = await deps.generatePackage(cand, tenantId);
      if (!pkg.markdown) {
        result.failed.push({ id: cand.id, stage: "generate", error: "empty package" });
        await safeRelease(deps, cand.id, tenantId); // free the claim — retryable next run
        await safeNotify(deps, `IdeaBrowser auto-build: empty package for #${cand.id}`, `${cand.name} produced no output. Left unbuilt for manual review.`);
        break; // don't burn the run re-trying; surface it.
      }
      persistedFile = await deps.persistPackage(cand, pkg.markdown);
      const marked = await deps.markBuilt(cand.id, tenantId, persistedFile, pkg.model);
      if (!marked) {
        // Lost the race between claim and mark (should be rare — we held the
        // claim). Do NOT record as built or notify; another executor shipped it.
        // Clean up the orphan file we just wrote (the winner wrote its own). The
        // winner already dropped the claim, so releaseClaim's CAS would no-op.
        console.warn(`[ideabrowser-autobuild] markBuilt no-op for #${cand.id} (already built by another executor) — not recording`);
        safeUnlink(persistedFile);
        result.failed.push({ id: cand.id, stage: "mark", error: "lost race — already built" });
        continue;
      }
      result.built.push({ id: cand.id, name: cand.name, tier: cand.tier, file: persistedFile });
      console.log(`[ideabrowser-autobuild] ✅ BUILT #${cand.id} ${cand.name} (tier ${cand.tier}) → ${persistedFile}`);
      await safeNotify(
        deps,
        `IdeaBrowser auto-build: shipped wedge package for "${cand.name}"`,
        `Tier ${cand.tier} (composite ${cand.composite}). Build-ready package committed to ${persistedFile}. Review it, then say go to ship the MVP.`,
      );
    } catch (e: any) {
      console.error(`[ideabrowser-autobuild] build failed for #${cand.id}: ${e?.message || e}`);
      result.failed.push({ id: cand.id, stage: "build", error: e?.message || String(e) });
      // Compensate: clean up any file written before the throw, and free the
      // claim so the idea is retryable next run instead of waiting out the 1h
      // stale window. markBuilt never ran (or threw), so the claim is still ours.
      safeUnlink(persistedFile);
      await safeRelease(deps, cand.id, tenantId);
      await safeNotify(deps, `IdeaBrowser auto-build: build failed for #${cand.id}`, `${cand.name}: ${e?.message || e}`);
      break; // fail-closed: stop the run rather than thrash the next candidate.
    }
  }

  console.log(
    `[ideabrowser-autobuild] run complete: ingested=${result.ingested} newProjects=${result.newProjects} built=${result.built.length} failed=${result.failed.length} dryRun=${dryRun}`,
  );
  return result;
}
