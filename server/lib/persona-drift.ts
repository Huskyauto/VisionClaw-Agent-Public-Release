/**
 * Task 112 — pure persona-identity drift comparison logic.
 *
 * Persona identities live in TWO source files with different sync rules:
 *   - ids 1–16: PERSONA_DOCS in server/seed-persona-prompts.ts (a direct run
 *     OVERWRITES the DB — DB-only edits get wiped on the next sync);
 *   - ids 17+: DEFAULT_PERSONAS in server/seed.ts (insert-only reconcile —
 *     DB edits persist, but must be mirrored back into seed.ts).
 *
 * This module holds the PURE comparison so it can be unit-tested with
 * fixtures (no DB, no LLM). The suite test
 * tests/security/persona-identity-drift.test.ts feeds it live DB rows plus a
 * SoT snapshot produced by scripts/persona-identity-snapshot.ts.
 */

export interface PersonaSotSnapshot {
  /**
   * PERSONA_DOCS keyed by persona id (as string). `operatingLoop` is the
   * COMPOSED expected value — composeOperatingLoop(docs.operating_loop),
   * i.e. the per-persona loop + UNIVERSAL_OPERATING_CONTRACT — exactly what
   * a seed-persona-prompts re-run would write to the DB (Task 113).
   */
  personaDocs: Record<
    string,
    {
      identity: string;
      soul: string;
      operatingLoop: string;
      /**
       * Task 115 — the ONE expected composed tools_doc value:
       * composeSyncToolsDoc in server/persona-sync.ts (live tool inventory +
       * skills + contract + addendum), the single canonical writer of
       * personas.tools_doc. (Task 114's dual-writer candidate list is gone —
       * the seed runner no longer writes tools_doc; it delegates to
       * syncPersonaDocs.) `null` means the snapshot could not recompute it
       * (e.g. no DB access) — the gate fails CLOSED on that.
       */
      expectedToolsDoc: string | null;
    }
  >;
  /** DEFAULT_PERSONAS literals from server/seed.ts. */
  defaultPersonas: Array<{
    name: string;
    role: string;
    isActive: boolean;
    identity: string;
    soul: string;
  }>;
  /** kind:"agent" names from server/capability-registry.ts. */
  capabilityAgents: string[];
}

export interface DbPersonaRow {
  id: number;
  name: string;
  role: string;
  identity: string;
  soul: string;
  /** Live operating_loop — compared for ids 1–16 only (overwrite-on-sync). */
  operatingLoop: string;
  /** Live tools_doc — compared for ids 1–16 only (overwrite-on-sync, Task 114). */
  toolsDoc: string;
}

/** Highest persona id whose SoT is PERSONA_DOCS (overwrite-on-sync). */
export const PERSONA_DOCS_MAX_ID = 16;

/**
 * Compare live DB persona rows against the source-of-truth literals and the
 * capability registry. Returns a list of human-readable problems; empty
 * array = fully in sync.
 *
 * `dbOnlyAllowlist` names personas whose identity intentionally lives ONLY
 * in the DB (in neither source file). Allowlisted personas are exempt from
 * the SoT comparisons in BOTH directions but still counted for the
 * capability-registry parity check.
 */
