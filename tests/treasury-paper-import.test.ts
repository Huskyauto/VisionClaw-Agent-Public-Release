import { test } from "node:test";
import assert from "node:assert/strict";
import type { ComparisonDatabase } from "../server/lib/treasury-paper-import";

function memoryDatabase() {
  const rows = new Map<string, Record<string, unknown>>();
  const statements: string[] = [];
  let snapshot = new Map(rows);
  let released = 0;
  const database: ComparisonDatabase = { connect: async () => ({
    query: async (text, values = []) => {
      statements.push(text);
      if (text === "BEGIN") snapshot = new Map(rows);
      if (text === "ROLLBACK") { rows.clear(); for (const [key,row] of snapshot) rows.set(key,row); }
      if (text.startsWith("SELECT id,")) return { rows: [...rows.values()].filter(row => row.tenant_id === values[0] && (row.id === values[1] || row.request_key === values[1])) };
      if (text.startsWith("INSERT")) {
        const [id,tenant,options,bars,result,created,finished,digest] = values;
        if (rows.has(String(id))) throw new Error("duplicate key");
        rows.set(String(id), { id,tenant_id:tenant,status:"completed",options:JSON.parse(String(options)),
          source_bars:JSON.parse(String(bars)),result:JSON.parse(String(result)),created_at:created,finished_at:finished,request_digest:digest });
      }
      return { rows: [] };
    },
    release: () => { released++; },
  }) };
  return { database, rows, statements, released: () => released };
}

test("saved comparisons contain exactly the twelve approved completed crypto runs", async () => {
  const { approvedComparisons } = await import("../server/lib/treasury-paper-import");
  const rows = approvedComparisons();
  assert.equal(rows.length, 12);
  for (const symbol of ["BTC-USD", "ETH-USD", "SOL-USD"]) {
    assert.deepEqual(rows.filter(row => row.options.symbol === symbol).map(row => row.options.strategy).sort(),
      ["breakout", "reversion", "rsi", "trend"]);
  }
});

