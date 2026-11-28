import type { Express, Request, Response, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { SPARK_RELAY, relayStatus } from "../legion/spark-relay-contract";
import { RelayConflict } from "../legion/spark-relay-store";
import { sparkRelayStore, sparkRelayControlPlane, sparkRelayEnabled } from "../legion/spark-relay-runtime";
import { guardLocalMessages } from "../legion/model-policy";

type Store = typeof sparkRelayStore;
const prefix = "/api/v1/spark/legion-relay";
const bindingSchema = z.object({
  protocol: z.literal(SPARK_RELAY.protocol), workerId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  requestId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  claimToken: z.string().uuid(),
});
const pollSchema = bindingSchema.pick({ protocol: true, workerId: true }).extend({
  model: z.literal(SPARK_RELAY.model), ready: z.boolean(),
}).strict();
const resultSchema = bindingSchema.extend({
  outcome: z.enum(["complete", "failed_before_send", "uncertain"]),
  responseJson: z.string().max(SPARK_RELAY.maxBytes).optional(),
}).strict().refine(x => x.outcome === "complete" ? typeof x.responseJson === "string" : x.responseJson === undefined);
const limits = { maxRequestBytes: SPARK_RELAY.maxBytes, maxResponseBytes: SPARK_RELAY.maxBytes,
  maxTokens: SPARK_RELAY.maxTokens, deadlineMs: SPARK_RELAY.deadlineMs };
const jobId = (value: unknown) => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value))
  ? Number(value) : null;
function failure(res: Response, error: unknown) {
  return res.status(error instanceof RelayConflict ? 409 : 503).json({
    error: error instanceof RelayConflict ? error.message : "Relay unavailable; do not repeat inference",
  });
}

