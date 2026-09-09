/**
 * Task: persona identity drift detection (see tests/security/persona-identity-drift.test.ts).
 *
 * Prints a JSON snapshot of the persona identity source-of-truth literals:
 *   - PERSONA_DOCS (server/seed-persona-prompts.ts) — personas 1–16, overwrite-on-sync
 *   - DEFAULT_PERSONAS (server/seed.ts) — personas 17+, insert-only
 *   - capability-registry agent entries (server/capability-registry.ts)
 *
 * Run in a SUBPROCESS by the drift test — the import chain pulls in
 * server/persona-sync.ts → server/tools.ts, which is too heavy / side-effectful
 * to import inside a node:test process (pg pool hang risk). We print and
 * process.exit(0) so nothing lingers.
 *
 * IMPORTANT: this script performs NO database writes and NO LLM calls.
 * (Task 114 added read-only DB queries — persona names, custom_tools,
 * skills — needed to recompute the persona-sync tools_doc composition.)
 */
import { PERSONA_DOCS, composeOperatingLoop } from "../server/seed-persona-prompts";
import { DEFAULT_PERSONAS_SOT } from "../server/seed";
import { STATIC_CAPABILITIES } from "../server/capability-registry";
import {
  composeSyncToolsDoc,
  type ToolDef,
  type CustomToolRow,
  type SkillRow,
} from "../server/persona-sync";
import { getAllToolDefinitions } from "../server/tools";
import { Pool } from "pg";
import { writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function main() {
  // Task 115 — tools_doc has ONE canonical writer: composeSyncToolsDoc in
  // server/persona-sync.ts (the seed runner no longer writes tools_doc; it
  // delegates to syncPersonaDocs). The composition depends on the LIVE tool
  // inventory + custom_tools + skills, so it can only be recomputed with
  // read-only DB access; without it the expected value stays null and the
  // gate fails CLOSED.
  const expectedToolsDocById: Record<string, string | null> = {};
  for (const id of Object.keys(PERSONA_DOCS)) {
    expectedToolsDocById[id] = null;
  }

  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const allTools = (await getAllToolDefinitions()) as ToolDef[];
      const { ADMIN_TENANT_ID } = await import("../server/auth");
      // Mirror the EXACT queries syncPersonaDocs uses so the recomputed
      // candidate is byte-identical to what a sync run would write.
      const customTools = (
        await pool.query(
          `SELECT id, name, description, is_active, tenant_id FROM custom_tools WHERE is_active = true AND (tenant_id = $1 OR tenant_id IS NULL)`,
          [ADMIN_TENANT_ID],
        )
      ).rows as CustomToolRow[];
      const enabledSkills = (
        await pool.query(`SELECT id, name, category, enabled, persona_id FROM skills WHERE enabled = true`)
      ).rows as SkillRow[];
      const personaNames = (
        await pool.query(`SELECT id, name FROM personas WHERE is_active = true ORDER BY id`)
      ).rows as { id: number; name: string }[];
      for (const p of personaNames) {
        const key = String(p.id);
        if (!(key in expectedToolsDocById)) continue; // only ids with PERSONA_DOCS entries
        expectedToolsDocById[key] = composeSyncToolsDoc(p.id, p.name, allTools, customTools, enabledSkills);
      }
    } finally {
      await pool.end();
    }
  }

  const snapshot = {
    personaDocs: Object.fromEntries(
      Object.entries(PERSONA_DOCS).map(([id, d]) => [
        id,
        {
          identity: d.identity,
          soul: d.soul,
          // Task 113 — the COMPOSED expected operating_loop, exactly what a
          // seed-persona-prompts re-run would write to the DB for this persona.
          operatingLoop: composeOperatingLoop(d.operating_loop),
          // Task 115 — the ONE expected composed tools_doc (canonical writer
          // = persona-sync; null when the DB was unreachable → gate fails closed).
          expectedToolsDoc: expectedToolsDocById[id] ?? null,
        },
      ]),
    ),
    defaultPersonas: DEFAULT_PERSONAS_SOT.map((p: any) => ({
      name: p.name,
      role: p.role,
      isActive: p.isActive,
      identity: p.identity,
      soul: p.soul,
    })),
    capabilityAgents: STATIC_CAPABILITIES.filter((c) => c.kind === "agent").map(
      (c) => c.name,
    ),
  };

  // Task 113 made the snapshot large (~180KB with composed operating loops),
  // and large stdout payloads get TRUNCATED through the npx→tsx pipe chain
  // when the process exits (observed under node --test: mid-JSON cutoff →
  // "markers missing"). So the payload goes to a FILE (synchronous write) and
  // stdout only carries the path between the markers.
  const outFile =
    process.env.PERSONA_SNAPSHOT_OUT ||
    path.join(os.tmpdir(), `persona-identity-snapshot-${process.pid}.json`);
  writeFileSync(outFile, JSON.stringify(snapshot), "utf8");
  console.log("SNAPSHOT_FILE_BEGIN");
  console.log(outFile);
  console.log("SNAPSHOT_FILE_END");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
