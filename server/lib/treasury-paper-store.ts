import { randomUUID, createHash } from "node:crypto";
import { pool } from "../db";
import { ownerTenantId } from "../agentic/autonomous-budget";
import type { PaperOptions, PaperRun, PaperResult, PaperBar } from "../../shared/treasury-paper-contract";
import { getTypeSafeJevStatus } from "../typesafe-jev";
export const PAPER_DAILY_LIMIT = 20;
export const isPaperEnabled = () => process.env.TREASURY_PAPER_DISABLED !== "1";
export function requirePaperOwner(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId !== ownerTenantId()) throw new Error("Paper simulation requires the owner tenant");
}
export function requirePaperEnabled() {
  if (!isPaperEnabled()) throw new Error("Paper simulation is disabled by the owner");
}
export function paperId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new Error("A valid operation UUID is required");
  return value;
}
let ready: Promise<void> | undefined;
export async function ensurePaperSchema(): Promise<void> {
  if (!ready) ready = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS treasury_paper_runs (
      id uuid PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
      request_key uuid NOT NULL, request_digest text NOT NULL, status text NOT NULL DEFAULT 'running',
      options jsonb NOT NULL, source_bars jsonb, result jsonb, error text,
      reviewing boolean NOT NULL DEFAULT false, review jsonb, review_error text, review_attempted_at timestamptz,
      lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    )`);
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS treasury_paper_request_idx ON treasury_paper_runs(tenant_id,request_key)");
    await pool.query("CREATE INDEX IF NOT EXISTS treasury_paper_tenant_created_idx ON treasury_paper_runs(tenant_id,created_at)");
    await pool.query("CREATE INDEX IF NOT EXISTS treasury_paper_lease_idx ON treasury_paper_runs(tenant_id,status,lease_until)");
  })().catch(error => { ready=undefined; throw error; });
  await ready;
}
function view(row: Record<string, any>): PaperRun {
  return {id:row.id,request_key:row.request_key,status:row.status,options:row.options,result:row.result,error:row.error,
    created_at:new Date(row.created_at).toISOString(),finished_at:row.finished_at?new Date(row.finished_at).toISOString():null,
    reviewing:row.reviewing,review:row.review,review_error:row.review_error,
    review_attempted_at:row.review_attempted_at?new Date(row.review_attempted_at).toISOString():null};
}
export async function listPaperComparisonRuns(tenantId: number, ids: string[]): Promise<PaperRun[]> {
  requirePaperOwner(tenantId);
  const result = await pool.query("SELECT * FROM treasury_paper_runs WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at", [tenantId,ids]);
  return result.rows.map(view);
}
async function expire(tenantId: number) {
  await pool.query(`UPDATE treasury_paper_runs SET
    status=CASE WHEN status='running' THEN 'failed' ELSE status END,
    error=CASE WHEN status='running' THEN 'Interrupted operation; no automatic retry' ELSE error END,
    finished_at=CASE WHEN status='running' THEN now() ELSE finished_at END,
    review_error=CASE WHEN reviewing THEN 'Interrupted review; no automatic retry' ELSE review_error END,
    reviewing=false WHERE tenant_id=$1 AND lease_until < now() AND (status='running' OR reviewing)`,[tenantId]);
}
export async function getPaperRun(tenantId: number, id: string): Promise<PaperRun> {
  requirePaperOwner(tenantId); paperId(id); await ensurePaperSchema(); await expire(tenantId);
  const r=await pool.query("SELECT * FROM treasury_paper_runs WHERE tenant_id=$1 AND id=$2",[tenantId,id]);
  if (!r.rows[0]) throw new Error("Simulation not found");
  return view(r.rows[0]);
}
export async function listPaperRuns(tenantId: number): Promise<PaperRun[]> {
  requirePaperOwner(tenantId); await ensurePaperSchema(); await expire(tenantId);
  const r=await pool.query("SELECT * FROM treasury_paper_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30",[tenantId]);
  return r.rows.map(view);
}
export async function claimPaperRun(tenantId: number, key: string, options: PaperOptions): Promise<{run:PaperRun;claimed:boolean}> {
  requirePaperOwner(tenantId); paperId(key); await ensurePaperSchema();
  const digest=createHash("sha256").update(JSON.stringify(options)).digest("hex");
  const client=await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(660201,$1)",[tenantId]);
    const prior=await client.query("SELECT * FROM treasury_paper_runs WHERE tenant_id=$1 AND request_key=$2 FOR UPDATE",[tenantId,key]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_digest!==digest) throw new Error("Operation key conflicts with different options");
      await client.query("COMMIT"); return {run:view(prior.rows[0]),claimed:false};
    }
    requirePaperEnabled();
    if(options.mode==="jev_shadow" && !getTypeSafeJevStatus().ready) throw new Error("Jev shadow unavailable; configure existing Jev integration or select rules explicitly");
    const busy=await client.query("SELECT id FROM treasury_paper_runs WHERE tenant_id=$1 AND lease_until>now() AND (status='running' OR reviewing) LIMIT 1",[tenantId]);
    if (busy.rows.length) throw new Error("Another simulation or review is running");
    const count=await client.query("SELECT count(*)::int AS n FROM treasury_paper_runs WHERE tenant_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[tenantId]);
    if (count.rows[0].n>=PAPER_DAILY_LIMIT) throw new Error("Daily simulation limit reached (20 attempts)");
    const r=await client.query(`INSERT INTO treasury_paper_runs(id,tenant_id,request_key,request_digest,options,lease_until)
      VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '180 seconds') RETURNING *`,[randomUUID(),tenantId,key,digest,JSON.stringify(options)]);
    await client.query("COMMIT"); return {run:view(r.rows[0]),claimed:true};
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function savePaperBars(tenantId:number,id:string,bars:PaperBar[]) {
  requirePaperOwner(tenantId);
  await pool.query("UPDATE treasury_paper_runs SET source_bars=$3::jsonb WHERE tenant_id=$1 AND id=$2 AND status='running' AND lease_until>now()",[tenantId,id,JSON.stringify(bars)]);
}
export async function finishPaperRun(tenantId:number,id:string,result:PaperResult|null,error:string|null) {
  requirePaperOwner(tenantId);
  await pool.query(`UPDATE treasury_paper_runs SET status=$3,result=$4::jsonb,error=$5,finished_at=now()
    WHERE tenant_id=$1 AND id=$2 AND status='running' AND lease_until>now()`,[tenantId,id,result?"completed":"failed",JSON.stringify(result),error]);
}
export async function claimPaperReview(tenantId:number,id:string): Promise<{run:PaperRun;claimed:boolean}> {
  requirePaperOwner(tenantId); paperId(id); await ensurePaperSchema();
  const c=await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock(660201,$1)",[tenantId]);
    const r=await c.query("SELECT * FROM treasury_paper_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenantId,id]);
    if (!r.rows[0] || r.rows[0].status!=="completed") throw new Error("A completed simulation is required");
    if (r.rows[0].review_attempted_at) { await c.query("COMMIT"); return {run:view(r.rows[0]),claimed:false}; }
    requirePaperEnabled();
    const busy=await c.query("SELECT id FROM treasury_paper_runs WHERE tenant_id=$1 AND lease_until>now() AND (status='running' OR reviewing) LIMIT 1",[tenantId]);
    if (busy.rows.length) throw new Error("Another simulation or review is running");
    const count=await c.query("SELECT count(*)::int AS n FROM treasury_paper_runs WHERE tenant_id=$1 AND review_attempted_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[tenantId]);
    if(count.rows[0].n>=PAPER_DAILY_LIMIT) throw new Error("Daily review limit reached (20 attempts)");
    const claimed=await c.query(`UPDATE treasury_paper_runs SET reviewing=true,review_attempted_at=now(),
      lease_until=now()+interval '180 seconds' WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id]);
    await c.query("COMMIT"); return {run:view(claimed.rows[0]),claimed:true};
  } catch(error) { await c.query("ROLLBACK"); throw error; } finally {c.release();}
}
export async function finishPaperReview(tenantId:number,id:string,review:PaperRun["review"],error:string|null) {
  requirePaperOwner(tenantId);
  await pool.query("UPDATE treasury_paper_runs SET reviewing=false,review=$3::jsonb,review_error=$4 WHERE tenant_id=$1 AND id=$2 AND reviewing AND lease_until>now()",[tenantId,id,JSON.stringify(review),error]);
}
export async function assertPaperReviewLease(tenantId:number,id:string):Promise<void> {
  requirePaperOwner(tenantId); requirePaperEnabled();
  const r=await pool.query(`SELECT id FROM treasury_paper_runs WHERE tenant_id=$1 AND id=$2
    AND status='completed' AND reviewing AND lease_until>now()+interval '45 seconds'`,[tenantId,id]);
  if(!r.rows.length) throw new Error("Review lease is no longer eligible for inference");
}
