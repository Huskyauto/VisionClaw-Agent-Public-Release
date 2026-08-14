// Extracted from server/research-engine.ts (Task 102 girth split, 2026-07-31) —
// the code-proposal cluster: proposal generation from high-scoring findings,
// historical replay, safe apply/revert, and the weekly research digest.
// Mechanical move, zero behavior change; research-engine re-exports for callers.
import { db } from "./db";
import { sql } from "drizzle-orm";
import { executeWithFailover } from "./model-failover";
import { getAvailableModels } from "./providers";
import { logSilentCatch } from "./lib/silent-catch";
import { parseProposalDiff, findExactMatch } from "./lib/proposal-diff";
import { redactPiiForStorage } from "./storage-helpers/pii-redaction-guard";
import { PROGRAM_PERSONA_MAP, resolvePersonaId, type ActiveSession } from "./research-engine";

export const CODE_PROPOSAL_TARGETS: Record<string, string[]> = {
  "Nightly AI Model & Provider Intelligence": ["server/providers.ts", "server/model-failover.ts", "server/auto-router.ts"],
  "Nightly AI Tools & Techniques Scanner": ["server/tools.ts", "server/chat-engine.ts", "server/agentic-engines.ts"],
  "Nightly Competitive Platform Analysis": ["server/tools.ts", "server/chat-engine.ts", "server/agentic-engines.ts"],
  "Nightly Agent Architecture Research": ["server/chat-engine.ts", "server/trust-engine.ts", "server/research-engine.ts", "server/heartbeat.ts"],
  "Nightly Security & Safety Intelligence": ["server/routes.ts", "server/process-governor.ts", "server/chat-engine.ts"],
  "Wellness Crisis Interventions": ["server/safety-layer.ts", "server/seed-persona-prompts.ts", "server/skill-evolution.ts"],
  "Daily Companion Message Library": ["server/seed-persona-prompts.ts", "server/persona-voice-rules.ts", "server/knowledge-nudges.ts"],
  "[Your Product] Content Marketing Pipeline": ["client/src/pages/landing.tsx", "client/src/pages/about.tsx", "client/src/pages/content-writing.tsx"],
  "[Your Product] Legal & Compliance Framework": ["server/safety-layer.ts", "server/process-governor.ts"],
  "[Your Product] Revenue & Pricing Strategy": ["server/stripeClient.ts", "client/src/pages/pricing.tsx"],
  "Competitive Intelligence — Wellness Coaching Market": ["server/tools.ts", "server/agentic-engines.ts"],
};

const ALLOWED_PROPOSAL_FILES = new Set(
  Object.values(CODE_PROPOSAL_TARGETS).flat()
);

