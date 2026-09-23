/**
 * S5 signed production→workspace source-repair handoff.
 *
 * This module intentionally contains no source-writing primitive.  The
 * production side may only POST bounded finding intent; the workspace consumer
 * turns an accepted inbox row into the existing research proposal flow.
 */
import { createHash, createHmac, timingSafeEqual, randomUUID } from "crypto";
import { isIP } from "node:net";
import * as dns from "node:dns/promises";
import type { Request, Response, Express } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { enqueueUniqueJob } from "./job-queue";
import { isProductionRuntime } from "./lib/runtime-env";
import { ssrfSafeUrl, pinnedDispatcher } from "./lib/ssrf-jail";

const MAX_BODY = 24_000;
const MAX_TEXT = 4_000;
const MAX_EVIDENCE = 8_000;
const MAX_AGE_MS = 5 * 60_000;
const REAL_FETCH = globalThis.fetch;

type RepairEndpoint = { url: URL; addresses: string[] };
export function canonicalRepairHandoffPath(pathname: string): string {
  const canonical = pathname.replace(/\/+$/, "");
  if (!canonical || canonical === "/") throw new Error("invalid workspace path");
  return canonical.startsWith("/") ? canonical : `/${canonical}`;
}
export async function validateRepairHandoffEndpoint(raw: string, resolver: typeof dns.lookup = dns.lookup): Promise<RepairEndpoint> {
  const parsed = new URL(raw);
  if (parsed.username || parsed.password || parsed.hash || parsed.port) throw new Error("invalid workspace URL");
  const trusted = process.env.REPAIR_HANDOFF_TRUSTED_HOST;
  if (trusted && parsed.hostname.endsWith(".replit.dev") && parsed.hostname !== trusted) {
    throw new Error("untrusted workspace host");
  }
  if (trusted && parsed.hostname === trusted) {
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".replit.dev")) throw new Error("invalid trusted workspace URL");
    const configured = new URL(process.env.REPAIR_HANDOFF_WORKSPACE_URL || "");
    const basePath = canonicalRepairHandoffPath(configured.pathname);
    if (parsed.pathname !== basePath && parsed.pathname !== `${basePath}/status`) {
      throw new Error("invalid trusted workspace path");
    }
    const records = await resolver(parsed.hostname, { all: true });
    const addresses = records.map((record: any) => String(record.address));
    if (!addresses.length || addresses.some((address) => !isIP(address))) throw new Error("invalid trusted workspace DNS");
    return { url: parsed, addresses };
  }
  const safe = await ssrfSafeUrl(parsed.toString());
  if (!safe.ok) throw new Error("unsafe workspace URL");
  return { url: safe.url, addresses: safe.addresses };
}

export type RepairHandoffPayload = {
  tenantId: number;
  sourceFindingId: string;
  sourceEvidenceVersion: string;
  sourceEvidenceHash: string;
  findingIntent: string;
  evidence: string;
  repairIdentity?: string;
};

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").slice(0, max) : "";
}