test("approved archive imports refuse non-owner scope before opening a database connection", async () => {
  const { importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  let connected = false;
  await assert.rejects(importApprovedComparisons(999999, {
    connect: async () => { connected = true; throw new Error("must not connect"); },
  }), /owner/);
  assert.equal(connected, false);
});

test("import preserves all twelve exact records, while retry inserts nothing", async () => {
  const { approvedComparisons, importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  const db = memoryDatabase();
  assert.deepEqual(await importApprovedComparisons(ownerTenantId(), db.database), { imported:12,existing:0,total:12 });
  assert.deepEqual(await importApprovedComparisons(ownerTenantId(), db.database), { imported:0,existing:12,total:12 });
  assert.equal(db.rows.size,12);
  for (const source of approvedComparisons()) {
    const persisted = db.rows.get(source.id)!;
    for (const key of ["options","source_bars","result","created_at","finished_at"] as const) assert.deepEqual(persisted[key], source[key]);
    assert.equal(persisted.tenant_id, ownerTenantId());
  }
  assert.equal(db.released(), 2);
  assert.equal(db.statements.filter(s => s.startsWith("INSERT")).length,12);
});

test("a conflict after earlier inserts rolls back the whole batch without overwriting evidence", async () => {
  const { approvedComparisons, importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  const db = memoryDatabase();
  const conflicting = approvedComparisons()[3];
  db.rows.set(conflicting.id, { ...conflicting, tenant_id:ownerTenantId(),status:"failed" });
  await assert.rejects(importApprovedComparisons(ownerTenantId(),db.database), /conflicts/);
  assert.equal(db.rows.size,1);
  assert.equal(db.rows.get(conflicting.id)?.status,"failed");
  assert.ok(db.statements.includes("ROLLBACK"));
  assert.equal(db.released(),1);
});

test("the owner kill switch blocks imports before connecting", async () => {
  const { importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  const old = process.env.TREASURY_PAPER_DISABLED;
  process.env.TREASURY_PAPER_DISABLED = "1";
  let connected = false;
  try {
    await assert.rejects(importApprovedComparisons(ownerTenantId(),{
      connect:async()=>{ connected=true; throw new Error("must not connect"); },
    }), /disabled/);
    assert.equal(connected,false);
  } finally {
    if (old === undefined) delete process.env.TREASURY_PAPER_DISABLED;
    else process.env.TREASURY_PAPER_DISABLED = old;
  }
});

test("two identity matches refuse the import even if the first record is valid", async () => {
  const { approvedComparisons, importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  const db = memoryDatabase();
  const valid = approvedComparisons()[0];
  db.rows.set(valid.id,{...valid,tenant_id:ownerTenantId(),status:"completed"});
  const alias = "00000000-0000-4000-8000-000000000001";
  db.rows.set(alias,{...valid,id:alias,request_key:valid.id,tenant_id:ownerTenantId(),status:"completed"});
  await assert.rejects(importApprovedComparisons(ownerTenantId(),db.database),/conflicts/);
  assert.equal(db.rows.size,2);
  assert.ok(db.statements.includes("ROLLBACK"));
});

test("PostgreSQL Date objects retain original millisecond timestamps on idempotent import", async () => {
  const { approvedComparisons, importApprovedComparisons } = await import("../server/lib/treasury-paper-import");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  const db = memoryDatabase();
  for (const record of approvedComparisons()) {
    db.rows.set(record.id,{...record,tenant_id:ownerTenantId(),status:"completed",
      created_at:new Date(record.created_at),finished_at:new Date(record.finished_at)});
  }
  assert.deepEqual(await importApprovedComparisons(ownerTenantId(),db.database),{imported:0,existing:12,total:12});
  assert.equal(db.statements.filter(statement=>statement.startsWith("INSERT")).length,0);
});

test("archived tracks independently reproduce from original candles without fetching or inference", async () => {
  const { approvedComparisons } = await import("../server/lib/treasury-paper-import");
  const { replayPaper } = await import("../server/lib/treasury-paper-core");
  for (const record of approvedComparisons()) {
    const canonicalBars = record.source_bars.map(({date,open,high,low,close,volume})=>({date,open,high,low,close,volume}));
    const calculated = await replayPaper(canonicalBars,record.options);
    for (const key of ["dataDigest","startDate","endDate","engineVersion","strategyVersion","rule","benchmark","excessReturnPct"] as const) {
      assert.deepEqual(calculated[key],record.result[key],`${record.options.symbol}/${record.options.strategy}: ${key}`);
    }
  }
});

test("comparison routes enforce platform admin, canonical owner, and existing CSRF middleware", async () => {
  const { default: express } = await import("express");
  const { registerTreasuryPaperRoutes } = await import("../server/routes/treasury-paper");
  const { createCsrfMiddleware } = await import("../server/validation");
  const { ownerTenantId } = await import("../server/agentic/autonomous-budget");
  let tenantId: number | null = null, admin = false;
  const app = express();
  app.use(createCsrfMiddleware(()=>tenantId));
  registerTreasuryPaperRoutes(app,{
    getTenantFromRequest:()=>tenantId,
    requirePlatformAdmin:(_req,res)=>{
      if (!admin) { res.status(401).json({error:"Not an admin"}); return false; }
      return true;
    },
    mutateLimiter:(_req:unknown,_res:unknown,next:()=>void)=>next(),
  });
  const server = app.listen(0);
  try {
    await new Promise<void>(resolve=>server.once("listening",resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    for (const [path,method] of [["comparisons","GET"],["comparisons/import","POST"]]) {
      assert.equal((await fetch(`${base}/api/treasury/paper/${path}`,{method})).status,401);
    }
    admin = true;
    tenantId = ownerTenantId()+100000;
    assert.equal((await fetch(`${base}/api/treasury/paper/comparisons`)).status,403);
    tenantId = ownerTenantId();
    const refused = await fetch(`${base}/api/treasury/paper/comparisons/import`,{method:"POST"});
    assert.equal(refused.status,403);
    assert.match(await refused.text(), /CSRF/);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
