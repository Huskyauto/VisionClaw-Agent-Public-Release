/**
 * Tools-layer-split — procedures domain tool definitions.
 *
 * Selection: the 3 AEvo procedure-edit tools that read ONLY the `_tenantId`
 * trust signal — `list_procedure_edits` (read-only), `apply_procedure_edit` and
 * `rollback_procedure_edit` (destructive; the backend mutators self-enforce the
 * platform-admin tenant gate). In the legacy facade each was an individual
 * switch arm that dispatched into `./lib/aevo-meta-editor`. The sibling review
 * tools (`propose_procedure_edit` / `approve_procedure_edit` /
 * `reject_procedure_edit`) read `_personaName`/`_userId` for attribution and
 * stay legacy — deferred to a trust-seam slice.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const listProcedureEditsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_procedure_edits",
    description: "List this tenant's proposed/approved/applied/rolled_back procedure edits. Read-only. Filterable by status and targetId. Use to inspect the AEvo review queue.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "proposed | approved | rejected | applied | rolled_back" },
        targetId: { type: "string", description: "Filter by playbook slug." },
        limit: { type: "integer", description: "1–200, default 50." },
      },
    },
  },
};

export const applyProcedureEditDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "apply_procedure_edit",
    description: "Apply an APPROVED procedure edit to the actual playbook file. CAS-pinned by sha256 — fails if file changed since proposal. Re-validates against forbidden-pattern + size + frontmatter invariants. Atomically writes the new content and updates the registry sha256+bytes. Destructive — mutates a versioned procedure surface. Always requires fresh HITL approval.",
    parameters: {
      type: "object",
      properties: {
        editId: { type: "integer", description: "procedure_edits.id (must be in status='approved')." },
      },
      required: ["editId"],
    },
  },
};

export const rollbackProcedureEditDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "rollback_procedure_edit",
    description: "Rollback an APPLIED procedure edit. Atomically writes the captured beforeContent back to the playbook and restores the registry entry. Status applied→rolled_back. Destructive — mutates the procedure surface; requires HITL approval.",
    parameters: {
      type: "object",
      properties: {
        editId: { type: "integer", description: "procedure_edits.id (must be in status='applied')." },
        reason: { type: "string", description: "Short reason logged into review_note." },
      },
      required: ["editId", "reason"],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const proceduresDomainDefinitions: ToolDefinition[] = [
  listProcedureEditsDefinition,
  applyProcedureEditDefinition,
  rollbackProcedureEditDefinition,
];