export function computePersonaDriftProblems(
  snap: PersonaSotSnapshot,
  activeRows: DbPersonaRow[],
  dbOnlyAllowlist: Record<string, string> = {},
): string[] {
  const problems: string[] = [];
  const defaultsByName = new Map(snap.defaultPersonas.map((p) => [p.name, p]));
  const allowlisted = (name: string) => dbOnlyAllowlist[name] !== undefined;

  for (const row of activeRows) {
    if (allowlisted(row.name)) continue;

    if (row.id <= PERSONA_DOCS_MAX_ID) {
      // SoT = PERSONA_DOCS (overwrite-on-sync). Drift here means either a
      // live DB edit that a re-sync will WIPE, or a source edit that never
      // reached the DB.
      const docs = snap.personaDocs[String(row.id)];
      if (!docs) {
        problems.push(
          `#${row.id} ${row.name}: active in DB but has NO PERSONA_DOCS entry and is not in the DB-only allowlist`,
        );
        continue;
      }
      if (docs.identity !== row.identity) {
        problems.push(
          `#${row.id} ${row.name}: identity drift (SoT=server/seed-persona-prompts.ts). ` +
            `DB len=${row.identity.length}, SoT len=${docs.identity.length}. ` +
            `A seed-persona-prompts re-run would OVERWRITE the DB value.`,
        );
      }
      if (docs.soul !== row.soul) {
        problems.push(
          `#${row.id} ${row.name}: soul drift (SoT=server/seed-persona-prompts.ts). ` +
            `DB len=${row.soul.length}, SoT len=${docs.soul.length}.`,
        );
      }
      // Task 113 — operating_loop is COMPOSED (per-persona loop +
      // UNIVERSAL_OPERATING_CONTRACT) but still overwrite-on-sync for ids
      // 1–16: a live DB edit here is silently WIPED on the next
      // seed-persona-prompts run. Compare against the recomposed expected
      // value from the snapshot.
      if (docs.operatingLoop !== row.operatingLoop) {
        problems.push(
          `#${row.id} ${row.name}: operating_loop drift (SoT=composeOperatingLoop(PERSONA_DOCS[${row.id}].operating_loop) in server/seed-persona-prompts.ts). ` +
            `DB len=${row.operatingLoop.length}, expected len=${docs.operatingLoop.length}. ` +
            `A seed-persona-prompts re-run would OVERWRITE the DB value.`,
        );
      }
      // Task 115 — tools_doc is overwrite-on-sync for ids 1–16 with ONE
      // canonical writer: composeSyncToolsDoc in server/persona-sync.ts
      // (the seed runner no longer writes tools_doc). A DB value that
      // doesn't match the recomputed composition = a live DB edit the next
      // sync will silently WIPE. Fail closed if the expected value could not
      // be computed — an unverifiable field is a failure, never a silent pass.
      const expected = docs.expectedToolsDoc ?? null;
      if (expected === null) {
        problems.push(
          `#${row.id} ${row.name}: tools_doc drift check could not run — no composed expected value in the snapshot ` +
            `(expected composeSyncToolsDoc output; needs DB access to recompute).`,
        );
      } else if (expected !== row.toolsDoc) {
        problems.push(
          `#${row.id} ${row.name}: tools_doc drift — DB value (len=${row.toolsDoc.length}) does not match the canonical writer's composition ` +
            `(composeSyncToolsDoc in server/persona-sync.ts; expected len=${expected.length}). ` +
            `A push-persona-sync (or boot sync) would OVERWRITE the DB value.`,
        );
      }
    } else {
      // SoT = DEFAULT_PERSONAS in server/seed.ts (insert-only). Drift here
      // means a live DB edit that never made it back into the source file.
      const p = defaultsByName.get(row.name);
      if (!p) {
        problems.push(
          `#${row.id} ${row.name}: active in DB but missing from DEFAULT_PERSONAS (server/seed.ts) and not in the DB-only allowlist`,
        );
        continue;
      }
      if (!p.isActive) {
        problems.push(
          `#${row.id} ${row.name}: active in DB but isActive:false in DEFAULT_PERSONAS (server/seed.ts)`,
        );
      }
      if (p.identity !== row.identity) {
        problems.push(
          `#${row.id} ${row.name}: identity drift vs DEFAULT_PERSONAS (server/seed.ts). ` +
            `DB len=${row.identity.length}, SoT len=${p.identity.length}. ` +
            `DB edits persist but MUST be mirrored back into seed.ts.`,
        );
      }
      if (p.soul !== row.soul) {
        problems.push(
          `#${row.id} ${row.name}: soul drift vs DEFAULT_PERSONAS (server/seed.ts). ` +
            `DB len=${row.soul.length}, SoT len=${p.soul.length}.`,
        );
      }
      if (p.role !== row.role) {
        problems.push(
          `#${row.id} ${row.name}: role drift vs DEFAULT_PERSONAS (server/seed.ts). ` +
            `DB="${row.role}" vs SoT="${p.role}".`,
        );
      }
    }
  }

  // Reverse direction 1: every PERSONA_DOCS id must have an active DB row —
  // an orphaned SoT entry means a sync would resurrect/overwrite something
  // nobody expects.
  const dbIds = new Set(activeRows.map((r) => r.id));
  for (const idStr of Object.keys(snap.personaDocs)) {
    const id = Number(idStr);
    if (!dbIds.has(id)) {
      problems.push(
        `PERSONA_DOCS[${id}] exists in server/seed-persona-prompts.ts but there is no active DB persona with that id`,
      );
    }
  }

  // Reverse direction 2: every ACTIVE DEFAULT_PERSONAS source entry must have
  // an active DB row — otherwise a new/renamed 17+ persona in seed.ts that
  // was never seeded (insert-only reconcile only fires for names it hasn't
  // seen) drifts silently. Inactive source entries are the historic literals
  // for ids 1–16 (their SoT moved to PERSONA_DOCS) and are exempt.
  const dbNames = new Set(activeRows.map((r) => r.name));
  const inDocsRange = new Set(
    activeRows.filter((r) => r.id <= PERSONA_DOCS_MAX_ID).map((r) => r.name),
  );
  for (const p of snap.defaultPersonas) {
    if (!p.isActive || allowlisted(p.name)) continue;
    if (inDocsRange.has(p.name)) continue; // e.g. VisionClaw/Minerva — SoT is PERSONA_DOCS
    if (!dbNames.has(p.name)) {
      problems.push(
        `DEFAULT_PERSONAS["${p.name}"] is isActive:true in server/seed.ts but there is no active DB persona with that name — ` +
          `it was never seeded (or was renamed/deactivated in the DB only)`,
      );
    }
  }

  // Capability registry agent entries must exactly equal the active persona
  // names (this is what was 3 personas behind — Echo/Hermes/Robert — on
  // 2026-08-01).
  const capNames = new Set(snap.capabilityAgents);
  for (const name of dbNames) {
    if (!capNames.has(name)) {
      problems.push(
        `capability-registry (server/capability-registry.ts) is missing agent entry for active persona "${name}"`,
      );
    }
  }
  for (const name of capNames) {
    if (!dbNames.has(name)) {
      problems.push(
        `capability-registry lists agent "${name}" but no active persona with that name exists in the DB`,
      );
    }
  }
  if (snap.capabilityAgents.length !== capNames.size) {
    problems.push(
      `duplicate agent names in capability-registry: ${snap.capabilityAgents
        .filter((n, i) => snap.capabilityAgents.indexOf(n) !== i)
        .join(", ")}`,
    );
  }

  return problems;
}