/** Stable canonical JSON: signing never depends on object insertion order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function bodySha256(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function signRepairHandoff(body: unknown, timestamp: string, nonce: string, key: string): string {
  const digest = bodySha256(body);
  return createHmac("sha256", key).update(`${timestamp}.${nonce}.${digest}`).digest("hex");
}

export function repairIdentity(payload: RepairHandoffPayload): string {
  return `${payload.tenantId}:${payload.sourceFindingId}:${payload.sourceEvidenceVersion}:${payload.sourceEvidenceHash}`;
}

function rejectUnsafeKeys(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(rejectUnsafeKeys);
  return Object.entries(value).some(([key, child]) =>
    /^(code(diff)?|target(file|path)?|path|old_code|new_code|patch|command|executable)$/i.test(key) ||
    rejectUnsafeKeys(child));
}

export function validateRepairPayload(value: unknown): RepairHandoffPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("payload must be an object");
  if (rejectUnsafeKeys(value)) throw new Error("payload contains executable source authority");
  const input = value as Record<string, unknown>;
  if (typeof input.findingIntent === "string" && input.findingIntent.length > MAX_TEXT) throw new Error("finding intent exceeds bounds");
  if (typeof input.evidence === "string" && input.evidence.length > MAX_EVIDENCE) throw new Error("evidence exceeds bounds");
  if (canonicalJson(value).length > MAX_BODY) throw new Error("payload exceeds bounded size");
  const tenantId = Number(input.tenantId);
  const payload: RepairHandoffPayload = {
    tenantId,
    sourceFindingId: bounded(input.sourceFindingId, 200),
    sourceEvidenceVersion: bounded(input.sourceEvidenceVersion, 200),
    sourceEvidenceHash: bounded(input.sourceEvidenceHash, 128),
    findingIntent: bounded(input.findingIntent, MAX_TEXT),
    evidence: bounded(input.evidence, MAX_EVIDENCE),
  };
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("invalid tenant scope");
  if (!payload.sourceFindingId || !payload.sourceEvidenceVersion || !/^[a-f0-9]{32,128}$/i.test(payload.sourceEvidenceHash)) {
    throw new Error("incomplete source evidence identity");
  }
  if (!payload.findingIntent || !payload.evidence) throw new Error("finding intent and evidence are required");
  payload.repairIdentity = repairIdentity(payload);
  if (canonicalJson(payload).length > MAX_BODY) throw new Error("payload exceeds bounded size");
  return payload;
}

export function validateSourceRepairAction(value: unknown): {
  version: 1; kind: "source_repair_handoff"; findingId: string; evidenceVersion: string; evidenceHash: string;
} {
  if (!value || typeof value !== "object") throw new Error("missing source repair action");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.kind !== "source_repair_handoff") throw new Error("invalid source repair action");
  const findingId = bounded(v.findingId, 200);
  const evidenceVersion = bounded(v.evidenceVersion, 200);
  const evidenceHash = bounded(v.evidenceHash, 128);
  if (!findingId || !evidenceVersion || !/^[a-f0-9]{32,128}$/i.test(evidenceHash)) throw new Error("invalid source repair evidence");
  return { version: 1, kind: "source_repair_handoff", findingId, evidenceVersion, evidenceHash };
}

export function verifyRepairSignature(args: {
  body: unknown; timestamp: string; nonce: string; signature: string; bodyHash: string; key: string; now?: number;
}): void {
  if (!/^\d+$/.test(args.timestamp) || !args.nonce || args.nonce.length > 200) throw new Error("invalid signature metadata");
  const age = Math.abs((args.now ?? Date.now()) - Number(args.timestamp));
  if (!Number.isFinite(age) || age > MAX_AGE_MS) throw new Error("stale handoff timestamp");
  const actualHash = bodySha256(args.body);
  if (actualHash !== args.bodyHash) throw new Error("body hash mismatch");
  const expected = signRepairHandoff(args.body, args.timestamp, args.nonce, args.key);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(args.signature || "", "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("invalid handoff signature");
}

export async function acceptRepairHandoff(req: Request, res: Response): Promise<void> {
  if (isProductionRuntime()) { res.status(404).json({ error: "workspace endpoint unavailable in production" }); return; }
  if (process.env.REPAIR_HANDOFF_ENABLED !== "1") { res.status(404).json({ error: "repair handoff disabled" }); return; }
  const key = process.env.REPAIR_HANDOFF_HMAC_KEY;
  if (!key) { res.status(503).json({ error: "repair handoff authentication unavailable" }); return; }
  try {
    const payload = validateRepairPayload(req.body);
    const timestamp = String(req.header("x-repair-timestamp") || "");
    const nonce = String(req.header("x-repair-nonce") || "");
    const bodyHash = String(req.header("x-repair-body-sha256") || "");
    const signature = String(req.header("x-repair-signature") || "");
    const keyId = bounded(req.header("x-repair-key-id") || "default", 100);
    verifyRepairSignature({ body: req.body, timestamp, nonce, signature, bodyHash, key });
    const identity = payload.repairIdentity!;
    const inserted: any = await db.execute(sql`
      INSERT INTO repair_handoff_requests
        (tenant_id, repair_identity, source_finding_id, source_evidence_version,
         source_evidence_hash, nonce, key_id, request_timestamp, payload)
      VALUES (${payload.tenantId}, ${identity}, ${payload.sourceFindingId}, ${payload.sourceEvidenceVersion},
              ${payload.sourceEvidenceHash}, ${nonce}, ${keyId}, to_timestamp(${Number(timestamp) / 1000}),
              ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (tenant_id, repair_identity) DO NOTHING
      RETURNING id
    `);
    const rows = inserted.rows ?? inserted;
    const row = rows[0];
    const id = row?.id ? Number(row.id) : Number(((await db.execute(sql`
      SELECT id FROM repair_handoff_requests WHERE tenant_id = ${payload.tenantId} AND repair_identity = ${identity}
    `)) as any).rows?.[0]?.id);
    if (!id) throw new Error("handoff inbox insert did not return an id");
    const jobId = await enqueueUniqueJob("source_repair_handoff", identity, { tenantId: payload.tenantId, handoffId: id }, { tenantId: payload.tenantId, maxAttempts: 3 });
    await db.execute(sql`UPDATE repair_handoff_requests SET job_id = ${jobId}, updated_at = now() WHERE id = ${id} AND tenant_id = ${payload.tenantId} AND job_id IS NULL`);
     res.status(row ? 202 : 200).json({ accepted: true, handoffId: id, id, jobId, idempotent: !row });
  } catch (error: any) {
    res.status(400).json({ error: String(error?.message || "invalid handoff").slice(0, 200) });
  }
}

export function registerRepairHandoffRoute(app: Express): void {
  app.post("/internal/workspace/source-repair-handoff", acceptRepairHandoff);
  app.get("/internal/workspace/source-repair-handoff/status", workspaceRepairHandoffStatus);
}

export function deriveRepairStatus(row: {
  status: string; proposalId?: number | null; proposalStatus?: string | null;
  verificationStatus?: string | null;
}): "pending" | "reviewing" | "blocked" | "applied" {
  const negative = new Set(["rejected", "blocked", "failed", "error"]);
  const verificationNegative = new Set(["failed", "rejected", "skipped", "error"]);
  if (negative.has(String(row.status)) || negative.has(String(row.proposalStatus)) ||
      verificationNegative.has(String(row.verificationStatus))) return "blocked";
  if (row.proposalStatus === "applied" && row.verificationStatus === "passed") return "applied";
  if (row.proposalId && row.verificationStatus === "reviewing") return "reviewing";
  return "pending";
}

export async function workspaceRepairHandoffStatusCore(args: {
  query: Record<string, unknown>;
  headers: (name: string) => string;
  key: string;
  execute: (query: any) => Promise<any>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const tenantId = Number(args.query.tenantId);
  const handoffId = Number(args.query.handoffId);
  const evidenceVersion = bounded(args.query.evidenceVersion, 200);
  const evidenceHash = bounded(args.query.evidenceHash, 128);
  try {
    const body = { tenantId, handoffId, evidenceVersion, evidenceHash };
    verifyRepairSignature({ body, timestamp: args.headers("x-repair-timestamp"),
      nonce: args.headers("x-repair-nonce"), signature: args.headers("x-repair-signature"),
      bodyHash: args.headers("x-repair-body-sha256"), key: args.key });
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(handoffId) || handoffId <= 0) throw new Error("invalid status identity");
    const result: any = await args.execute(sql`
      SELECT h.id, h.tenant_id, h.status, h.proposal_id, p.status AS proposal_status,
             p.verification_status
      FROM repair_handoff_requests h
      LEFT JOIN code_proposals p ON p.id = h.proposal_id AND p.tenant_id = h.tenant_id
      WHERE h.id = ${handoffId} AND h.tenant_id = ${tenantId}
        AND h.source_evidence_version = ${evidenceVersion} AND h.source_evidence_hash = ${evidenceHash}
      LIMIT 1
    `);
    const row = (result.rows ?? result)[0];
    if (!row) return { status: 404, body: { error: "handoff status unavailable" } };
    const status = deriveRepairStatus({ status: row.status, proposalId: row.proposal_id,
      proposalStatus: row.proposal_status, verificationStatus: row.verification_status });
    return { status: 200, body: { tenantId, handoffId, status, proposalId: row.proposal_id ? Number(row.proposal_id) : null,
      reason: status === "blocked" ? "proposal verification failed or was blocked" : null } };
  } catch (_error) {
    return { status: 401, body: { error: "invalid handoff status request" } };
  }
}

/** Read-only, signed workspace truth. Production deliberately refuses this
 * endpoint: it can only expose workspace inbox/proposal state. */