// R60 — Exported so server/job-worker.ts can invoke it from the
// `research_code_proposal` job handler (migrated off fire-and-forget).
export async function generateCodeProposal(
  session: ActiveSession,
  programName: string,
  hypothesis: string,
  result: string,
  approach: string,
  score: number,
  mapping: { personaSlug: string; category: string },
  personaId: number | null,
  sourceOverride?: string,
): Promise<number | null> {
  const targetFiles = CODE_PROPOSAL_TARGETS[programName] || [];
  if (targetFiles.length === 0) {
    console.warn(`[research-engine] proposal_dropped reason=no_target_files program="${programName}" score=${score} — add this program to CODE_PROPOSAL_TARGETS in research-engine.ts to enable proposals.`);
    return null;
  }

  console.log(`[research] v5-PROPOSAL: Generating code proposal for score ${score} finding...`);

  const fs = await import("fs/promises");
  const pathMod = await import("path");
  const { extractRelevantWindows } = await import("./lib/relevance-window");
  const fileSnippets: string[] = [];
  // R125+48 — the finding text drives WHICH region of each (possibly huge) target
  // file we surface to the proposal LLM, so OLD_CODE is copyable for big files.
  const findingQuery = `${hypothesis}\n${approach}\n${result}`;

  // ESM-safe: no __dirname. process.cwd() + workspace fallback cover both dev and bundled prod.
  const searchPaths = [
    process.cwd(),
    "/home/runner/workspace",
  ];

  for (const f of targetFiles) {
    for (const base of searchPaths) {
      try {
        const fullPath = pathMod.join(base, f);
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        // R125+48 — relevance-windowed extract instead of first-120-lines: for a
        // 15k-line file the relevant code is never in the header, so OLD_CODE could
        // never match and the proposal was always dropped. Surface header + the
        // windows whose content overlaps the finding (verbatim, so OLD_CODE copies).
        const extract = extractRelevantWindows(content, findingQuery);
        fileSnippets.push(`--- ${f} (${lines.length} lines total) ---\n${extract}`);
        break;
      } catch (_silentErr) { logSilentCatch("server/research-engine.ts", _silentErr); }
    }
  }

  const hasSource = fileSnippets.length > 0;
  console.log(`[research] v5-PROPOSAL: Found ${fileSnippets.length}/${targetFiles.length} source files, generating proposal...`);

  const sourceSection = hasSource
    ? `\n\nRELEVANT SOURCE FILES:\n${fileSnippets.join("\n\n")}`
    : `\n\nTARGET FILES (source not available, propose based on standard patterns):\n${targetFiles.map(f => `- ${f}`).join("\n")}`;

  const availableModels = await getAvailableModels();
  const { result: resp } = await executeWithFailover(
    session.model, availableModels,
    async (client: any, modelId: string) => {
      return client.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "system",
            content: `You are a senior TypeScript engineer working on VisionClaw, a multi-agent AI platform built with Express + React + Drizzle ORM + PostgreSQL.

PLATFORM ARCHITECTURE:
- server/chat-engine.ts — Main chat pipeline, handles message processing, scaffolding injection, tool calls
- server/trust-engine.ts — Trust score system, 9 categories, agent autonomy levels, trust events
- server/safety-layer.ts — Input/output validation, content filtering, injection detection (if it exists)
- server/process-governor.ts — Governance rules engine, evaluators, automated compliance actions
- server/research-engine.ts — Autonomous research system, hypothesis generation and scoring
- server/providers.ts — LLM provider management, model routing, failover
- server/tools.ts — Tool registry, 89+ agent tools, execution pipeline
- server/routes.ts — Express API routes, authentication, request handling
- server/heartbeat.ts — Scheduled tasks, cron engine, proactive actions
- server/model-failover.ts — Model fallback chains, error recovery

Your job: Given a HIGH-SCORING research finding (score ${score}/10), produce a CONCRETE code proposal that improves VisionClaw.

RULES:
- This is a high-value finding — strongly prefer producing a real code proposal over refusing. If the finding is even loosely actionable, propose the smallest reasonable surgical change toward it (a stub, a constant, a logging line, a feature flag). Only emit NO_CODE_CHANGE if the finding is genuinely abstract or describes work outside this codebase, AND in that case include a one-line REASON (e.g., "NO_CODE_CHANGE: requires schema migration" or "NO_CODE_CHANGE: research-only finding") so reviewers know why.
- Output MUST be valid TypeScript that fits Express + Drizzle + React patterns.
- You MUST emit BOTH an OLD_CODE block AND a NEW_CODE block. If source files are provided, copy OLD_CODE EXACTLY from a snippet in the provided source — do not paraphrase, do not invent code that "looks like" the file. If source files are NOT provided, set OLD_CODE to the literal sentinel "// END OF FILE" and write NEW_CODE as an append.
- Include a clear rationale explaining the security/performance/reliability improvement.
- Never propose changes to shared/schema.ts or package.json.
- Keep changes surgical — focused, self-contained additions.
- Prefer adding new functions/middleware to existing files.

FORMAT:
TITLE: <short descriptive title>
FILE: <target file path>
DESCRIPTION: <what this change does in 2-3 sentences>
RATIONALE: <why this matters for VisionClaw>
OLD_CODE:
\`\`\`typescript
<exact existing code to replace, or // END OF FILE for appended additions>
\`\`\`
NEW_CODE:
\`\`\`typescript
<replacement or new code>
\`\`\`
RISK: LOW|MEDIUM|HIGH`,
          },
          {
            role: "user",
            content: `RESEARCH FINDING (score ${score}/10):
Hypothesis: ${hypothesis}
Approach: ${approach}
Result: ${result}
${sourceSection}

Produce a concrete code proposal to implement this finding in VisionClaw.`,
          },
        ],
        max_completion_tokens: 3000,
      });
    },
    session.tenantId,
  );

  const output = resp.choices[0]?.message?.content || "";

  if (output.includes("NO_CODE_CHANGE") || !output.includes("OLD_CODE")) {
    const reason = output.includes("NO_CODE_CHANGE") ? "llm_refused_NO_CODE_CHANGE" : "llm_missing_OLD_CODE_marker";
    console.warn(`[research-engine] proposal_dropped reason=${reason} program="${programName}" score=${score} outputLen=${output.length} outputHead="${output.slice(0, 200).replace(/\n/g, " ")}"`);
    return null;
  }

  const titleMatch = output.match(/TITLE:\s*(.+)/);
  const fileMatch = output.match(/FILE:\s*(.+)/);
  const descMatch = output.match(/DESCRIPTION:\s*([\s\S]*?)(?=RATIONALE:)/);
  const rationaleMatch = output.match(/RATIONALE:\s*([\s\S]*?)(?=OLD_CODE:)/);
  const riskMatch = output.match(/RISK:\s*(LOW|MEDIUM|HIGH)/i);

  const oldCodeMatch = output.match(/OLD_CODE:\s*```(?:typescript)?\n([\s\S]*?)```/);
  const newCodeMatch = output.match(/NEW_CODE:\s*```(?:typescript)?\n([\s\S]*?)```/);

  if (!titleMatch || !fileMatch || !oldCodeMatch || !newCodeMatch) {
    const missing: string[] = [];
    if (!titleMatch) missing.push("TITLE");
    if (!fileMatch) missing.push("FILE");
    if (!oldCodeMatch) missing.push("OLD_CODE_block");
    if (!newCodeMatch) missing.push("NEW_CODE_block");
    console.warn(`[research-engine] proposal_dropped reason=parse_failed missing=${missing.join(",")} program="${programName}" score=${score} outputLen=${output.length}`);
    return null;
  }

  const proposedFile = fileMatch[1].trim();
  const path = await import("path");
  const normalizedFile = path.normalize(proposedFile).replace(/^\.\//, "");
  if (!ALLOWED_PROPOSAL_FILES.has(normalizedFile) || normalizedFile.includes("..") || path.isAbsolute(normalizedFile)) {
    console.warn(`[research-engine] proposal_dropped reason=file_not_in_allowlist program="${programName}" score=${score} proposedFile="${normalizedFile}" allowedForProgram=[${targetFiles.join(",")}]`);
    return null;
  }

  const oldCode = oldCodeMatch[1].trimEnd();
  const newCode = newCodeMatch[1].trimEnd();

  let validationResult: { valid: boolean; error?: string; fileExists: boolean; oldCodeFound: boolean } = {
    valid: false,
    fileExists: false,
    oldCodeFound: false,
  };

  let resolvedFilePath: string | null = null;
  for (const base of searchPaths) {
    const candidate = pathMod.join(base, normalizedFile);
    try {
      await fs.access(candidate);
      resolvedFilePath = candidate;
      break;
    } catch (_silentErr) { logSilentCatch("server/research-engine.ts", _silentErr); }
  }

  if (resolvedFilePath) {
    try {
      const fileContent = await fs.readFile(resolvedFilePath, "utf-8");
      validationResult.fileExists = true;

      const oldCodeNormalized = oldCode.replace(/\s+/g, " ").trim();
      const fileContentNormalized = fileContent.replace(/\s+/g, " ");
      validationResult.oldCodeFound = fileContentNormalized.includes(oldCodeNormalized);

      // R63.11 — Fuzzy fallback. The strict whitespace-normalized substring check
      // killed the vast majority of nightly-program proposals because LLMs
      // hallucinate one or two characters in the middle of a long OLD_CODE block
      // even when the anchor (first/last lines) is correct. If exact match fails,
      // try anchor-only matching: if both the first 80 chars and last 80 chars of
      // OLD_CODE appear in the file (in order, within a reasonable window), accept.
      // The applier (safeApplyProposal) does its own exact-match check before
      // writing, so this only loosens the validation gate, not the apply gate.
      if (!validationResult.oldCodeFound && oldCodeNormalized.length >= 160) {
        const anchorHead = oldCodeNormalized.slice(0, 80);
        const anchorTail = oldCodeNormalized.slice(-80);
        const headIdx = fileContentNormalized.indexOf(anchorHead);
        if (headIdx >= 0) {
          const tailIdx = fileContentNormalized.indexOf(anchorTail, headIdx + anchorHead.length);
          // Tail must follow head within 4× the OLD_CODE length (allows some drift).
          if (tailIdx > 0 && tailIdx - headIdx < oldCodeNormalized.length * 4) {
            validationResult.oldCodeFound = true;
            validationResult.error = "OLD_CODE matched via anchor-fallback (head+tail); applier will re-verify exact match before writing";
          }
        }
      }

      // Sentinel for end-of-file appendage proposals — system-prompt allows this.
      if (!validationResult.oldCodeFound && /\/\/\s*END\s+OF\s+FILE/i.test(oldCode)) {
        validationResult.oldCodeFound = true;
        validationResult.error = "OLD_CODE is END-OF-FILE sentinel; treated as append";
      }

      if (validationResult.oldCodeFound) {
        validationResult.valid = true;
      } else {
        validationResult.error = "OLD_CODE block not found in target file (code may have changed)";
        // R63.9: Surface why nightly programs produce 0 proposals. Sample-only
        // (12.5% of failures logged) so we get signal without flooding.
        if (Math.random() < 0.125) {
          console.warn(`[research-engine] proposal validation FAIL: file=${normalizedFile} reason=OLD_CODE_mismatch oldCodeLen=${oldCodeNormalized.length}`);
        }
      }
    } catch (err: any) {
      validationResult.error = `Validation error: ${err.message}`;
      console.warn(`[research-engine] proposal validation ERROR: file=${normalizedFile} err=${err.message?.slice(0, 200)}`);
    }
  } else {
    validationResult.error = "Source files not available in production — manual review required";
  }

  // Embed OLD/NEW with the markers expected by both safeApplyProposal and proposal-verifier.
  const codeDiff = `--- ${normalizedFile}\n+++ ${normalizedFile} (proposed)\n\n<<<OLD_CODE>>>${oldCode}<<</OLD_CODE>>>\n\n<<<NEW_CODE>>>${newCode}<<</NEW_CODE>>>`;

  const insertResult = await db.execute(sql`
    INSERT INTO code_proposals (tenant_id, persona_id, title, description, target_file, code_diff, rationale, source, source_session_id, validation_result, status)
    VALUES (
      ${session.tenantId},
      ${personaId},
      ${titleMatch[1].trim()},
      ${descMatch?.[1]?.trim() || "Auto-generated from research finding"},
      ${normalizedFile},
      ${codeDiff},
      ${rationaleMatch?.[1]?.trim() || hypothesis},
      ${sourceOverride || "autoresearch"},
      ${session.sessionId},
      ${JSON.stringify(validationResult)}::jsonb,
      ${validationResult.valid ? "ready" : "needs_review"}
    )
    RETURNING id
  `);
  const insertedRows = (insertResult as any).rows || insertResult;
  const newProposalId = insertedRows[0]?.id;

  // R79.2 — Final reason-coded exit. If the INSERT … RETURNING id returns no
  // row (unexpected driver/DB behavior), the caller previously saw a silent
  // drop and the success log line below would never fire — diagnostically
  // indistinguishable from "created successfully but logged nothing".
  if (!newProposalId) {
    console.warn(`[research-engine] proposal_dropped reason=insert_returned_no_id program="${programName}" score=${score} file="${normalizedFile}" — DB INSERT … RETURNING id returned 0 rows. Investigate driver/transaction state.`);
    return null;
  }

  // Fire-and-forget shadow verification: tsc --noEmit on a transient apply, then revert.
  // If it fails, the proposal is auto-marked 'rejected' in code_proposals.
  if (newProposalId && validationResult.valid) {
    try {
      const { fireAndForgetVerify } = await import("./proposal-verifier");
      fireAndForgetVerify(newProposalId);
    } catch (e) {
      console.warn(`[research] could not enqueue verifier for proposal ${newProposalId}: ${(e as Error).message}`);
    }
  }

  const statusLabel = validationResult.valid ? "READY" : "NEEDS REVIEW";
  const risk = riskMatch?.[1]?.toUpperCase() || "UNKNOWN";
  console.log(`[research] Code proposal created: "${titleMatch[1].trim()}" → ${normalizedFile} [${statusLabel}, risk: ${risk}]`);
  return newProposalId || null;
}