/** Structured worker ingress never enters a persona, chat turn or tool executor. */
export function registerSparkRelayApi(app: Express, auth: RequestHandler, apiOnly: RequestHandler,
  tenantFor: (req: Request) => number | null, store: Store = sparkRelayStore,
  controlAvailable = sparkRelayControlPlane) {
  const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
  const gate = (req: Request, res: Response, write: boolean) => {
    const key = (req as any).apiKeyId;
    const scopes = (req as any).apiKeyScopes as string[] | undefined;
    if (tenantFor(req) !== 1 || !Number.isSafeInteger(key) || key < 1 ||
        !scopes?.some(s => (write ? ["chat", "admin"] : ["read", "chat", "admin"]).includes(s))) {
      res.status(403).json({ error: "Authorized owner API credential required" }); return null;
    }
    if (!controlAvailable()) { res.status(503).json({ error: "Relay control plane unavailable" }); return null; }
    res.setHeader("Cache-Control", "no-store");
    return key as number;
  };
  app.get(`${prefix}/schema`, auth, apiOnly, limiter, (req, res) => {
    if (gate(req, res, false) === null) return;
    res.json({ protocol: SPARK_RELAY.protocol, model: SPARK_RELAY.model, guardrail: SPARK_RELAY.guardrail, limits });
  });
  app.get(`${prefix}/status`, auth, apiOnly, limiter, async (req, res) => {
    if (gate(req, res, false) === null) return;
    try { res.json(await store.status(1)); } catch (e) { failure(res, e); }
  });
  app.post(`${prefix}/poll`, auth, apiOnly, limiter, async (req, res) => {
    const key = gate(req, res, true); if (key === null) return;
    const parsed = pollSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid relay poll" });
    try { res.json({ protocol: SPARK_RELAY.protocol,
      job: await store.poll(1, key, parsed.data.workerId, parsed.data.ready) }); } catch (e) { failure(res, e); }
  });
  app.post(`${prefix}/:id/start`, auth, apiOnly, limiter, async (req, res) => {
    const key = gate(req, res, true); if (key === null) return;
    const parsed = bindingSchema.strict().safeParse(req.body), id = jobId(req.params.id);
    if (!parsed.success || !id) return res.status(400).json({ error: "Invalid relay start" });
    try { res.json(await store.start(1, key, id, parsed.data)); } catch (e) { failure(res, e); }
  });
  app.post(`${prefix}/:id/result`, auth, apiOnly, limiter, async (req, res) => {
    const key = gate(req, res, true); if (key === null) return;
    const parsed = resultSchema.safeParse(req.body), id = jobId(req.params.id);
    if (!parsed.success || !id) return res.status(400).json({ error: "Invalid relay result" });
    try {
      const b = parsed.data;
      const saved = await store.result(1, key, id, b, b.outcome, b.responseJson);
      // Record at receipt ingress, including late completions. Retried identical
      // results repair accounting through the ledger's existing idempotency key,
      // never by repeating inference.
      if ("task" in saved && saved.usage) {
        try {
          const { recordCost } = await import("../agentic/cost-ledger");
          const recorded = await recordCost({ tenantId: 1, toolName: "llm.legion-local",
            idempotencyKey: `legion-spark-relay:${id}`,
            model: `legion-local:${SPARK_RELAY.model}`, tokensIn: saved.usage.prompt_tokens,
            tokensOut: saved.usage.completion_tokens, costUsd: 0, operation: `${saved.task}:spark-relay:${id}` });
          await store.accounting(1, id, recorded === true);
          if (recorded !== true) throw Error("Ledger unavailable");
        } catch {
          console.warn("[spark-relay] accounting unconfirmed; resend saved result only");
          return res.status(503).json({ error: "Inference saved; resend this exact result to confirm accounting" });
        }
      }
      res.json({ accepted: saved.accepted, duplicate: saved.duplicate, receiptId: id });
    } catch (e) { failure(res, e); }
  });
  app.get(`${prefix}/:id`, auth, apiOnly, limiter, async (req, res) => {
    const key = gate(req, res, false); if (key === null) return;
    const id = jobId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid relay job" });
    try {
      const row = await store.get(1, id);
      if (!row || row.payload.claim?.apiKeyId !== key) return res.status(404).json({ error: "Relay claim not found" });
      res.json({ jobId: row.id, status: relayStatus(row.status), requestId: row.payload.requestId,
        digest: row.payload.digest, released: row.status === "relay_released", model: SPARK_RELAY.model,
        responseHash: row.result?.responseHash ?? null,
        possiblyRunning: ["relay_running", "relay_uncertain"].includes(row.status),
        deadlineAt: row.payload.deadlineAt });
    } catch (e) { failure(res, e); }
  });
}

export function registerSparkRelayOwner(app: Express, auth: RequestHandler,
  requireAdmin: (req: Request, res: Response) => boolean) {
  const limiter = rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true, legacyHeaders: false });
  app.post("/api/admin/legion-relay/probe", auth, limiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!sparkRelayEnabled()) return res.status(409).json({ error: "Spark relay disabled" });
    if (!req.body || Object.keys(req.body).length) return res.status(400).json({ error: "Probe takes an empty object only" });
    try {
      const row = await sparkRelayStore.enqueue(1, { model: SPARK_RELAY.model, temperature: 0, stream: false,
        max_tokens: 64, messages: guardLocalMessages([{ role: "user", content: "What is 17 + 25? Reply with only the number." }]) },
      "relay-probe", `probe:${randomUUID()}`);
      res.status(202).json({ jobId: row.id, status: relayStatus(row.status), transport: "spark-relay" });
    } catch (e) { failure(res, e); }
  });
  app.post("/api/admin/legion-relay/:id/release", auth, limiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = jobId(req.params.id);
    if (!sparkRelayControlPlane() || !id ||
        !z.object({ confirmedStopped: z.literal(true) }).strict().safeParse(req.body).success)
      return res.status(400).json({ error: "Owner must confirm old Lenovo work has stopped" });
    try { await sparkRelayStore.release(1, id); res.json({ released: true }); } catch (e) { failure(res, e); }
  });
}
