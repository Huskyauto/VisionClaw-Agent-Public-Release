import type { Express, Request, Response, NextFunction } from "express";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { listPaperRuns, getPaperRun, listPaperComparisonRuns } from "../lib/treasury-paper-store";
import { startPaperRun, startPaperReview, paperStatus } from "../lib/treasury-paper-service";
import { approvedComparisons, importApprovedComparisons } from "../lib/treasury-paper-import";
export function registerTreasuryPaperRoutes(app:Express, helpers:{
  getTenantFromRequest:(req:Request)=>number|null;
  requirePlatformAdmin:(req:Request,res:Response)=>boolean;
  mutateLimiter:any;
}) {
  const guard=(req:Request,res:Response,next:NextFunction)=>{
    if(!helpers.requirePlatformAdmin(req,res)) return;
    if(helpers.getTenantFromRequest(req)!==ownerTenantId()) { res.status(403).json({error:"Owner-only paper simulation"}); return; }
    next();
  };
  const fail=(res:Response,error:unknown)=>res.status(400).json({error:error instanceof Error?error.message:"Paper simulation failed"});
  app.get("/api/treasury/paper/status",guard,(_req,res)=>res.json(paperStatus()));
  app.get("/api/treasury/paper/comparisons",guard,async(req,res)=>{
    try {
      const records = approvedComparisons();
      res.json({runs:await listPaperComparisonRuns(helpers.getTenantFromRequest(req)!,records.map(record=>record.id)),available:records.length});
    } catch(e) { fail(res,e); }
  });
  app.post("/api/treasury/paper/comparisons/import",guard,helpers.mutateLimiter,async(req,res)=>{
    try {
      res.json(await importApprovedComparisons(helpers.getTenantFromRequest(req)!));
    } catch(e) { fail(res,e); }
  });
  app.get("/api/treasury/paper/runs",guard,async(req,res)=>{
    try{res.json({runs:await listPaperRuns(helpers.getTenantFromRequest(req)!)});}catch(e){fail(res,e);}
  });
  app.get("/api/treasury/paper/runs/:id",guard,async(req,res)=>{
    try{res.json(await getPaperRun(helpers.getTenantFromRequest(req)!,String(req.params.id)));}catch(e){fail(res,e);}
  });
  app.post("/api/treasury/paper/runs",guard,helpers.mutateLimiter,async(req,res)=>{
    try{res.status(202).json(await startPaperRun(helpers.getTenantFromRequest(req)!,req.body?.requestKey,req.body?.options));}catch(e){fail(res,e);}
  });
  app.post("/api/treasury/paper/runs/:id/review",guard,helpers.mutateLimiter,async(req,res)=>{
    try{res.status(202).json(await startPaperReview(helpers.getTenantFromRequest(req)!,String(req.params.id)));}catch(e){fail(res,e);}
  });
}
