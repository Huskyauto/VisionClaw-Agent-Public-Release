/** Format-only recovery of one observed omission: the final section object and
 * sections array were not closed before the top-level unknowns property.
 * Never infer prose, repair strings, drop fields, or complete truncated output. */
export function parseCompilationJson(text: string): unknown {
  const input = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown, original: unknown;
  let valid = false;
  try { parsed = JSON.parse(input); valid = true; } catch (error) { original = error; }
  const failure = original ?? new SyntaxError("Ambiguous compilation JSON keys");
    const stack: string[] = [];
    const keyScopes: (Set<string> | null)[] = [];
    const candidates: number[] = [];
    let unknownKeys = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === '"') {
        const start = i;
        for (i++; i < input.length; i++) {
          if (input[i] === "\\") i++;
          else if (input[i] === '"') break;
        }
        if (i >= input.length) throw failure;
        if (/^\s*:/.test(input.slice(i + 1))) {
          const key = JSON.parse(input.slice(start, i + 1));
          const keys = keyScopes.at(-1);
          if (!keys || keys.has(key)) throw failure;
          keys.add(key);
          if (key === "unknowns") unknownKeys++;
        }
      } else if (char === "{" || char === "[") {
        stack.push(char);
        keyScopes.push(char === "{" ? new Set<string>() : null);
      }
      else if (char === "}" || char === "]") {
        keyScopes.pop();
        if (stack.pop() !== (char === "}" ? "{" : "[")) throw failure;
      } else if (char === "," && stack.join("") === "{[{" &&
          /^,\s*"unknowns"\s*:/.test(input.slice(i))) {
        candidates.push(i);
      }
    }
    if (valid) return parsed;
    if (unknownKeys !== 1 || candidates.length !== 1 || stack.join("") !== "{[") throw failure;
    const at = candidates[0];
    const repaired = JSON.parse(input.slice(0, at) + "}]" + input.slice(at));
    // Exact target shape only. Full report/citation/size validation follows.
    if (Object.keys(repaired).sort().join(",") !== "sections,unknowns" ||
        !Array.isArray(repaired.unknowns) || !Array.isArray(repaired.sections) ||
        repaired.sections.length !== 6 ||
        repaired.sections.some((s: any) => !s || Object.keys(s).sort().join(",") !== "blocks,heading"))
      throw failure;
    return repaired;
}
