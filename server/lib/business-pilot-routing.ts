/** Intent only: actual authority is still checked by the guarded executor. */
export function isInteractivePilotRequest(
  content: string, personaId: number | undefined | null,
  tenantId: number | undefined | null, ownerId: number,
): boolean {
  return tenantId === ownerId && (personaId === 2 || personaId === 3) &&
    /\b(?:business[_ -]?pilots?|(?:health|release|governance|cost|readiness|website)[ -]+pilots?|health baseline|health re[- ]?scan|business health|release[- ]readiness|release readiness|governance evidence|cost(?:\/| and |[- ])routing|model[- ]routing audit|website readiness|agent[- ]readiness)\b/i.test(content);
}

export function requiresPilotTool(content: string): boolean {
  if (/\b(?:without|no)\s+(?:any\s+)?tools\b/i.test(content) ||
      /\b(?:do not|don't|never)\s+(?:call|invoke|run|execute|use)\s+(?:(?:any|the|these)\s+)?(?:(?:business[_ -]?|(?:health|release|governance|cost|readiness|website)[ -]+)?pilots?|tools)\b/i.test(content)) return false;
  return /\b(?:call|invoke|run|execute|calculate|analy[sz]e|inspect|scan|list|retrieve|get|fetch|read|describe|show|compare|review|check)\b/i.test(content);
}

/** Completion hints never authorize execution: the ordinary tool guard still
 * owns every call. Failed/uncertain calls stop forcing, never cause a retry. */
export function pilotToolStillNeeded(
  content: string, executed: ReadonlyArray<{ name: string; input?: any; output?: any }>,
): boolean {
  if (!requiresPilotTool(content)) return false;
  const decode = (value: any) => {
    try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return undefined; }
  };
  const attempts = executed.filter(tool => tool.name === "business_pilot")
    .map(tool => ({ input: decode(tool.input), output: decode(tool.output) }));
  if (attempts.some(tool => tool.output?.ok !== true)) return false;
  // Exact explicit argument tuples are a bounded plan, not inferred input data.
  const goals = Array.from(content.matchAll(/"action"\s*:\s*"(describe|run|list|get)"\s*,\s*"kind"\s*:\s*"(health|release|governance|cost|readiness)"/g))
    .slice(0, 20).map(match => ({ action: match[1], kind: match[2] }));
  const natural = content.match(/\b(describe|run|list|get|retrieve)\s+(?:the\s+)?(health|release|governance|cost|readiness|website)\s+pilot/i);
  if (!goals.length && natural) goals.push({
    action: natural[1].toLowerCase() === "retrieve" ? "get" : natural[1].toLowerCase(),
    kind: natural[2].toLowerCase() === "website" ? "readiness" : natural[2].toLowerCase(),
  });
  return goals.length ? goals.some(goal => !attempts.some(tool =>
    tool.input?.action === goal.action && tool.input?.kind === goal.kind))
    : attempts.length === 0;
}
