import fs from "node:fs";

const STATUS = "/tmp/verifier-bg/status.log";

(async () => {
  fs.mkdirSync("/tmp/verifier-bg", { recursive: true });
  fs.writeFileSync(STATUS, `[start] ${new Date().toISOString()}\n`);
  const { verifyProposalById } = await import("../server/proposal-verifier");
  const ids = process.argv.slice(2).map((s) => parseInt(s, 10)).filter(Number.isFinite);
  if (!ids.length) {
    fs.appendFileSync(STATUS, "[fatal] no proposal ids supplied\n");
    process.exit(1);
  }
  for (const id of ids) {
    const t0 = Date.now();
    fs.appendFileSync(STATUS, `[run ] #${id} at ${new Date().toISOString()}\n`);
    try {
      const r = await verifyProposalById(id);
      fs.appendFileSync(
        STATUS,
        `[done] #${id} -> ${r.status} in ${r.durationMs ?? Date.now() - t0}ms — ${(r.details || "").slice(0, 220).replace(/\n/g, " ")}\n`,
      );
    } catch (e) {
      fs.appendFileSync(STATUS, `[fail] #${id} -> ${(e as Error).message}\n`);
    }
  }
  fs.appendFileSync(STATUS, `[done] all finished ${new Date().toISOString()}\n`);
  process.exit(0);
})().catch((e) => {
  fs.appendFileSync(STATUS, `[fatal] ${e?.message || e}\n`);
  process.exit(1);
});
