// R125+137.24 — Hard tool-router cap enforcement (ChatGPT 5.6 external-review
// finding, verified on main: routeTools() added WHOLE categories and broke only
// after the selection already crossed maxTools, then never sliced back — one
// large category could overshoot the cap substantially, inflating prompt/schema
// token cost and degrading tool selection).
//
// Pure logic lives here (no imports) so the invariant test can run without
// pulling the router's DB-touching dependency chain (tool-curator → pg pool),
// which hangs node:test at exit.
//
// Semantics:
// - ALWAYS_INCLUDE tools are never trimmed (they're the safe fallback set); the
//   effective cap is therefore max(maxTools, alwaysCount) when the always-set
//   alone exceeds maxTools.
// - Remaining tools are trimmed by PRIORITY ORDER: the caller passes the
//   insertion-ordered name list (Set iteration order = ALWAYS_INCLUDE first,
//   then categories in score order, then related expansion, then semantic
//   adds), so the lowest-priority additions are dropped first.
// - This must run BEFORE any escape-hatch checks the caller wants to preserve
//   are bypassed — callers keep their own "return allTools" branches; this
//   helper only ever shrinks a list, never grows it.

export type CappableTool = { function: { name: string } };

export function enforceToolCap<T extends CappableTool>(
  tools: T[],
  maxTools: number,
  alwaysInclude: ReadonlySet<string>,
  priorityOrder: Iterable<string>,
): { tools: T[]; trimmed: number } {
  if (!Number.isFinite(maxTools) || maxTools <= 0 || tools.length <= maxTools) {
    return { tools, trimmed: 0 };
  }
  const order = new Map<string, number>();
  let i = 0;
  for (const name of priorityOrder) {
    if (!order.has(name)) order.set(name, i++);
  }
  const head = tools.filter(t => alwaysInclude.has(t.function.name));
  const tail = tools
    .filter(t => !alwaysInclude.has(t.function.name))
    .sort(
      (a, b) =>
        (order.get(a.function.name) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.function.name) ?? Number.MAX_SAFE_INTEGER),
    );
  const budget = Math.max(0, maxTools - head.length);
  if (tail.length <= budget) return { tools, trimmed: 0 };
  return { tools: [...head, ...tail.slice(0, budget)], trimmed: tail.length - budget };
}

/** Rough tool-schema token estimate (chars/4) — schema size, not tool count,
 *  is the real prompt-cost driver; logged per routed turn for observability. */
export function estimateSchemaTokens(tools: unknown[]): number {
  try {
    return Math.round(JSON.stringify(tools).length / 4);
  } catch {
    return -1;
  }
}
