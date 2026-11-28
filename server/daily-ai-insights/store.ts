import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { ROOT, LIMITS, VERSION } from "./core";
import { emptyCursor, type Cursor } from "./intake";

export function assertOwner(tenant: unknown): asserts tenant is number {
  if (tenant !== ADMIN_TENANT_ID) throw new Error("Daily insights requires the platform owner");
}
export interface Receipt {
  digest: string; checksum?: string; reportId: string; revision: number; protocol: string;
  reviewId: number; outputId: string; date: string; agent: string;
}
export interface State {
  version: string; root: string; paused: boolean; lastDay?: string;
  cursor: Cursor; inventory: Record<string, Receipt>; errors: string[];
  uncertainInputs?: Array<{ id: string; digest: string }>;
  firstLiveScheduled?: { at: string; reviewId: number; outputId: string };
  active?: { token: string; until: number; day: string; calls: number; reviewId?: number; inputs?: Array<{ id: string; digest: string }> };
  last?: { status: string; at: string; reviewId?: number; outputId?: string; liveScheduled: boolean; detail?: string };
}
export const initialState = (): State => ({
  version: VERSION, root: ROOT, paused: false, cursor: emptyCursor(), inventory: {}, errors: [],
});
export interface SavedReview {
  day: string; markdown: string; digest: string; outputId: string; folderId: string;
  inputs: Array<Omit<Receipt, "reviewId" | "outputId"> & { id: string; name: string }>;
  evidence: unknown[]; candidates: any[]; status: string; missing: string[];
  liveScheduled: boolean; smoke: boolean; handoffs?: Record<string, unknown>;
  deliveryVerified?: boolean;
}
export function assertFence(s: State, token: string, now = Date.now()) {
  if (s.paused || s.active?.token !== token || s.active.until <= now) throw new Error("Daily insights paused or lease lost");
}
export function admit(s: State, day: string, now = Date.now()): string | null {
  if (s.paused || (s.active && s.active.until > now)) return null;
  if (s.lastDay === day && !s.active?.reviewId) return null;
  if (s.active?.calls && !s.active.reviewId) {
    s.uncertainInputs = [...(s.uncertainInputs ?? []), ...(s.active.inputs ?? [])]
      .filter((v, i, a) => a.findIndex(p => p.digest === v.digest) === i);
  }
  s.active = { token: randomUUID(), until: now + LIMITS.minutes * 60_000,
    day, calls: s.active?.reviewId ? s.active.calls : 0, reviewId: s.active?.reviewId };
  s.lastDay = day;
  return s.active.token;
}
export interface ReviewStore {
  read(): Promise<State>;
  claim(day: string): Promise<string | null>;
  save(token: string, patch: Partial<Pick<State, "cursor" | "errors" | "inventory">>): Promise<void>;
  check(token: string): Promise<void>;
  reserveModel(token: string, inputs: Array<{ id: string; digest: string }>): Promise<void>;
  prepare(token: string, review: SavedReview): Promise<number>;
  attachDelivery(token: string, reviewId: number, patch: { folderId?: string; outputId?: string }): Promise<void>;
  effect<T>(token: string | null, work: () => Promise<T>): Promise<T>;
  review(id: number): Promise<SavedReview>;
  complete(token: string, reviewId: number): Promise<void>;
  fail(token: string, detail: string): Promise<void>;
}

