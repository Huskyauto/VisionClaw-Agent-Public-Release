// Populate canonical identity fixtures without running the application seed,
// enabling autonomous workers, or connecting to a non-disposable database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

interface Snapshot {
  personaDocs: Record<string, {
    identity: string; soul: string; operatingLoop: string;
    expectedToolsDoc: string | null;
  }>;
  defaultPersonas: Array<{
    name: string; role: string; isActive: boolean; identity?: string; soul?: string;
  }>;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert(["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname),
    "CI persona fixture requires a loopback database");
  assert(["/visionclaw_test", "/ci_repair"].includes(url.pathname),
    "CI persona fixture requires a disposable test database");
  assert.notEqual(process.env.NODE_ENV, "production");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ci-persona-snapshot-"));
  const out = path.join(dir, "snapshot.json");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const snapshot = (): Snapshot => {
    const child = spawnSync(process.execPath, [
      "--import", "tsx", "scripts/persona-identity-snapshot.ts",
    ], {
      env: { ...process.env, PERSONA_SNAPSHOT_OUT: out },
      encoding: "utf8", timeout: 60_000, maxBuffer: 2_000_000,
    });
    assert.equal(child.status, 0, `Canonical snapshot failed: ${child.stderr}`);
    return JSON.parse(readFileSync(out, "utf8"));
  };
  try {
    const initial = snapshot();
    // IDs come from PERSONA_DOCS, never DEFAULT_PERSONAS array order (which
    // intentionally omits some live identities and retires others).
    for (const [idText, docs] of Object.entries(initial.personaDocs)) {
      const id = Number(idText);
      assert(Number.isInteger(id) && id > 0);
      const name = /^You are (?:the )?([^,\n]+?)(?:,| of VisionClaw Corporation\.)/
        .exec(docs.identity)?.[1];
      assert(name, `Canonical identity #${id} has no supported fixture name`);
      const persona = initial.defaultPersonas.find((p) => p.name === name);
      const updated = await pool.query(
        `UPDATE personas SET name=$2, role=$3, identity=$4, soul=$5,
           operating_loop=$6 WHERE id=$1 RETURNING id`,
        [id, name, persona?.role || "CI identity fixture",
          docs.identity, docs.soul, docs.operatingLoop],
      );
      assert.equal(updated.rowCount, 1, "Minimal FK fixture must run first");
    }
    for (const persona of initial.defaultPersonas.filter((p) => p.isActive)) {
      await pool.query(
        `INSERT INTO personas (name, role, identity, soul, is_active, safety_profile)
         SELECT $1,$2,$3,$4,true,$5::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM personas WHERE name=$1)`,
        [persona.name, persona.role, persona.identity || "", persona.soul || "",
          JSON.stringify({ intentGate: "moderate",
            restrictedCategories: ["credential_exposure", "tenant_isolation_bypass"],
            ahbRegression: true })],
      );
    }
    // Tool-doc composition reads the roster. Recompute after names are correct,
    // and refuse to substitute an empty doc when its proof cannot be computed.
    const canonical = snapshot();
    for (const [id, docs] of Object.entries(canonical.personaDocs)) {
      assert.equal(typeof docs.expectedToolsDoc, "string");
      await pool.query("UPDATE personas SET tools_doc=$2 WHERE id=$1",
        [Number(id), docs.expectedToolsDoc]);
    }
    console.log("Disposable CI persona identity and tools-doc fixtures initialized.");
  } finally {
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