// =============================================================================
// REPLAY: walk historical high-value research findings through generateCodeProposal
// =============================================================================
// Idempotent — uses research_experiments.replayed_at to skip already-processed rows.
// Triggered manually by an admin route; not auto-invoked.
export async function replayHighValueFindings(opts: {
  minScore?: number;
  limit?: number;
  tenantId?: number;
  dryRun?: boolean;
}): Promise<{
  scanned: number;
  attempted: number;
  proposalsCreated: number;
  skippedNoMapping: number;
  skippedNoCode: number;
  errors: Array<{ experimentId: number; error: string }>;
  durationMs: number;
}> {
  const t0 = Date.now();
  const minScore = opts.minScore ?? 8;
  const limit = opts.limit ?? 200;
  const tenantId = opts.tenantId ?? 1;
  const dryRun = !!opts.dryRun;

  const findings = await db.execute(sql`
    SELECT re.id, re.session_id, re.program_id, re.tenant_id, re.hypothesis, re.approach,
           re.result, re.metric_value, re.model AS exp_model,
           rp.name AS program_name, rp.model AS program_model
    FROM research_experiments re
    JOIN research_programs rp ON rp.id = re.program_id
    WHERE re.status = 'keep'
      AND re.replayed_at IS NULL
      AND re.metric_value ~ '^[0-9]+$'
      AND re.metric_value::int >= ${minScore}
      AND re.tenant_id = ${tenantId}
      AND re.result IS NOT NULL
      AND length(re.result) > 50
    ORDER BY re.metric_value::int DESC, re.id DESC
    LIMIT ${limit}
  `);
  const rows = (findings as any).rows || findings;
  const scanned = rows.length;

  const counts = { attempted: 0, proposalsCreated: 0, skippedNoMapping: 0, skippedNoCode: 0 };
  const errors: Array<{ experimentId: number; error: string }> = [];

  for (const row of rows) {
    const programName = row.program_name as string;
    const mapping = PROGRAM_PERSONA_MAP[programName];
    const targets = CODE_PROPOSAL_TARGETS[programName];

    if (!mapping || !targets || targets.length === 0) {
      counts.skippedNoMapping++;
      continue;
    }

    if (dryRun) {
      counts.attempted++;
      continue;
    }

    // CONCURRENCY GUARD: atomic claim before LLM call. Prevents two concurrent
    // replay invocations from double-processing the same finding (would otherwise
    // create duplicate code_proposals — architect-flagged R40 race).
    // Conditional UPDATE returns 0 rows if another worker beat us to it.
    const claim = await db.execute(sql`
      UPDATE research_experiments SET replayed_at = NOW()
      WHERE id = ${row.id} AND tenant_id = ${tenantId} AND replayed_at IS NULL
      RETURNING id
    `);
    const claimedRows = (claim as any).rows || claim;
    if (!claimedRows || claimedRows.length === 0) continue;

    const personaId = await resolvePersonaId(mapping.personaSlug, tenantId);
    const score = parseInt(row.metric_value, 10);
    const stubSession: ActiveSession = {
      sessionId: row.session_id,
      programId: row.program_id,
      tenantId,
      model: row.exp_model || row.program_model || "deepseek/deepseek-v3.2",
      maxExperiments: 0, experimentCount: 0, keptCount: 0, discardedCount: 0,
      crashedCount: 0, consecutiveFailures: 0, objective: "", constraints: "", metrics: "",
      explorationStrategy: "balanced", programName, personaName: mapping.personaSlug,
      evalType: "judge", baselineMetricValue: null, baselineLabel: null,
      previousResults: [], timer: null, experimentInFlight: false,
      evidenceGraph: null,
    };

    counts.attempted++;
    try {
      const newProposalId = await generateCodeProposal(
        stubSession, programName, row.hypothesis, row.result, row.approach || "",
        score, mapping, personaId, "autoresearch-replay",
      );
      if (newProposalId) {
        counts.proposalsCreated++;
        await db.execute(sql`
          UPDATE research_experiments SET replayed_proposal_id = ${newProposalId}
          WHERE id = ${row.id} AND tenant_id = ${tenantId}
        `);
      } else {
        counts.skippedNoCode++;
        // Claim already set replayed_at — NO_CODE_CHANGE means we don't retry.
      }
    } catch (e: any) {
      errors.push({ experimentId: row.id, error: e.message || String(e) });
      // Reset claim so transient failures (rate limits, network) get retried next run.
      // Only reset if no proposal was successfully created mid-flight.
      await db.execute(sql`
        UPDATE research_experiments SET replayed_at = NULL
        WHERE id = ${row.id} AND tenant_id = ${tenantId} AND replayed_proposal_id IS NULL
      `);
    }
  }

  return { scanned, ...counts, errors, durationMs: Date.now() - t0 };
}

