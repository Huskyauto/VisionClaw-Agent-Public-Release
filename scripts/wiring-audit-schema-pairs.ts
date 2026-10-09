/**
 * SCHEMA-FIELD-COVERAGE registry consumed by `verify-agent-wiring.ts` Check 7.
 *
 * Each entry says: "this TS engine type should be mirrored by this JSON-schema
 * fragment inside this tool definition. If the engine has a field the schema
 * doesn't expose, the LLM cannot reach it — fail the audit."
 *
 * This catches the R125+13.16 Veo class of bug where MpegScene gained a
 * `videoClipPrompt` field and the engine wired it through, but the
 * `mpeg_produce` JSON-schema never advertised it — Felix and every other
 * persona literally could not invoke the new feature.
 *
 * HOW TO ADD A PAIR:
 *  1. Identify the TS interface (or `type`) that the engine accepts.
 *  2. Find the tool in `server/tools.ts` whose handler ultimately receives it.
 *  3. Write the dotted path from the tool's top-level `parameters.properties`
 *     down to the `properties` block that mirrors that interface. For an
 *     array-of-objects, use `<name>.items`.
 *  4. List any fields that are intentionally NOT exposed to the LLM in
 *     `ignoreEngineFields` (e.g. internal-only side-channels).
 *
 * Parser limits (deliberately shallow — keeps the audit cheap + readable):
 *  - The engine type must be a single `interface` or `type =` block where
 *    each property is on its own line and matches `<name>?: <type>;` or
 *    `<name>: <type>;`. Comments and multi-line types are tolerated.
 *  - The tool schema must be a single `{ name: "<toolName>", ... }` block
 *    inside `TOOL_DEFINITIONS`. Nested `properties: { ... }` are matched at
 *    `{` / `}` brace depth.
 */
export interface SchemaPair {
  engineTypeFile: string;
  engineTypeName: string;
  toolName: string;
  /**
   * Dotted path from the tool's top-level `properties` down to the
   * properties block that should mirror the interface. Use `<name>.items`
   * to descend into an array's items.
   */
  schemaPath: string;
  /** Engine fields that intentionally do NOT appear in the LLM schema. */
  ignoreEngineFields?: string[];
}

export const SCHEMA_PAIRS: SchemaPair[] = [
  // R125+13.16+wire — the bug this check was built to catch.
  {
    engineTypeFile: "server/mpeg-engine.ts",
    engineTypeName: "MpegScene",
    toolName: "mpeg_produce",
    schemaPath: "scenes.items",
    // All current MpegScene fields are user-callable. Add to this list ONLY
    // if a future field is intentionally engine-internal (output-side, voice
    // cloning gated behind another tool, etc.).
    ignoreEngineFields: [],
  },
  // R125+13.16+sec2 — companion pair for the parallel-produce path. Same
  // MpegScene engine type, different nesting: chapters[].scenes[]. Catches
  // the asymmetry where mpeg_produce gets a new field but mpeg_produce_parallel
  // forgets to mirror it (or vice-versa).
  {
    engineTypeFile: "server/mpeg-engine.ts",
    engineTypeName: "MpegScene",
    toolName: "mpeg_produce_parallel",
    schemaPath: "chapters.items.scenes.items",
    ignoreEngineFields: [],
  },

  // R125+13.16+wire3 — Felix's premium-PDF path.
  // server/tools.ts:11479 routes `create_styled_report` straight into
  // generateStyledPdf(opts: StyledPdfOptions) at server/pdf-create.ts:914.
  // The schema needs to mirror every user-callable field on the interface
  // or Felix can't reach it.
  {
    engineTypeFile: "server/pdf-create.ts",
    engineTypeName: "StyledPdfOptions",
    toolName: "create_styled_report",
    schemaPath: "", // top-level — tool's parameters.properties IS the StyledPdfOptions mirror
    ignoreEngineFields: [
      // Server-injected from the calling tenant context, never sent by the LLM.
      "tenantId",
      // Drive upload is forced-on by the handler (not exposed as a per-call
      // LLM toggle in the tool schema; the engine default is upload=true unless
      // opts.uploadToDrive === false, which the handler never sets).
      "uploadToDrive",
    ],
  },
];
