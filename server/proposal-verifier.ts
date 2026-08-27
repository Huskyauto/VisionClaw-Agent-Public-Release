import { db } from "./db";
import { sql } from "drizzle-orm";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

import { logSilentCatch } from "./lib/silent-catch";
export interface VerifyResult {
  status: "passed" | "failed" | "skipped";
  details: string;
  durationMs: number;
}

const MAX_DIFF_LINES = 800;

// R72.A (was carry-forward R42): the verifier no longer touches the live
// working tree. Previously it wrote the patched file to disk, ran tsc, then
// restored — a window where a process crash, workflow restart, race with the
// Auto Git Push workflow, or a concurrent edit by Bob could leave the live
// file stuck in a half-applied state and contaminate subsequent proposals'
// OLD_CODE anchors. R56 measured 12/14 proposals stuck on "drift" precisely
// because of this corruption window.
//
// New design: read the live file READ-ONLY, apply the patch in memory, hand
// the patched string to the TypeScript Compiler API via a custom CompilerHost
// that returns the patched content for that one file. The live tree is never
// written to. Process crashes leave nothing to restore. No git worktree
// needed (worktree creation is sandbox-blocked anyway). Single source of
// truth: tsc reads everything else fresh from disk on every run.

export async function verifyProposalById(proposalId: number): Promise<VerifyResult> {
  const t0 = Date.now();
  const r = await db.execute(sql`SELECT id, target_file, code_diff, validation_result, description, rationale FROM code_proposals WHERE id = ${proposalId}`);
  const rows = (r as any).rows || r;
  const proposal = rows[0];
  if (!proposal) {
    return { status: "skipped", details: "proposal not found", durationMs: Date.now() - t0 };
  }

  const targetFile: string = proposal.target_file;
  const codeDiff: string = proposal.code_diff || "";

  const oldMatch = codeDiff.match(/<<<OLD_CODE>>>([\s\S]*?)<<<\/OLD_CODE>>>/);
  const newMatch = codeDiff.match(/<<<NEW_CODE>>>([\s\S]*?)<<<\/NEW_CODE>>>/);
  if (!oldMatch || !newMatch) {
    const details = "diff missing OLD_CODE / NEW_CODE markers";
    await persist(proposalId, "skipped", details);
    return { status: "skipped", details, durationMs: Date.now() - t0 };
  }
  let oldCode = oldMatch[1];
  let newCode = newMatch[1];

  const diffLineCount = (oldCode.split("\n").length + newCode.split("\n").length);
  if (diffLineCount > MAX_DIFF_LINES) {
    const details = `diff too large (${diffLineCount} lines > ${MAX_DIFF_LINES}), refusing to verify`;
    await persist(proposalId, "skipped", details);
    return { status: "skipped", details, durationMs: Date.now() - t0 };
  }

  const repoRoot = process.cwd();
  const absTarget = path.isAbsolute(targetFile) ? targetFile : path.join(repoRoot, targetFile);
  const resolved = path.resolve(absTarget);

  // Safety: never read anything outside the repo root.
  if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
    const details = `target path outside repo: ${targetFile}`;
    await persist(proposalId, "skipped", details);
    return { status: "skipped", details, durationMs: Date.now() - t0 };
  }

  let liveContent: string;
  try {
    liveContent = await fs.readFile(resolved, "utf-8");
  } catch (e) {
    const details = `cannot read target file: ${(e as Error).message}`;
    await persist(proposalId, "skipped", details);
    return { status: "skipped", details, durationMs: Date.now() - t0 };
  }

  let patchedContent: string;
  if (liveContent.includes(oldCode)) {
    patchedContent = liveContent.replace(oldCode, newCode);
  } else {
    // Drift detected — attempt one-shot LLM rebase. Gated by validation_result.rebased_at
    // so we never re-rebase a proposal that already had its shot.
    const alreadyRebased = String(proposal.validation_result?.rebased_at || "").length > 0;
    const rebased = alreadyRebased ? null : await attemptRebaseOnDrift(
      proposalId, resolved, oldCode, newCode, proposal,
    );
    if (!rebased) {
      const details = "OLD_CODE no longer matches file content (drift)";
      await persist(proposalId, "skipped", details);
      return { status: "skipped", details, durationMs: Date.now() - t0 };
    }
    oldCode = rebased.oldCode;
    newCode = rebased.newCode;
    // Re-read live content (rebase used the same fresh content but be defensive
    // in case Bob saved between the rebase prompt and now).
    liveContent = await fs.readFile(resolved, "utf-8");
    if (!liveContent.includes(oldCode)) {
      // Architect-fix: this is a file-system race (Bob saved between rebase and
      // re-read), NOT an LLM failure. Clear rebased_at so the next verify run
      // can rebase again — otherwise the alreadyRebased gate would lock this
      // proposal in "stuck" state forever even though no successful verify
      // ever ran. Outcome marked 'race_after_rebase' for forensics.
      try {
        await db.execute(sql`
          UPDATE code_proposals
          SET validation_result = COALESCE(validation_result, '{}'::jsonb)
            - 'rebased_at'
            || jsonb_build_object('last_race_at', NOW()::text, 'rebase_outcome', 'race_after_rebase')
          WHERE id = ${proposalId}
        `);
      } catch (e) {
        console.error(`[proposal-verifier] failed to clear rebased_at after race: ${(e as Error).message}`);
      }
      const details = "rebased OLD_CODE drifted again before in-memory apply (rebase gate cleared for retry)";
      await persist(proposalId, "skipped", details);
      return { status: "skipped", details, durationMs: Date.now() - t0 };
    }
    patchedContent = liveContent.replace(oldCode, newCode);
  }

  let tscResult: { errors: string[] };
  try {
    tscResult = await runTscWithOverride(resolved, patchedContent);
  } catch (e) {
    const details = `in-memory tsc crashed: ${(e as Error).message}`;
    await persist(proposalId, "failed", details);
    return { status: "failed", details, durationMs: Date.now() - t0 };
  }

  if (tscResult.errors.length === 0) {
    // R125+13.24 — SIA-inspired held-out eval gate (arXiv:2605.27276). tsc is
    // the VISIBLE verifier the fix-writer optimizes toward; the cheapest way to
    // make it green is often to ERODE what verifies (delete a test, .skip it,
    // strip a sanitizer/tenant filter). This held-out check set — which the
    // fix-writer's prompt never contains — runs AFTER tsc to catch that gaming.
    // Fail-OPEN: a buggy/throwing gate must never stall the pipeline.
    let heldOut: import("./safety/held-out-eval-gate").HeldOutEvalResult | null = null;
    try {
      const { heldOutEvalGate } = await import("./safety/held-out-eval-gate");
      heldOut = heldOutEvalGate({ targetFile, oldCode, newCode });
    } catch (e) {
      console.warn(`[proposal-verifier] held-out eval gate threw (failing open): ${(e as Error).message}`);
    }
    if (heldOut && !heldOut.passed) {
      const details = `held-out eval gate BLOCKED (SIA Goodhart guard, mode=${heldOut.mode}): ${heldOut.violations.join("; ")}`.slice(0, 4000);
      await persist(proposalId, "failed", details);
      return { status: "failed", details, durationMs: Date.now() - t0 };
    }
    const warnNote = heldOut && heldOut.severity === "warn" && heldOut.violations.length
      ? ` [held-out warn: ${heldOut.violations.join("; ")}]`
      : "";
    const details = `tsc --noEmit OK (in-memory, ${Math.round((Date.now() - t0) / 1000)}s)${warnNote}`.slice(0, 4000);
    await persist(proposalId, "passed", details);
    return { status: "passed", details, durationMs: Date.now() - t0 };
  }
  const errSnippet = tscResult.errors.slice(0, 30).join("\n").slice(0, 3500);
  const details = `tsc --noEmit FAILED (${tscResult.errors.length} errors). First errors:\n${errSnippet}`;
  await persist(proposalId, "failed", details);
  return { status: "failed", details, durationMs: Date.now() - t0 };
}

