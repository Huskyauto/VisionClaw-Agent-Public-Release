// One-shot compiler smoke only: deny network and replace external pg driver.
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const target = "server/lib/recurring-next-run.ts";
const original = fs.readFileSync(path.resolve(target), "utf8");
const drift = process.env.VERIFIER_OFFLINE_DRIFT === "1";
const expectedProposalId = drift ? 999998 : 999999;
const oldCode = drift ? "const unmatchedVerifierBaseline = Symbol('offlineBaseline');" : original;
const diff = `<<<OLD_CODE>>>\n${oldCode}\n<<</OLD_CODE>>>\n<<<NEW_CODE>>>\n${original}\nconst offlineInvalidNumber: number = "deliberate type error";\n<<</NEW_CODE>>>`;
let reads = 0, writes = 0;
class OfflinePool extends EventEmitter {
  async query(config, values) {
    const text = typeof config === "string" ? config : config.text;
    const params = values || config.values || [];
    if (text.includes("SELECT id, target_file, code_diff")) {
      if (params[0] !== expectedProposalId || params[1] !== 777) throw new Error("Offline scope mismatch");
      reads++;
      return { rows: [{ id: expectedProposalId, target_file: target, code_diff: diff, validation_result: {} }], rowCount: 1 };
    }
    if (text.includes("UPDATE code_proposals") && text.includes("verification_status")) {
      if (!text.includes("tenant_id =") || !params.includes(777) || params[0] !== "failed") {
        throw new Error("Offline verdict mismatch");
      }
      writes++;
      return { rows: [{ id: 999999 }], rowCount: 1 };
    }
    throw new Error("Unexpected offline SQL blocked");
  }
  async end() {
    if (reads !== 1 || writes !== (drift ? 0 : 1)) throw new Error("Offline verification persistence mismatch");
  }
}
const compile = Module.prototype._compile;
globalThis.__vcOfflinePool = OfflinePool;
Module.prototype._compile = function(source, filename) {
  // pg is bundled, so an external require mock would miss this driver.
  // Bind only this known constructor; leave compiler/guard/protocol unchanged.
  if (path.basename(filename) === "proposal-verifier-child.cjs") {
    const poolConstruction = "pool = new Pool({\n      connectionString: process.env.DATABASE_URL,";
    if (source.split(poolConstruction).length !== 2) {
      throw new Error("Offline bundle database seam changed; refusing network");
    }
    source = source.replace(poolConstruction,
      "pool = new globalThis.__vcOfflinePool({\n      connectionString: process.env.DATABASE_URL,");
  }
  return compile.call(this, source, filename);
};
process.once("exit", () => console.error(`OFFLINE_PG_COUNTS:${reads}:${writes}`));
global.fetch = async () => { throw new Error("Offline smoke network blocked"); };
require("node:net").connect = () => { throw new Error("Offline smoke network blocked"); };
require("node:net").Socket.prototype.connect = () => { throw new Error("Offline smoke network blocked"); };
require("node:tls").connect = () => { throw new Error("Offline smoke network blocked"); };