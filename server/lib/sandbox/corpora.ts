/**
 * Simulation Sandbox — replay corpora loaders (Slice S2).
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * Safety corpus: historical `security_intent_checks` rows. Replayable content:
 * the stored destyled `literal_intent` (present on BLOCK rows only — ALLOW
 * rows deliberately store NULL for PII reasons, see intent-gate.ts). Rows
 * without recoverable content are skipped and counted, never guessed.
 *
 * Conversation corpus (S3): sampled historical assistant turns with their
 * preceding context — replayed under a model override for similarity + cost
 * deltas. Orchestration corpus (S3): recorded orchestrator-ledger runs
 * (memory_entries category='orchestrator_ledger') — planner behavior under a
 * different model.
 */
import { pool } from "../../db";

export interface SafetyCorpusItem {
  /** "security_intent_checks:<id>" — stable reference for the result row. */
  itemRef: string;
  /** The content to replay through the gate. */
  content: string;
  /** Historical outcome. */
  baseline: {
    action: "allow" | "block";
    flaggedCategories: string[];
    classifier: string | null;
    personaId: number | null;
    source: string;
    createdAt: string;
  };
}

export interface SafetyCorpus {
  items: SafetyCorpusItem[];
  /** Rows matching the filter that had no replayable content (NULL literal_intent). */
  skippedNoContent: number;
  totalCandidates: number;
}

/**
 * Load up to `sampleSize` most-recent replayable safety rows for a tenant.
 * Tenant-scoped in the SQL itself (tenant isolation invariant).
 */