export async function workspaceRepairHandoffStatus(req: Request, res: Response): Promise<void> {
  if (isProductionRuntime()) { res.status(404).json({ error: "workspace endpoint unavailable in production" }); return; }
  const key = process.env.REPAIR_HANDOFF_HMAC_KEY;
  if (!key) { res.status(503).json({ error: "repair handoff authentication unavailable" }); return; }
  const result = await workspaceRepairHandoffStatusCore({ query: req.query as any,
    headers: (name) => String(req.header(name) || ""), key, execute: (query) => db.execute(query) });
  res.status(result.status).json(result.body);
}

/** Bounded, idempotent production reconciliation. It only advances the
 * original tenant/evidence-bound plan; source writing remains workspace-owned. */
export async function reconcileHandoffPendingPlans(): Promise<number> {
  return reconcileHandoffPendingPlansWith({
    execute: (query) => db.execute(query),
    statusClient: createRepairHandoffStatusClient(),
  });
}

export type RepairHandoffStatus = "pending" | "reviewing" | "blocked" | "applied";
export type RepairHandoffStatusClient = (args: {
  tenantId: number; handoffId: number; evidenceVersion: string; evidenceHash: string;
}) => Promise<{ status: RepairHandoffStatus; reason?: string }>;

/** Reconciliation seam: production reads only its own plan and execution-log store. */
export async function reconcileHandoffPendingPlansWith(deps: {
  execute: (query: any) => Promise<any>;
  statusClient: RepairHandoffStatusClient;
}): Promise<number> {
  const candidates: any = await deps.execute(sql`
    SELECT id, tenant_id, source_ref, plan_json, execution_log FROM plans
    WHERE status = 'handoff_pending' ORDER BY id ASC LIMIT 25
  `);
  let changed = 0;
  for (const row of (candidates.rows ?? candidates)) {
    const action = row.plan_json?.repairAction;
    if (!action || action.kind !== "source_repair_handoff") continue;
    const evidence = Array.isArray(row.execution_log) ? row.execution_log : [];
    const sent = evidence.find((event: any) =>
      event?.type === "execution.handoff_pending" && event?.handoffId);
    if (!sent) continue;
    let observed: { status: RepairHandoffStatus; reason?: string };
    try {
      observed = await deps.statusClient({
        tenantId: Number(row.tenant_id), handoffId: Number(sent.handoffId),
        evidenceVersion: String(action.evidenceVersion), evidenceHash: String(action.evidenceHash),
      });
    } catch (error: any) {
      const eventId = `handoff-status-error:${row.id}`;
      await deps.execute(sql`
        UPDATE plans SET execution_log = COALESCE(execution_log, '[]'::jsonb) ||
          ${JSON.stringify([{ type: "execution.handoff_status_observation", eventId,
            at: new Date().toISOString(), handoffId: Number(sent.handoffId),
            observation: String(error?.message || "workspace status unavailable").slice(0, 200) }])}::jsonb
        WHERE id = ${Number(row.id)} AND tenant_id = ${Number(row.tenant_id)}
          AND status = 'handoff_pending'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(execution_log, '[]'::jsonb)) e WHERE e->>'eventId' = ${eventId})
      `);
      continue;
    }
    if (observed.status === "pending" || observed.status === "reviewing") continue;
    const next = observed.status === "blocked" ? "failed" : "publish_required";
    const reason = observed.status === "blocked"
      ? String(observed.reason || "Workspace proposal verification failed; review the linked proposal before retrying.").slice(0, 300) : null;
    const updated: any = await deps.execute(sql`
      UPDATE plans SET status = ${next}, updated_at = now(),
        execution_log = COALESCE(execution_log, '[]'::jsonb) ||
          ${JSON.stringify([{ type: `execution.handoff_reconciled`, at: new Date().toISOString(),
            handoffId: Number(sent.handoffId), status: observed.status, reason }])}::jsonb
      WHERE id = ${Number(row.id)} AND tenant_id = ${Number(row.tenant_id)} AND status = 'handoff_pending'
      RETURNING id
    `);
    if ((updated.rows ?? updated).length) changed++;
  }
  return changed;
}