// In-memory tsc check: load the project's tsconfig, build a CompilerHost that
// returns `patchedContent` for the single overridden file path, and let
// ts.getPreEmitDiagnostics walk the program. Everything else (other source
// files, node_modules, lib.d.ts) is read fresh from disk on every call.
async function runTscWithOverride(absTargetFile: string, patchedContent: string): Promise<{ errors: string[] }> {
  const ts = await import("typescript");
  const repoRoot = process.cwd();

  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");

  const configJson = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configJson.error) {
    throw new Error(`tsconfig parse error: ${ts.flattenDiagnosticMessageText(configJson.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configJson.config, ts.sys, repoRoot);
  if (parsed.errors.length) {
    const msg = parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("; ");
    throw new Error(`tsconfig load errors: ${msg.slice(0, 400)}`);
  }

  // Force noEmit + disable incremental cache writes so we never poison
  // ./node_modules/typescript/tsbuildinfo with patched-file metadata.
  const options = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined };

  const host = ts.createCompilerHost(options);

  // Architect-fix: canonical path matching. `path.resolve` alone misses
  // case-only variants on case-insensitive FS, symlink redirections, and
  // any edge where TS asks for the file via a different-but-equivalent
  // path. Use TS's own canonical-name semantics + realpath where possible.
  const canonical = (p: string): string => {
    let resolved = path.resolve(p);
    try { resolved = fsSync.realpathSync(resolved); } catch (_silentErr) { logSilentCatch("server/proposal-verifier.ts", _silentErr); }
    return host.getCanonicalFileName(resolved);
  };
  const overrideCanonical = canonical(absTargetFile);

  const origReadFile = host.readFile.bind(host);
  host.readFile = (fileName: string) => {
    if (canonical(fileName) === overrideCanonical) return patchedContent;
    return origReadFile(fileName);
  };
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (canonical(fileName) === overrideCanonical) {
      return ts.createSourceFile(fileName, patchedContent, languageVersion, true);
    }
    return origGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  // tsconfig's `include` glob should already cover the target, but if a
  // proposal targets an unusual path (e.g., a script), make sure it's seeded
  // into the program so the override actually takes effect.
  const fileNames = parsed.fileNames.some(f => canonical(f) === overrideCanonical)
    ? parsed.fileNames
    : [...parsed.fileNames, absTargetFile];

  const program = ts.createProgram(fileNames, options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const errors: string[] = [];
  for (const d of diagnostics) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const rel = path.relative(repoRoot, d.file.fileName);
      errors.push(`${rel}(${line + 1},${character + 1}): error TS${d.code}: ${msg}`);
    } else {
      errors.push(`error TS${d.code}: ${msg}`);
    }
  }
  return { errors };
}

async function persist(proposalId: number, status: string, details: string): Promise<void> {
  try {
    // Architect-fix: do NOT clobber proposal.status; verification is a sidecar signal
    // consumed by safeApplyProposal's guard. Reviewer/owner controls lifecycle status.
    await db.execute(sql`
      UPDATE code_proposals
      SET verification_status = ${status},
          verification_details = ${details.slice(0, 4000)},
          verified_at = NOW()
      WHERE id = ${proposalId}
    `);
  } catch (e) {
    console.error(`[proposal-verifier] failed to persist verification: ${(e as Error).message}`);
  }

  // Attention Bus v0: publish verifier failure so the owner is woken when an
  // autoresearch proposal can't pass tsc. Passes are not noisy on purpose.
  if (status === "failed") {
    try {
      const { emitEvent } = await import("./event-bus");
      await emitEvent({
        type: "research.experiment.failed",
        source: "proposal-verifier",
        tenantId: 1,
        data: {
          proposalId,
          stage: "tsc_noemit",
          detailsSnippet: details.slice(0, 500),
        },
      });
    } catch (e: any) {
      console.warn(`[proposal-verifier] attention-bus publish failed (non-fatal): ${e.message}`);
    }
  }
}

// Architect-fix: serialize verifier runs. Even though we no longer write to
// disk, the in-memory tsc program load is multi-hundred-MB and concurrent runs
// would balloon RSS unnecessarily.
const verifyQueue: Array<() => Promise<void>> = [];
let verifyQueueRunning = false;
async function pumpVerifyQueue(): Promise<void> {
  if (verifyQueueRunning) return;
  verifyQueueRunning = true;
  try {
    while (verifyQueue.length) {
      const job = verifyQueue.shift()!;
      try { await job(); } catch (e) { console.error(`[proposal-verifier] queue job error: ${(e as Error).message}`); }
    }
  } finally {
    verifyQueueRunning = false;
  }
}

// R45.B: rebase a stale proposal's OLD_CODE/NEW_CODE against current file content.
// One LLM call per proposal lifetime (gated by validation_result.rebased_at).
async function attemptRebaseOnDrift(
  proposalId: number,
  resolvedFilePath: string,
  staleOldCode: string,
  staleNewCode: string,
  proposal: any,
): Promise<{ oldCode: string; newCode: string } | null> {
  try {
    const currentContent = await fs.readFile(resolvedFilePath, "utf-8");
    const fileForPrompt = currentContent.length > 18000
      ? currentContent.slice(0, 18000) + "\n... (truncated)"
      : currentContent;

    const { executeWithFailover } = await import("./model-failover");
    const { getAvailableModels } = await import("./providers");
    const availableModels = await getAvailableModels();

    const intentDescription = String(proposal.description || "").slice(0, 500);
    const intentRationale = String(proposal.rationale || "").slice(0, 500);

    const { result: resp } = await executeWithFailover(
      "deepseek/deepseek-v3.2", availableModels,
      async (client: any, modelId: string) => client.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are a code-rebase assistant. A previously generated code proposal has gone stale: its OLD_CODE block no longer matches the current file content. Your job is to produce FRESH OLD_CODE and NEW_CODE blocks that:
1. Preserve the original INTENT of the change
2. Anchor to code that EXISTS in the current file (verbatim)
3. Apply cleanly when the OLD_CODE is replaced by NEW_CODE

Output format (exactly):
OLD_CODE:
\`\`\`typescript
<exact substring of current file content>
\`\`\`
NEW_CODE:
\`\`\`typescript
<replacement>
\`\`\`

If the change is no longer applicable (e.g., the feature was already added), output exactly: NO_LONGER_APPLICABLE`,
          },
          {
            role: "user",
            content: `INTENT (description): ${intentDescription}
INTENT (rationale): ${intentRationale}

ORIGINAL stale OLD_CODE:
\`\`\`
${staleOldCode.slice(0, 2000)}
\`\`\`

ORIGINAL stale NEW_CODE:
\`\`\`
${staleNewCode.slice(0, 2000)}
\`\`\`

CURRENT file content (${resolvedFilePath}):
\`\`\`
${fileForPrompt}
\`\`\`

Produce fresh OLD_CODE/NEW_CODE blocks anchored to the CURRENT file content.`,
          },
        ],
        max_completion_tokens: 2000,
      }),
      1,
    );

    const output = resp.choices[0]?.message?.content || "";
    if (output.includes("NO_LONGER_APPLICABLE")) {
      console.log(`[proposal-verifier] rebase: proposal ${proposalId} no longer applicable, marking for cleanup`);
      await db.execute(sql`
        UPDATE code_proposals
        SET status = 'rejected',
            verification_status = 'skipped',
            verification_details = '[REBASE] LLM determined change is no longer applicable to current code',
            verified_at = NOW(),
            validation_result = COALESCE(validation_result, '{}'::jsonb) || jsonb_build_object('rebased_at', NOW()::text, 'rebase_outcome', 'no_longer_applicable')
        WHERE id = ${proposalId}
      `);
      return null;
    }

    const oldM = output.match(/OLD_CODE:\s*```(?:typescript)?\n([\s\S]*?)```/);
    const newM = output.match(/NEW_CODE:\s*```(?:typescript)?\n([\s\S]*?)```/);
    if (!oldM || !newM) {
      console.warn(`[proposal-verifier] rebase: proposal ${proposalId} LLM returned malformed response`);
      return null;
    }

    const newOldCode = oldM[1].trimEnd();
    const newNewCode = newM[1].trimEnd();

    if (!currentContent.includes(newOldCode)) {
      console.warn(`[proposal-verifier] rebase: proposal ${proposalId} new OLD_CODE still doesn't match current file (LLM hallucinated)`);
      await db.execute(sql`
        UPDATE code_proposals
        SET validation_result = COALESCE(validation_result, '{}'::jsonb) || jsonb_build_object('rebased_at', NOW()::text, 'rebase_outcome', 'hallucinated')
        WHERE id = ${proposalId}
      `);
      return null;
    }

    // Persist the rebased diff back to the proposal so safeApplyProposal sees fresh anchors.
    const targetFileRel = String(proposal.target_file);
    const newCodeDiff = `--- ${targetFileRel}\n+++ ${targetFileRel} (proposed, rebased)\n\n<<<OLD_CODE>>>${newOldCode}<<</OLD_CODE>>>\n\n<<<NEW_CODE>>>${newNewCode}<<</NEW_CODE>>>`;

    await db.execute(sql`
      UPDATE code_proposals
      SET code_diff = ${newCodeDiff},
          validation_result = COALESCE(validation_result, '{}'::jsonb) || jsonb_build_object('rebased_at', NOW()::text, 'rebase_outcome', 'success')
      WHERE id = ${proposalId}
    `);
    console.log(`[proposal-verifier] rebase: proposal ${proposalId} rebased successfully`);
    return { oldCode: newOldCode, newCode: newNewCode };
  } catch (e: any) {
    console.warn(`[proposal-verifier] rebase: proposal ${proposalId} crashed: ${e.message}`);
    return null;
  }
}

export function fireAndForgetVerify(proposalId: number): void {
  verifyQueue.push(async () => {
    try {
      const r = await verifyProposalById(proposalId);
      console.log(`[proposal-verifier] proposal ${proposalId}: ${r.status} (${r.durationMs}ms) — ${r.details.slice(0, 120)}`);
    } catch (e) {
      console.error(`[proposal-verifier] proposal ${proposalId}: unhandled — ${(e as Error).message}`);
    }
  });
  setImmediate(pumpVerifyQueue);
}
