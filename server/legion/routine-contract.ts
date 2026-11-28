export type RoutineContract =
  | { kind: "extraction"; fields: Record<string, "string" | "number" | "boolean"> }
  | { kind: "classification"; labels: readonly string[] }
  | { kind: "text"; minChars: number; maxChars: number }
  | { kind: "transform"; expectedRows: number }
  | { kind: "exact"; expected: string }
  | { kind: "validated"; parse: (text: string) => unknown };

export function normalizeExactAnswer(value: string): string {
  return value.trim().replace(/^\\boxed\{([^{}]*)\}$/, "$1")
    .replace(/^\$\s*\\boxed\{([^{}]*)\}\s*\$$/, "$1").replace(/\s+/g, "").toLowerCase();
}

/** Server-owned contracts only: source data cannot replace the checker. */
export function validateRoutineOutput(text: string, contract: RoutineContract): unknown {
  if (typeof text !== "string" || !text.trim()) throw Error("Empty local output");
  const clean = text.trim();
  switch (contract.kind) {
    case "classification":
      if (!contract.labels.length || !contract.labels.includes(clean)) throw Error("Unknown classification label");
      return clean;
    case "extraction": {
      const parsed = JSON.parse(clean);
      const keys = Object.keys(contract.fields);
      if (!keys.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          Object.keys(parsed).length !== keys.length ||
          keys.some(key => !Object.hasOwn(parsed, key) || typeof parsed[key] !== contract.fields[key] ||
            (contract.fields[key] === "number" && !Number.isFinite(parsed[key]))))
        throw Error("Extracted field shape mismatch");
      return parsed;
    }
    case "text":
      if (!Number.isSafeInteger(contract.minChars) || !Number.isSafeInteger(contract.maxChars) ||
          contract.minChars < 1 || contract.maxChars < contract.minChars || contract.maxChars > 12_000 ||
          clean.length < contract.minChars || clean.length > contract.maxChars)
        throw Error("Local text outside required bounds");
      return clean;
    case "transform": {
      const parsed = JSON.parse(clean);
      if (!Number.isSafeInteger(contract.expectedRows) || contract.expectedRows < 0 ||
          !Array.isArray(parsed) || parsed.length !== contract.expectedRows)
        throw Error("Transformed row count mismatch");
      return parsed;
    }
    case "exact":
      if (normalizeExactAnswer(clean) !== normalizeExactAnswer(contract.expected))
        throw Error("Local exact answer mismatch");
      return clean;
    case "validated":
      return contract.parse(clean);
    default:
      throw Error("Unsupported local output contract");
  }
}