/** Production-only sender. A non-2xx response is a blocker, never completion. */
export async function dispatchRepairHandoff(payload: RepairHandoffPayload, fetcher: typeof fetch = fetch): Promise<{ accepted: boolean; handoffId?: number; idempotent?: boolean; blocker?: string }> {
  if (process.env.REPAIR_HANDOFF_ENABLED !== "1") return { accepted: false, blocker: "repair_handoff_disabled" };
  const url = process.env.REPAIR_HANDOFF_WORKSPACE_URL;
  const key = process.env.REPAIR_HANDOFF_HMAC_KEY;
  if (!url || !key) return { accepted: false, blocker: "repair_handoff_authentication_unavailable" };
  const body = validateRepairPayload(payload);
  let endpoint: string;
  try {
    endpoint = deriveRepairHandoffStatusUrl(url, fetcher !== REAL_FETCH).replace(/\/status$/, "");
  } catch {
    return { accepted: false, blocker: "repair_handoff_invalid_workspace_url" };
  }
  const timestamp = String(Date.now());
  const nonce = createHash("sha256").update(`${body.repairIdentity}:${timestamp}`).digest("hex");
  const hash = bodySha256(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
     const options: any = { method: "POST", signal: controller.signal, headers: {
      "content-type": "application/json", "x-repair-timestamp": timestamp, "x-repair-nonce": nonce,
      "x-repair-body-sha256": hash, "x-repair-signature": signRepairHandoff(body, timestamp, nonce, key),
      "x-repair-key-id": "primary", "idempotency-key": body.repairIdentity!,
     }, body: canonicalJson(body) };
     let response: any;
     if (fetcher === REAL_FETCH) {
       const safe = await validateRepairHandoffEndpoint(endpoint);
       options.redirect = "error";
       options.dispatcher = pinnedDispatcher(safe.addresses);
       response = await fetcher(safe.url.toString(), options);
     } else response = await fetcher(endpoint, options);
     if (!response.ok) return { accepted: false, blocker: `workspace_http_${response.status}` };
     const text = (await response.text()).slice(0, 4_000);
     let result: any;
     try { result = JSON.parse(text); } catch { return { accepted: false, blocker: "workspace_invalid_response" }; }
     if (!result || result.accepted !== true || !Number.isInteger(Number(result.handoffId)) ||
         typeof result.idempotent !== "boolean") {
       return { accepted: false, blocker: "workspace_invalid_response" };
     }
     return { accepted: true, handoffId: Number(result.handoffId), idempotent: result.idempotent };
  } catch (error: any) {
    return { accepted: false, blocker: error?.name === "AbortError" ? "workspace_timeout_ambiguous" : "workspace_unreachable" };
  } finally { clearTimeout(timer); }
}