/** Completed job kinds are durable records, never dispatched pending jobs. */
export function createStore(tenant: number, smoke = false): ReviewStore & {
  pause(paused: boolean): Promise<void>;
  recordHandoff(id: number, digest: string, result: unknown): Promise<void>;
  reserveHandoff(id: number, identity: string, evidenceHash: string): Promise<{ candidate: any; review: SavedReview; prior?: any }>;
} {
  assertOwner(tenant);
  const kind = smoke ? "daily_ai_insights_smoke_state" : "daily_ai_insights_state";
  const reviewKind = smoke ? "daily_ai_insights_smoke_review" : "daily_ai_insights_review";
  const rows = (r: any): any[] => r.rows ?? r;
  const transaction = async <T>(work: (s: State, execute: (q: any) => Promise<any>) => Promise<T>) => {
    const { db } = await import("../db");
    return db.transaction(async tx => {
      const execute = (q: any) => tx.execute(q);
      await execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${tenant}:${ROOT}`}))`);
      let [record] = rows(await execute(sql`SELECT id,payload FROM agent_jobs
        WHERE tenant_id=${tenant} AND kind=${kind} ORDER BY id LIMIT 1 FOR UPDATE`));
      if (!record) {
        [record] = rows(await execute(sql`INSERT INTO agent_jobs(kind,tenant_id,status,payload,max_attempts,completed_at)
          VALUES(${kind},${tenant},'succeeded',${JSON.stringify(initialState())}::jsonb,1,now()) RETURNING id,payload`));
      }
      const s = record.payload as State;
      if (s.version !== VERSION || s.root !== ROOT) throw new Error("Daily insights state contract mismatch");
      const result = await work(s, execute);
      await execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify(s)}::jsonb
        WHERE id=${Number(record.id)} AND tenant_id=${tenant} AND kind=${kind}`);
      return result;
    });
  };
  const fence = assertFence;
  const ownedReview = async (execute: (q: any) => Promise<any>, id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid review identity");
    const [r] = rows(await execute(sql`SELECT result FROM agent_jobs
      WHERE id=${id} AND tenant_id=${tenant} AND kind=${reviewKind}`));
    if (!r?.result) throw new Error("Review not found");
    return r.result as SavedReview;
  };
  return {
    read: () => transaction(async s => structuredClone(s)),
    claim: day => transaction(async s => admit(s, day)),
    save: (token, patch) => transaction(async s => { fence(s, token); Object.assign(s, patch); }),
    check: token => transaction(async s => { fence(s, token); }),
    reserveModel: (token, inputs) => transaction(async s => {
      fence(s, token);
      if (s.active!.calls !== 0) throw new Error("Synthesis admission already consumed");
      s.active!.calls = 1; // Never refunded after an uncertain provider outcome.
      s.active!.inputs = inputs;
    }),
    prepare: (token, review) => transaction(async (s, execute) => {
      fence(s, token);
      if (s.active!.reviewId) return s.active!.reviewId!;
      const [r] = rows(await execute(sql`INSERT INTO agent_jobs(kind,tenant_id,status,payload,result,max_attempts,completed_at)
        VALUES(${reviewKind},${tenant},'succeeded','{}'::jsonb,${JSON.stringify(review)}::jsonb,1,now()) RETURNING id`));
      s.active!.reviewId = Number(r.id);
      return Number(r.id);
    }),
    attachDelivery: (token, reviewId, patch) => transaction(async (s, execute) => {
      fence(s, token);
      if (s.active!.reviewId !== reviewId) throw new Error("Delivery identity mismatch");
      const r = await ownedReview(execute, reviewId);
      if ((patch.folderId && r.folderId && r.folderId !== patch.folderId) ||
          (patch.outputId && r.outputId && r.outputId !== patch.outputId)) throw new Error("Delivery identity is immutable");
      Object.assign(r, patch);
      await execute(sql`UPDATE agent_jobs SET result=${JSON.stringify(r)}::jsonb
        WHERE id=${reviewId} AND tenant_id=${tenant} AND kind=${reviewKind}`);
    }),
    // Serialize each bounded external mutation with pause. A pause response
    // acknowledges only AFTER an already-admitted write ends; no later write
    // can pass. This cannot undo bytes a remote service has already accepted.
    effect: (token, work) => transaction(async s => {
      if (token) fence(s, token);
      else if (s.paused) throw new Error("Daily insights is paused");
      return work();
    }),
    review: id => transaction((_s, execute) => ownedReview(execute, id)),
    complete: (token, reviewId) => transaction(async (s, execute) => {
      fence(s, token);
      if (s.active!.reviewId !== reviewId) throw new Error("Review completion identity mismatch");
      const r = await ownedReview(execute, reviewId);
      r.deliveryVerified = true;
      await execute(sql`UPDATE agent_jobs SET result=${JSON.stringify(r)}::jsonb
        WHERE id=${reviewId} AND tenant_id=${tenant} AND kind=${reviewKind}`);
      for (const f of r.inputs) {
        const { id, name: _name, ...receipt } = f;
        s.inventory[id] = { ...receipt, reviewId, outputId: r.outputId };
      }
      const completed = new Set(r.inputs.map(f => f.id));
      s.cursor.pending = s.cursor.pending.filter(f => !completed.has(f.id));
      s.last = { status: r.status, at: new Date().toISOString(), reviewId, outputId: r.outputId, liveScheduled: r.liveScheduled };
      if (r.liveScheduled && !s.firstLiveScheduled) {
        s.firstLiveScheduled = { at: s.last.at, reviewId, outputId: r.outputId };
      }
      s.active = undefined;
    }),
    fail: (token, detail) => transaction(async s => {
      if (s.active?.token !== token) return;
      s.last = { status: "error", at: new Date().toISOString(), liveScheduled: false, detail: detail.slice(0, 300) };
      // Retain prepared output, but revoke the old worker; unprepared calls stay spent for today.
      s.active.until = 0;
    }),
    pause: paused => transaction(async s => {
      s.paused = paused;
      if (s.active) s.active.until = 0;
    }),
    recordHandoff: (id, digest, result) => transaction(async (s, execute) => {
      if (s.paused) throw new Error("Daily insights is paused");
      const r = await ownedReview(execute, id);
      r.handoffs = { ...r.handoffs, [digest]: result };
      await execute(sql`UPDATE agent_jobs SET result=${JSON.stringify(r)}::jsonb
        WHERE id=${id} AND tenant_id=${tenant} AND kind=${reviewKind}`);
    }),
    reserveHandoff: (id, identity, evidenceHash) => transaction(async (s, execute) => {
      if (s.paused) throw new Error("Daily insights is paused");
      const review = await ownedReview(execute, id);
      if (!review.deliveryVerified || review.smoke) throw new Error("Only a read-back verified research review may be promoted");
      const candidate = review.candidates.find(c => c.identity === identity && c.evidenceHash === evidenceHash);
      if (!candidate) throw new Error("Candidate identity or evidence changed");
      const [prior] = rows(await execute(sql`SELECT result FROM agent_jobs WHERE tenant_id=${tenant}
        AND kind=${reviewKind} AND result->'handoffs' ? ${identity}
        ORDER BY id ASC LIMIT 1`));
      const result = prior?.result?.handoffs?.[identity];
      if (result) return { candidate, review, prior: result };
      // Persist the exact owner-requested intent BEFORE external dispatch.
      review.handoffs = { ...review.handoffs, [identity]: { status: "dispatch_pending", evidenceHash, at: new Date().toISOString() } };
      await execute(sql`UPDATE agent_jobs SET result=${JSON.stringify(review)}::jsonb
        WHERE id=${id} AND tenant_id=${tenant} AND kind=${reviewKind}`);
      return { candidate, review };
    }),
  };
}