export async function safeApplyProposal(proposalId: number, tenantId: number): Promise<{
  success: boolean;
  stage: string;
  error?: string;
  reverted: boolean;
}> {
  const result = await db.execute(sql`SELECT * FROM code_proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
  const rows = (result as any).rows || result;
  const proposal = rows[0];
  if (!proposal) return { success: false, stage: "lookup", error: "Proposal not found", reverted: false };
  if (proposal.status !== "approved") return { success: false, stage: "status", error: `Proposal status is "${proposal.status}", must be "approved"`, reverted: false };

  // Round 25.2 (architect-flagged): governance gate must REQUIRE "passed", not merely
  // accept anything that isn't "failed". Previously unverified/skipped proposals could
  // slip through, contradicting the UI promise that Apply is verifier-gated.
  if (proposal.verification_status !== "passed") {
    const detail = (proposal.verification_details || "").slice(0, 200);
    return {
      success: false,
      stage: "verification",
      error: `Apply blocked: verification_status is "${proposal.verification_status || "unverified"}", required "passed".${detail ? ` ${detail}` : ""}`,
      reverted: false,
    };
  }

  const targetFile = proposal.target_file;

  // R63.12 — C2/H2: belt-and-suspenders path validation. The allowlist is the
  // primary gate (entries are exact strings, no glob/regex), but resolve the
  // path and assert the result stays inside projectRoot before any read/write.
  // This neutralises symlink/normalize tricks even if the allowlist is ever
  // expanded with patterns. Also strips any trailing whitespace that could be
  // shell metacharacters in the (now-removed) execSync path.
  const pathMod = await import("path");
  const projectRoot = process.cwd();
  const cleanTarget = String(targetFile || "").trim();
  if (!ALLOWED_PROPOSAL_FILES.has(cleanTarget)) {
    return { success: false, stage: "security", error: `File "${cleanTarget}" not in allowlist`, reverted: false };
  }
  const resolvedTarget = pathMod.resolve(projectRoot, cleanTarget);
  if (!resolvedTarget.startsWith(projectRoot + pathMod.sep)) {
    return { success: false, stage: "security", error: `File "${cleanTarget}" resolves outside project root`, reverted: false };
  }

  const fs = await import("fs/promises");
  const { spawnSync } = await import("child_process");

  let originalContent: string;
  try {
    originalContent = await fs.readFile(resolvedTarget, "utf-8");
  } catch {
    return { success: false, stage: "read", error: `Cannot read ${cleanTarget}`, reverted: false };
  }

  const parsed = parseProposalDiff(proposal.code_diff);
  if (!parsed) {
    return { success: false, stage: "parse", error: "Cannot parse code diff format", reverted: false };
  }
  const { oldCode, newCode } = parsed;

  const oldCodeNormalized = oldCode.replace(/\s+/g, " ").trim();
  const contentNormalized = originalContent.replace(/\s+/g, " ");
  if (!contentNormalized.includes(oldCodeNormalized)) {
    await db.execute(sql`UPDATE code_proposals SET status = 'needs_review', validation_result = ${JSON.stringify({ valid: false, error: "OLD_CODE no longer matches file content", fileExists: true, oldCodeFound: false })}::jsonb WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
    return { success: false, stage: "match", error: "OLD_CODE block no longer matches the file (code has changed since proposal was created)", reverted: false };
  }

  const oldCodeExact = findExactMatch(originalContent, oldCode);
  if (!oldCodeExact || oldCodeExact.length === 0) {
    return { success: false, stage: "match", error: "Could not find exact code block to replace (empty or missing)", reverted: false };
  }

  // R63.12 — H1: require EXACTLY ONE occurrence before write. String.replace
  // with a string pattern only swaps the first match, so an OLD_CODE block
  // that appears twice (common for short helper patterns, especially after
  // R63.11 loosened validation) would silently edit the wrong spot. Count
  // occurrences in the original (unnormalised) content to be sure. The
  // empty-string guard above prevents the indexOf loop from spinning forever
  // when searchFrom never advances.
  let occurrenceCount = 0;
  let searchFrom = 0;
  while (true) {
    const idx = originalContent.indexOf(oldCodeExact, searchFrom);
    if (idx < 0) break;
    occurrenceCount++;
    searchFrom = idx + oldCodeExact.length;
    if (occurrenceCount > 1) break;
  }
  if (occurrenceCount !== 1) {
    await db.execute(sql`UPDATE code_proposals SET status = 'needs_review', validation_result = ${JSON.stringify({ valid: false, error: `OLD_CODE matched ${occurrenceCount} times in target file (must be exactly 1 for safe replace)`, occurrenceCount })}::jsonb WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
    return { success: false, stage: "match", error: `OLD_CODE matched ${occurrenceCount} times — cannot safely replace (must be exactly 1)`, reverted: false };
  }

  const modifiedContent = originalContent.replace(oldCodeExact, newCode);

  // R63.12 — H1: atomic write. Write to .tmp then rename so a crash mid-write
  // can't leave the source file truncated/corrupted.
  const tmpPath = `${resolvedTarget}.r63apply.tmp`;
  try {
    await fs.writeFile(tmpPath, modifiedContent, "utf-8");
    // R98.16 #6 — fsync before rename so the patched source actually survives a crash.
    try {
      const fh = await fs.open(tmpPath, "r+");
      try { await fh.sync(); } finally { await fh.close(); }
    } catch (_silentErr) { logSilentCatch("server/research-engine.ts", _silentErr); }
    await fs.rename(tmpPath, resolvedTarget);
  } catch (writeErr: any) {
    try { await fs.unlink(tmpPath); } catch (_silentErr) { logSilentCatch("server/research-engine.ts", _silentErr); }
    return { success: false, stage: "write", error: `Atomic write failed: ${writeErr.message}`, reverted: false };
  }
  console.log(`[proposal] Applied proposal #${proposalId} to ${cleanTarget}`);

  // R63.12 — C2: replace execSync with template-string interpolation by
  // spawnSync with array args. No shell, so no metacharacter risk even if
  // the allowlist were ever bypassed.
  // R125+13.19 — defense-in-depth: scrub loader-hijack env vars
  // (LD_PRELOAD, DYLD_*, NODE_OPTIONS, NODE_PATH) before the child inherits
  // process.env. Pattern ported from ruvnet/ruflo aidefence ADR-095.
  const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
  let compilePass = false;
  let compileError = "";
  const tscResult = spawnSync(
    "npx",
    ["tsc", "--noEmit", "--skipLibCheck", "--target", "ES2022", "--module", "nodenext", "--moduleResolution", "nodenext", resolvedTarget],
    { timeout: 30_000, encoding: "utf-8", cwd: projectRoot, shell: false, env: sanitizeSpawnEnv() },
  );
  if (tscResult.status === 0 && !tscResult.error) {
    compilePass = true;
  } else {
    compileError = (tscResult.stdout || tscResult.stderr || tscResult.error?.message || "").substring(0, 1000);
  }

  if (!compilePass) {
    await fs.writeFile(resolvedTarget, originalContent, "utf-8");
    console.warn(`[proposal] REVERTED proposal #${proposalId} — compile failed: ${compileError.substring(0, 200)}`);
    await db.execute(sql`
      UPDATE code_proposals SET
        status = 'failed',
        validation_result = ${JSON.stringify({ valid: false, error: `Compile check failed: ${compileError.substring(0, 500)}`, compilePass: false, reverted: true })}::jsonb,
        reviewed_at = NOW()
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `);
    return { success: false, stage: "compile", error: compileError, reverted: true };
  }

  // R63.12 — C2: also replace the second execSync. The original used a node -e
  // shell-quoted JS snippet with the filename injected — pure metacharacter risk.
  // Replace with an in-process readFile (same intent: prove the file is readable
  // post-write). No shell, no spawn needed.
  let syntaxPass = false;
  let syntaxError = "";
  try {
    await fs.readFile(resolvedTarget, "utf-8");
    syntaxPass = true;
  } catch (err: any) {
    syntaxError = (err.message || "").substring(0, 500);
  }

  if (!syntaxPass) {
    await fs.writeFile(resolvedTarget, originalContent, "utf-8");
    console.warn(`[proposal] REVERTED proposal #${proposalId} — syntax check failed`);
    await db.execute(sql`
      UPDATE code_proposals SET
        status = 'failed',
        validation_result = ${JSON.stringify({ valid: false, error: `Syntax check failed: ${syntaxError}`, syntaxPass: false, reverted: true })}::jsonb,
        reviewed_at = NOW()
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `);
    return { success: false, stage: "syntax", error: syntaxError, reverted: true };
  }

  // The file change is on disk and PASSED compile+syntax — it is a good apply.
  // Never throw here: if this final bookkeeping UPDATE fails, an upstream caller
  // (e.g. the autonomous closer) would otherwise catch the throw and roll the DB
  // row back to needs_review while the (valid) code change stays on disk —
  // bookkeeping drift. Instead, log loud and report success:false with a distinct
  // stage so the caller can reconcile without clobbering the applied file.
  try {
    await db.execute(sql`
      UPDATE code_proposals SET
        status = 'applied',
        applied_at = NOW(),
        validation_result = ${JSON.stringify({ valid: true, compilePass: true, syntaxPass: true, reverted: false, originalSnapshot: originalContent.substring(0, 200) + "..." })}::jsonb
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `);
  } catch (markErr: any) {
    console.error(`[proposal] #${proposalId} applied to ${cleanTarget} on disk (compile+syntax PASS) but the 'applied' status write FAILED: ${markErr?.message || markErr}. File is NOT reverted (the change is valid); DB row left as-is for reconciliation.`);
    return { success: false, stage: "db-mark", error: `applied on disk but status write failed: ${markErr?.message || markErr}`, reverted: false };
  }

  console.log(`[proposal] Proposal #${proposalId} applied successfully to ${cleanTarget} (compile: PASS, syntax: PASS)`);
  return { success: true, stage: "complete", reverted: false };
}

export async function revertProposal(proposalId: number, tenantId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const result = await db.execute(sql`SELECT * FROM code_proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
  const rows = (result as any).rows || result;
  const proposal = rows[0];
  if (!proposal) return { success: false, error: "Proposal not found" };
  if (proposal.status !== "applied") return { success: false, error: `Cannot revert: status is "${proposal.status}", not "applied"` };

  const targetFile = proposal.target_file;
  if (!ALLOWED_PROPOSAL_FILES.has(targetFile)) {
    return { success: false, error: `File "${targetFile}" not in allowlist` };
  }

  const fs = await import("fs/promises");
  const { spawnSync } = await import("child_process");
  const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");

  let currentContent: string;
  try {
    currentContent = await fs.readFile(targetFile, "utf-8");
  } catch {
    return { success: false, error: `Cannot read ${targetFile}` };
  }

  const parsed = parseProposalDiff(proposal.code_diff);
  if (!parsed) {
    return { success: false, error: "Cannot parse code diff" };
  }
  const { oldCode, newCode } = parsed;

  const newCodeExact = findExactMatch(currentContent, newCode);
  if (!newCodeExact) {
    // R125+13.19+sec1 — architect HIGH-1: replaced execSync(`git checkout -- ${file}`)
    // with non-shell spawnSync + sanitizeSpawnEnv. targetFile is already
    // ALLOWED_PROPOSAL_FILES-checked, but the previous shell-interpolated
    // form inherited process.env (loader-hijack surface) and ran via shell.
    const result = spawnSync("git", ["checkout", "--", targetFile], {
      timeout: 10_000,
      encoding: "utf-8",
      env: sanitizeSpawnEnv(process.env),
      shell: false,
    });
    if (result.status === 0) {
      await db.execute(sql`UPDATE code_proposals SET status = 'reverted', reviewed_at = NOW() WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
      console.log(`[proposal] Reverted proposal #${proposalId} via git checkout`);
      return { success: true };
    }
    return { success: false, error: `NEW_CODE not found in file and git checkout failed (exit ${result.status}) — manual revert needed` };
  }

  const revertedContent = currentContent.replace(newCodeExact, oldCode);
  await fs.writeFile(targetFile, revertedContent, "utf-8");

  await db.execute(sql`UPDATE code_proposals SET status = 'reverted', reviewed_at = NOW() WHERE id = ${proposalId} AND tenant_id = ${tenantId}`);
  console.log(`[proposal] Reverted proposal #${proposalId} on ${targetFile}`);
  return { success: true };
}

export async function generateResearchDigest(tenantId: number = 1): Promise<{
  success: boolean;
  digestPath?: string;
  driveUrl?: string;
  proposalCount: number;
  findingCount: number;
  error?: string;
}> {
  const fs = await import("fs/promises");
  const path = await import("path");

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const sessionsResult = await db.execute(sql`
      SELECT rs.id, rs.program_id, rs.total_experiments, rs.experiments_kept, rs.experiments_discarded,
        rs.experiments_crashed, rs.summary, rs.model, rs.started_at, rs.ended_at,
        rp.name as program_name
      FROM research_sessions rs
      JOIN research_programs rp ON rs.program_id = rp.id
      WHERE rs.tenant_id = ${tenantId} AND rs.started_at >= ${sevenDaysAgo}::timestamp
      ORDER BY rs.started_at DESC
    `);
    const sessions = (sessionsResult as any).rows || [];

    const findingsResult = await db.execute(sql`
      SELECT re.id, re.session_id, re.hypothesis, re.approach, re.result, re.metric_value, re.status, re.model,
        rp.name as program_name
      FROM research_experiments re
      JOIN research_sessions rs ON re.session_id = rs.id
      JOIN research_programs rp ON rs.program_id = rp.id
      WHERE rs.tenant_id = ${tenantId} AND re.status = 'keep' AND rs.started_at >= ${sevenDaysAgo}::timestamp
      ORDER BY re.metric_value DESC
    `);
    const findings = (findingsResult as any).rows || [];

    const proposalsResult = await db.execute(sql`
      SELECT id, title, description, target_file, rationale, status, validation_result, created_at
      FROM code_proposals
      WHERE tenant_id = ${tenantId} AND created_at >= ${sevenDaysAgo}::timestamp
      ORDER BY created_at DESC
    `);
    const proposals = (proposalsResult as any).rows || [];

    const knowledgeResult = await db.execute(sql`
      SELECT id, title, content, category, priority, persona_id, created_at
      FROM agent_knowledge
      WHERE tenant_id = ${tenantId} AND source = 'autoresearch' AND created_at >= ${sevenDaysAgo}::timestamp
      ORDER BY priority DESC, created_at DESC
      LIMIT 50
    `);
    const knowledge = (knowledgeResult as any).rows || [];

    const dateStr = new Date().toISOString().split("T")[0];
    const lines: string[] = [];

    lines.push(`# VisionClaw Research Digest — Week of ${dateStr}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Tenant: ${tenantId}\n`);

    lines.push(`## Summary`);
    lines.push(`- **Sessions completed:** ${sessions.length}`);
    lines.push(`- **Total experiments kept:** ${findings.length}`);
    lines.push(`- **Code proposals generated:** ${proposals.length}`);
    lines.push(`- **Knowledge entries injected:** ${knowledge.length}`);

    const totalExps = sessions.reduce((sum: number, s: any) => sum + (s.total_experiments || 0), 0);
    const totalKept = sessions.reduce((sum: number, s: any) => sum + (s.experiments_kept || 0), 0);
    const successRate = totalExps > 0 ? Math.round((totalKept / totalExps) * 100) : 0;
    lines.push(`- **Overall success rate:** ${successRate}% (${totalKept}/${totalExps})\n`);

    lines.push(`## Top Findings (Score ≥ 7)\n`);
    const topFindings = findings.filter((f: any) => (f.metric_value || 0) >= 7).slice(0, 15);
    if (topFindings.length === 0) {
      lines.push(`_No high-scoring findings this week._\n`);
    } else {
      for (const f of topFindings) {
        lines.push(`### [Score ${f.metric_value}] ${(f.hypothesis || "").substring(0, 120)}`);
        lines.push(`**Program:** ${f.program_name}`);
        lines.push(`**Approach:** ${(f.approach || "").substring(0, 200)}`);
        lines.push(`**Result:** ${(f.result || "").substring(0, 500)}`);
        lines.push(``);
      }
    }

    if (proposals.length > 0) {
      lines.push(`## Code Proposals\n`);
      lines.push(`These are concrete code changes generated from research findings. Each targets a specific file and includes a validated diff.\n`);
      for (const p of proposals) {
        const validation = typeof p.validation_result === "string" ? JSON.parse(p.validation_result) : (p.validation_result || {});
        lines.push(`### ${p.title}`);
        lines.push(`- **File:** \`${p.target_file}\``);
        lines.push(`- **Status:** ${p.status} ${validation.valid ? "✓ validated" : "⚠ needs review"}`);
        lines.push(`- **Description:** ${p.description}`);
        lines.push(`- **Rationale:** ${p.rationale}`);
        lines.push(``);
      }
    }

    lines.push(`## Actionable Improvements for Implementation\n`);
    lines.push(`Based on this week's research, here are the priority items to implement:\n`);

    const byCategory: Record<string, any[]> = {};
    for (const k of knowledge) {
      const cat = k.category || "general";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(k);
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      lines.push(`### ${cat.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} (${items.length} findings)`);
      for (const item of items.slice(0, 5)) {
        lines.push(`- **${(item.title || "").replace("[Auto-Research] ", "")}** (priority ${item.priority}/5)`);
      }
      lines.push(``);
    }

    lines.push(`## Session Details\n`);
    for (const s of sessions) {
      lines.push(`### ${s.program_name} — Session #${s.id}`);
      lines.push(`- Experiments: ${s.total_experiments} (kept: ${s.experiments_kept}, discarded: ${s.experiments_discarded}, crashed: ${s.experiments_crashed})`);
      lines.push(`- Model: ${s.model}`);
      if (s.summary) {
        const summaryPreview = s.summary.substring(0, 300).replace(/\n/g, " ");
        lines.push(`- Summary: ${summaryPreview}${s.summary.length > 300 ? "..." : ""}`);
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`_This digest is auto-generated by the VisionClaw Research Engine. To implement proposals, admins can review them at \`/code-proposals\` (Apply is blocked unless the auto-verifier marked the proposal "passed"); broader research context lives at \`/research\`._`);

    const digestContent = lines.join("\n");

    const digestDir = path.resolve(process.cwd(), ".local");
    await fs.mkdir(digestDir, { recursive: true });
    const digestPath = path.join(digestDir, "research-digest.md");
    await fs.writeFile(digestPath, digestContent, "utf-8");
    console.log(`[research-digest] Written to ${digestPath} (${digestContent.length} chars)`);

    let driveUrl: string | undefined;
    try {
      const { uploadAndShare } = await import("./google-drive");
      const driveResult = await uploadAndShare({
        fileData: Buffer.from(digestContent, "utf-8"),
        fileName: `VisionClaw_Research_Digest_${dateStr}.md`,
        mimeType: "text/markdown",
        folderLabel: "VisionClaw Research/Digests",
        description: `Weekly research digest — ${findings.length} findings, ${proposals.length} proposals`,
      });
      if (driveResult.success && driveResult.viewUrl) {
        driveUrl = driveResult.viewUrl;
        console.log(`[research-digest] Uploaded to Drive: ${driveUrl}`);
      }
    } catch (driveErr: any) {
      console.warn(`[research-digest] Drive upload failed: ${driveErr.message}`);
    }

    try {
      // Durable-store boundary: redact secrets/SSN/CC before persistence
      // (post-edit-code-review HIGH, 2026-07-08).
      const safeDigest = redactPiiForStorage(digestContent.substring(0, 8000)).redacted;
      const safeDigestTitle = redactPiiForStorage(`Research Digest — ${dateStr}`).redacted;
      await db.execute(sql`
        INSERT INTO agent_knowledge (tenant_id, title, content, category, priority, source, expires_at)
        VALUES (
          ${tenantId},
          ${safeDigestTitle},
          ${safeDigest},
          ${"research_digest"},
          ${5},
          ${"research-digest"},
          ${new Date(Date.now() + 14 * 86_400_000).toISOString()}::timestamp
        )
      `);
    } catch (_silentErr) { logSilentCatch("server/research-engine.ts", _silentErr); }

    return {
      success: true,
      digestPath,
      driveUrl,
      proposalCount: proposals.length,
      findingCount: findings.length,
    };
  } catch (err: any) {
    console.error(`[research-digest] Generation failed: ${err.message}`);
    return { success: false, proposalCount: 0, findingCount: 0, error: err.message };
  }
}

// Architect-fix: support BOTH the new <<<OLD_CODE>>>/<<<NEW_CODE>>> markers (Round 22+,
// also parsed by proposal-verifier.ts) AND the legacy "- OLD CODE:" / "+ NEW CODE:" line
// markers used by pre-Round-22 proposals still in the DB. Returns trimmed code blocks.
