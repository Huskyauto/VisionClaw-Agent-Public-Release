import { defineTool } from "../../define-tool";
import { treasuryPaperSimulationDefinition } from "./definitions";
export const treasuryPaperSimulationTool=defineTool(treasuryPaperSimulationDefinition,async(params,ctx)=>{
  try {
    if(!ctx.tenantId || ![2,13].includes(ctx.personaId??0)) return {error:"Paper simulations require trusted Felix/Cassandra owner context"};
    const store=await import("../../../lib/treasury-paper-store");
    store.requirePaperOwner(ctx.tenantId);
    if(params.action==="list") return {runs:(await store.listPaperRuns(ctx.tenantId)).map(r=>({
      id:r.id,status:r.status,options:r.options,createdAt:r.created_at,error:r.error,
      metrics:r.result?.rule.metrics,excessReturnPct:r.result?.excessReturnPct,
      shadowCoverage:r.result?.shadow?.coverage,reviewing:r.reviewing,reviewed:!!r.review,
    }))};
    if(params.action==="get") return await store.getPaperRun(ctx.tenantId,store.paperId(params.runId));
    const service=await import("../../../lib/treasury-paper-service");
    if(params.action==="run") {
      if(!ctx.conversationId) return {error:"Simulation runs require an authenticated owner conversation"};
      const {db}=await import("../../../db");
      const {sql}=await import("drizzle-orm");
      const m=await db.execute(sql`SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.id=${ctx.conversationId} AND c.tenant_id=${ctx.tenantId} AND m.tenant_id=${ctx.tenantId}
        AND m.role='user' ORDER BY m.id DESC LIMIT 1`);
      if(!m.rows[0]?.id) return {error:"A trusted owner message is required to start a simulation"};
      const {normalizePaperOptions,derivePaperInvocationKey}=await import("../../../lib/treasury-paper-core");
      const options=normalizePaperOptions(params.options??{});
      // Trusted owner-message identity + canonical options: retries in the SAME
      // owner turn cannot generate fresh spend, even if the first result was lost.
      const key=derivePaperInvocationKey(ctx.tenantId,ctx.conversationId,Number(m.rows[0].id),options);
      return await service.startPaperRun(ctx.tenantId,key,options);
    }
    if(params.action==="review") return await service.startPaperReview(ctx.tenantId,store.paperId(params.runId));
    return {error:"Unknown simulation action"};
  } catch(error) {return {error:error instanceof Error?error.message:"Paper simulation failed"};}
});
