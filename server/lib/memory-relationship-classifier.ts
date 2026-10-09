import { createHash } from "node:crypto";
import { certaintyToWeight } from "./deterministic-picker";

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 128;

export const MEMORY_RELATION_MODEL = "gpt-5.4";
export const MEMORY_RELATION_PROMPT = `You classify the relationship between two facts about a user. Output JSON: {"relation": "duplicate|contradiction|update|unrelated", "certainty": "high|medium|low"}

- "duplicate": same information, just worded differently
- "contradiction": directly conflicts (e.g., "lives in Texas" vs "lives in Florida")  
- "update": new fact is a newer version of the old fact (e.g., "works at Acme" vs "works at Globex" — same topic, changed value)
- "unrelated": different topics entirely

"update" and "contradiction" are similar but "update" implies temporal progression (things changed), while "contradiction" implies the facts cannot coexist.

For "certainty", do NOT emit a number — commit to a category: "high" = unambiguous, "medium" = likely but some doubt, "low" = a guess.`;

export interface MemoryRelationship {
  relation: "duplicate" | "contradiction" | "update" | "unrelated";
  confidence: number;
}

interface FactPair {
  newFact: string;
  existingFact: string;
  tenantId?: number;
  personaId?: number | null;
}

interface Options {
  now?: () => number;
  enabled?: () => boolean;
  onEvent?: (event: "cache-hit" | "cache-miss" | "coalesced" | "invalid-response" | "inference-failed") => void;
}

export function createMemoryRelationshipClassifier(
  infer: (pair: FactPair) => Promise<string | null | undefined>,
  options: Options = {},
) {
  // Explicitly disposable process cache: no disk/DB writes, no fact text retained.
  const cache = new Map<string, { result: MemoryRelationship; expiresAt: number }>();
  const inFlight = new Map<string, Promise<MemoryRelationship>>();
  let generation = 0;
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? (() => true);
  function emit(event: Parameters<NonNullable<Options["onEvent"]>>[0]) {
    try { options.onEvent?.(event); }
    catch { console.warn("[memory-relations] event-logger-failed"); }
  }

  return {
    async classify(pair: FactPair): Promise<MemoryRelationship> {
      pair = { ...pair };
      const reuse = enabled();
      if (!reuse) {
        cache.clear();
        inFlight.clear();
        generation++;
      }
      const startedGeneration = generation;
      const scoped = Number.isSafeInteger(pair.tenantId) && pair.tenantId! > 0 &&
        (pair.personaId === null || (Number.isSafeInteger(pair.personaId) && pair.personaId! > 0)) &&
        typeof pair.newFact === "string" && typeof pair.existingFact === "string";
      const key = reuse && scoped
        ? createHash("sha256").update(JSON.stringify([
            pair.tenantId, pair.personaId ?? null, pair.newFact, pair.existingFact,
            MEMORY_RELATION_MODEL, MEMORY_RELATION_PROMPT, 80, "json_object",
          ])).digest("hex")
        : null;
      if (key) {
        const entry = cache.get(key);
        if (entry && entry.expiresAt > now()) {
          cache.delete(key);
          cache.set(key, entry);
          emit("cache-hit");
          return { ...entry.result };
        }
        cache.delete(key);
        const pending = inFlight.get(key);
        if (pending) {
          emit("coalesced");
          return { ...await pending };
        }
      }
      emit("cache-miss");
      const run = async (): Promise<MemoryRelationship> => {
        try {
          const content = await infer(pair);
          if (!content) {
            emit("invalid-response");
            return { relation: "unrelated", confidence: 0 };
          }
          const parsed = JSON.parse(content);
          if (!parsed || !["duplicate", "contradiction", "update", "unrelated"].includes(parsed.relation) ||
            !["high", "medium", "low"].includes(parsed.certainty)) {
            emit("invalid-response");
            return { relation: "unrelated", confidence: 0 };
          }
          const result: MemoryRelationship = {
            relation: parsed.relation,
            confidence: certaintyToWeight(parsed.certainty),
          };
          if (key && enabled() && generation === startedGeneration) {
            cache.set(key, { result: { ...result }, expiresAt: now() + TTL_MS });
            while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
          }
          return result;
        } catch {
          emit("inference-failed");
          return { relation: "unrelated", confidence: 0 };
        }
      };
      const pending = run();
      // At capacity, new calls use normal inference rather than grow bookkeeping.
      if (key && inFlight.size < MAX_ENTRIES) inFlight.set(key, pending);
      try {
        return { ...await pending };
      } finally {
        if (key && inFlight.get(key) === pending) inFlight.delete(key);
      }
    },
  };
}