export function deriveRepairHandoffStatusUrl(base: string, allowLocalTestTransport = false): string {
  const parsed = new URL(base);
  const ip = isIP(parsed.hostname);
  const privateIp = ip === 4 && /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);
  const local = /^(localhost|127\.|0\.0\.0\.0|::1$)/i.test(parsed.hostname) || privateIp;
  if ((!/^https:$/.test(parsed.protocol) && !(allowLocalTestTransport && /^http:$/.test(parsed.protocol))) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || (local && !allowLocalTestTransport)) {
    throw new Error("invalid workspace URL");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/status`;
  return parsed.toString();
}

export function createRepairHandoffStatusClient(fetcher: typeof fetch = fetch): RepairHandoffStatusClient {
  return async ({ tenantId, handoffId, evidenceVersion, evidenceHash }) => {
    const base = process.env.REPAIR_HANDOFF_WORKSPACE_URL;
    const key = process.env.REPAIR_HANDOFF_HMAC_KEY;
    if (!base || !key) throw new Error("repair handoff authentication unavailable");
    const body = { tenantId, handoffId, evidenceVersion, evidenceHash };
    const timestamp = String(Date.now());
    const nonce = createHash("sha256").update(`${handoffId}:${timestamp}`).digest("hex");
    const url = new URL(deriveRepairHandoffStatusUrl(base, fetcher !== REAL_FETCH));
    Object.entries(body).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const options: any = { method: "GET", signal: controller.signal, headers: {
        "x-repair-timestamp": timestamp, "x-repair-nonce": nonce,
        "x-repair-body-sha256": bodySha256(body), "x-repair-signature": signRepairHandoff(body, timestamp, nonce, key),
      }};
      let response: any;
      if (fetcher === REAL_FETCH) {
        const safe = await validateRepairHandoffEndpoint(url.toString());
        options.redirect = "error";
        options.dispatcher = pinnedDispatcher(safe.addresses);
        response = await fetcher(safe.url.toString(), options);
      } else response = await fetcher(url.toString(), options);
      const text = (await response.text()).slice(0, 4_000);
      if (!response.ok) throw new Error(`workspace_http_${response.status}`);
      const result = JSON.parse(text);
      if (!result || !["pending", "reviewing", "blocked", "applied"].includes(result.status)) throw new Error("workspace_invalid_response");
      return { status: result.status, reason: typeof result.reason === "string" ? result.reason.slice(0, 300) : undefined };
    } catch (error: any) {
      throw new Error(String(error?.name === "AbortError" ? "workspace_timeout" : error?.message || "workspace_unreachable").slice(0, 200));
    } finally { clearTimeout(timer); }
  };
}

export interface RepairConsumerDeps {
  dbExecute?: (query: any) => Promise<any>;
  enqueue?: (kind: string, key: string, payload: Record<string, any>, opts: { tenantId: number }) => Promise<number>;
  generateProposal?: (input: {
    tenantId: number; handoffId: number; findingIntent: string; evidence: string;
  }) => Promise<number | null>;
  requestVerification?: (proposalId: number, tenantId: number) => Promise<void>;
  renewClaim?: (handoffId: number, tenantId: number, token: string) => Promise<boolean>;
  renewalIntervalMs?: number;
}

/** Durable consumer seam. Dependencies are injectable so lifecycle tests never
 * need an LLM, filesystem, apply path, or an external network. */
export async function consumeRepairHandoff(
  handoffId: number,
  tenantId: number,
  deps: RepairConsumerDeps = {},
): Promise<{ status: "consumed" | "skipped"; proposalId?: number; jobId?: number; reason?: string }> {
  const execute = deps.dbExecute ?? ((query: any) => db.execute(query));
  const claimToken = randomUUID();
  const claimed: any = await execute(sql`
    UPDATE repair_handoff_requests
    SET status = 'accepted', claim_token = ${claimToken},
        claim_expires_at = now() + interval '5 minutes',
        attempts = COALESCE(attempts, 0) + 1,
        accepted_at = COALESCE(accepted_at, now()), updated_at = now(),
        last_error = NULL
    WHERE id = ${handoffId} AND tenant_id = ${tenantId}
      AND (status = 'pending' OR (status = 'accepted' AND claim_expires_at < now()))
    RETURNING id, payload, repair_identity, proposal_id
  `);
  const rows = claimed.rows ?? claimed;
  if (!rows.length) return { status: "skipped", reason: "already_consumed_or_blocked" };
  const payload = rows[0].payload;
  let claimLost = false;
  const renew = deps.renewClaim ?? (async () => {
    const result: any = await execute(sql`
      UPDATE repair_handoff_requests
      SET claim_expires_at = now() + interval '5 minutes', updated_at = now()
      WHERE id = ${handoffId} AND tenant_id = ${tenantId}
        AND status = 'accepted' AND claim_token = ${claimToken}
      RETURNING id
    `);
    return (result.rows ?? result).length === 1;
  });
  const renewalTimer = setInterval(() => {
    renew(handoffId, tenantId, claimToken).then(ok => { if (!ok) claimLost = true; })
      .catch(() => { claimLost = true; });
  }, deps.renewalIntervalMs ?? 30_000);
  try {
    const generate = deps.generateProposal ?? (async (input) => {
      const { generateCodeProposal } = await import("./research-engine");
      return generateCodeProposal(
        { sessionId: input.handoffId, tenantId: input.tenantId, model: "gemini-2.5-flash" } as any,
        "Nightly Security & Safety Intelligence", input.findingIntent, input.evidence,
        "Create a bounded proposal after independently inspecting workspace source.", 8,
        { personaSlug: "forge", category: "source-repair" }, null,
        "production-repair-handoff",
      );
    });
    // A crash after proposal creation must never create a second proposal.
    // Prefer the durable provenance key, then fall back to generation once.
    let proposalId = Number(rows[0].proposal_id || 0) || null;
    if (!proposalId) {
      const existing: any = await execute(sql`
        SELECT id AS proposal_id FROM code_proposals
        WHERE tenant_id = ${tenantId} AND source = 'production-repair-handoff'
          AND source_session_id = ${handoffId}
        ORDER BY id ASC LIMIT 1
      `);
      proposalId = Number((existing.rows ?? existing)[0]?.proposal_id || 0) || null;
    }
    if (!proposalId) {
      try {
        proposalId = await generate({
          tenantId, handoffId,
          findingIntent: String(payload.findingIntent).slice(0, MAX_TEXT),
          evidence: String(payload.evidence).slice(0, MAX_EVIDENCE),
        });
      } catch (generationError) {
        // A concurrent generator may have won the provenance unique index.
        const duplicate: any = await execute(sql`
          SELECT id AS proposal_id FROM code_proposals
          WHERE tenant_id = ${tenantId} AND source = 'production-repair-handoff'
            AND source_session_id = ${handoffId}
          ORDER BY id ASC LIMIT 1
        `);
        proposalId = Number((duplicate.rows ?? duplicate)[0]?.proposal_id || 0) || null;
        if (!proposalId) throw generationError;
      }
    }
    if (!proposalId) throw new Error("proposal generator returned no proposal");
    if (claimLost || !(await renew(handoffId, tenantId, claimToken))) {
      claimLost = true;
      throw new Error("source repair claim lost during proposal generation");
    }
    // Persist the identity before enqueueing verification; this is the restart
    // boundary and is fenced to this claim.
    const persisted: any = await execute(sql`
      UPDATE repair_handoff_requests
      SET proposal_id = ${proposalId}, updated_at = now()
      WHERE id = ${handoffId} AND tenant_id = ${tenantId} AND claim_token = ${claimToken}
      RETURNING id
    `);
    if ((persisted.rows ?? persisted).length !== 1) {
      throw new Error("source repair claim lost before proposal persistence");
    }
    if (deps.requestVerification) await deps.requestVerification(proposalId, tenantId);
    else await enqueueUniqueJob("source_repair_verification", `${tenantId}:${proposalId}`, {
      tenantId, proposalId,
    }, { tenantId, maxAttempts: 3 });
    const consumed: any = await execute(sql`
      UPDATE repair_handoff_requests
      SET status = 'consumed', consumed_at = now(), claim_token = NULL,
          claim_expires_at = NULL, updated_at = now()
      WHERE id = ${handoffId} AND tenant_id = ${tenantId}
        AND status = 'accepted' AND claim_token = ${claimToken}
      RETURNING id
    `);
    if ((consumed.rows ?? consumed).length !== 1) {
      throw new Error("source repair claim lost before consumption");
    }
    return { status: "consumed", proposalId };
  } catch (error: any) {
    const reason = String(error?.message || "proposal generation failed").replace(/\u0000/g, "").slice(0, 400);
    await execute(sql`
       UPDATE repair_handoff_requests
       SET status = 'blocked', blocker = ${reason}, last_error = ${reason},
           claim_token = NULL, claim_expires_at = NULL, updated_at = now()
       WHERE id = ${handoffId} AND tenant_id = ${tenantId}
         AND status = 'accepted' AND claim_token = ${claimToken}
    `);
    throw new Error(`source repair handoff blocked: ${reason}`);
  } finally {
    clearInterval(renewalTimer);
  }
}