export async function loadSafetyCorpus(tenantId: number, sampleSize: number): Promise<SafetyCorpus> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`loadSafetyCorpus: invalid tenantId ${tenantId}`);
  const cap = Math.max(1, Math.min(Math.floor(sampleSize), 1000));

  const counts = await pool.query(
    `SELECT count(*)::int AS total, count(literal_intent)::int AS replayable
       FROM security_intent_checks WHERE tenant_id = $1`,
    [tenantId],
  );
  const total = counts.rows[0]?.total ?? 0;
  const replayable = counts.rows[0]?.replayable ?? 0;

  const res = await pool.query(
    `SELECT id, literal_intent, flagged_categories, action, classifier, persona_id, source, created_at
       FROM security_intent_checks
      WHERE tenant_id = $1 AND literal_intent IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, cap],
  );

  const items: SafetyCorpusItem[] = res.rows.map((r: any) => ({
    itemRef: `security_intent_checks:${r.id}`,
    content: String(r.literal_intent),
    baseline: {
      action: r.action === "block" ? "block" : "allow",
      flaggedCategories: Array.isArray(r.flagged_categories) ? r.flagged_categories : [],
      classifier: r.classifier ?? null,
      personaId: r.persona_id ?? null,
      source: r.source ?? "chat",
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    },
  }));

  return { items, skippedNoContent: total - replayable, totalCandidates: total };
}

// ── Model-swap corpora (S3) ────────────────────────────────────────────────

/** Generic item replayed under a model override: a chat prompt + the
 * historical output it produced (the similarity baseline). */
export interface ModelSwapCorpusItem {
  itemRef: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  baselineOutput: string;
  personaId: number | null;
}

export interface ModelSwapCorpus {
  items: ModelSwapCorpusItem[];
  /** Candidates that had no usable prompt/output (skipped, counted, never guessed). */
  skippedNoContent: number;
  totalCandidates: number;
}

/** Max preceding messages included as prompt context per conversation item. */
const CONV_CONTEXT_MESSAGES = 6;
/** Per-message content clamp — keeps replay prompts bounded. */
const CONV_CONTENT_CLAMP = 4000;

/**
 * Conversation corpus: recent assistant turns (with ≥1 preceding user turn)
 * sampled across conversations — at most one item per conversation so the
 * sample spans personas/topics instead of one long thread (U3 cheap heuristic).
 * Tenant-scoped in the SQL itself.
 */
export async function loadConversationCorpus(tenantId: number, sampleSize: number): Promise<ModelSwapCorpus> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`loadConversationCorpus: invalid tenantId ${tenantId}`);
  const cap = Math.max(1, Math.min(Math.floor(sampleSize), 1000));

  // Latest qualifying assistant message per conversation; the outer ORDER BY
  // re-sorts the DISTINCT ON result by message id DESC so the LIMIT actually
  // takes the most RECENT conversations (DISTINCT ON alone orders by
  // conversation_id, which is not recency).
  const cand = await pool.query(
    `SELECT * FROM (
        SELECT DISTINCT ON (m.conversation_id)
               m.id, m.conversation_id, c.persona_id
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
         WHERE m.tenant_id = $1
           AND m.role = 'assistant'
           AND length(m.content) >= 40
           AND EXISTS (
                 SELECT 1 FROM messages p
                  WHERE p.conversation_id = m.conversation_id
                    AND p.tenant_id = $1 AND p.role = 'user' AND p.id < m.id)
         ORDER BY m.conversation_id, m.id DESC
     ) latest
     ORDER BY latest.id DESC
     LIMIT $2`,
    [tenantId, cap * 2],
  );
  const totalCandidates = cand.rows.length;

  const items: ModelSwapCorpusItem[] = [];
  let skippedNoContent = 0;
  for (const row of cand.rows) {
    if (items.length >= cap) break;
    const ctxRes = await pool.query(
      `SELECT role, content FROM messages
        WHERE conversation_id = $1 AND tenant_id = $2 AND id < $3
          AND role IN ('system','user','assistant')
        ORDER BY id DESC LIMIT $4`,
      [row.conversation_id, tenantId, row.id, CONV_CONTEXT_MESSAGES],
    );
    const context = ctxRes.rows.reverse().map((m: any) => ({
      role: m.role as "system" | "user" | "assistant",
      content: String(m.content || "").slice(0, CONV_CONTENT_CLAMP),
    })).filter((m: any) => m.content.trim().length > 0);
    if (context.length === 0 || !context.some((m) => m.role === "user")) { skippedNoContent++; continue; }

    const baseRes = await pool.query(
      `SELECT content FROM messages WHERE id = $1 AND tenant_id = $2`,
      [row.id, tenantId],
    );
    const baselineOutput = String(baseRes.rows[0]?.content || "").slice(0, CONV_CONTENT_CLAMP);
    if (!baselineOutput.trim()) { skippedNoContent++; continue; }

    items.push({
      itemRef: `messages:${row.id}`,
      messages: context,
      baselineOutput,
      personaId: row.persona_id ?? null,
    });
  }

  return { items, skippedNoContent, totalCandidates };
}

/**
 * Orchestration corpus: recorded orchestrator-ledger runs. The replayed prompt
 * asks the override model to plan the historical task; the baseline is the
 * plan the production planner produced. Tenant-scoped in the SQL itself.
 */
export async function loadOrchestrationCorpus(tenantId: number, sampleSize: number): Promise<ModelSwapCorpus> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`loadOrchestrationCorpus: invalid tenantId ${tenantId}`);
  const cap = Math.max(1, Math.min(Math.floor(sampleSize), 1000));

  const res = await pool.query(
    `SELECT id, fact FROM memory_entries
      WHERE tenant_id = $1 AND category = 'orchestrator_ledger'
      ORDER BY id DESC LIMIT $2`,
    [tenantId, cap * 2],
  );
  const totalCandidates = res.rows.length;

  const items: ModelSwapCorpusItem[] = [];
  let skippedNoContent = 0;
  for (const row of res.rows) {
    if (items.length >= cap) break;
    let task = "";
    let plan = "";
    try {
      const state = JSON.parse(String(row.fact || "{}"));
      task = String(state?.task || "").trim();
      const rawPlan = state?.plan;
      plan = typeof rawPlan === "string" ? rawPlan : JSON.stringify(rawPlan ?? "");
    } catch (e) { console.warn("[silent-catch] server/lib/sandbox/corpora.ts:", (e as any)?.message ?? e); }
    if (!task || !plan || plan === '""' || plan === "null") { skippedNoContent++; continue; }

    items.push({
      itemRef: `memory_entries:${row.id}`,
      messages: [
        { role: "system", content: "You are an orchestration planner. Produce a concise step-by-step plan (numbered steps, one line each) for the task. Output ONLY the plan." },
        { role: "user", content: task.slice(0, CONV_CONTENT_CLAMP) },
      ],
      baselineOutput: plan.slice(0, CONV_CONTENT_CLAMP),
      personaId: null,
    });
  }

  return { items, skippedNoContent, totalCandidates };
}
