export type UnionAlphaFixtureKind = "code" | "review" | "tool";

export interface UnionAlphaSyntheticFixture {
  id: string;
  kind: UnionAlphaFixtureKind;
  prompt: string;
}

export interface UnionAlphaFixtureOutput {
  text: string;
  toolCalls: Array<{ name: string; arguments: string }>;
}

export interface UnionAlphaFixtureScore {
  passed: boolean;
  checksPassed: number;
  checksTotal: number;
}

export interface UnionAlphaCompletionEnvelope extends UnionAlphaFixtureOutput {
  choiceCount: number;
  finishReason: string | null;
}

export const UNION_ALPHA_SYNTHETIC_FIXTURES: readonly UnionAlphaSyntheticFixture[] = [
  {
    id: "typescript-normalize",
    kind: "code",
    prompt: `SYNTHETIC FIXTURE. Write only a TypeScript function normalizeIds(values: number[]): number[] that returns unique values in ascending numeric order without mutating the input.`,
  },
  {
    id: "async-review",
    kind: "review",
    prompt: `SYNTHETIC FIXTURE. Review this isolated code and return a concise diagnosis plus corrected TypeScript:
async function saveAll(items: Item[]) {
  items.forEach(async (item) => {
    await save(item);
  });
}`,
  },
  {
    id: "tool-contract",
    kind: "tool",
    prompt: `SYNTHETIC FIXTURE. Use the lookup_dependency tool exactly once to inspect package "zod" at version "4.1.5". Do not answer from memory.`,
  },
] as const;

export function scoreUnionAlphaFixture(
  fixture: UnionAlphaSyntheticFixture,
  output: UnionAlphaFixtureOutput,
): UnionAlphaFixtureScore {
  let checks: boolean[];
  if (fixture.id === "typescript-normalize") {
    checks = [
      /function\s+normalizeIds\s*\(\s*values\s*:\s*number\[\]\s*\)\s*:\s*number\[\]/.test(output.text),
      /\bSet\b/.test(output.text),
      /\.sort\s*\(/.test(output.text),
      /a\s*-\s*b/.test(output.text),
    ];
  } else if (fixture.id === "async-review") {
    checks = [
      /forEach[\s\S]*(?:does not await|not await|returns? before|unhandled)/i.test(output.text),
      /Promise\.all\s*\(\s*items\.map\s*\(\s*async|for\s*\(\s*const\s+item\s+of\s+items\s*\)/.test(output.text),
      /await\s+save/.test(output.text),
    ];
  } else {
    const matchingCalls = output.toolCalls.filter((call) => call.name === "lookup_dependency");
    checks = [
      matchingCalls.length === 1,
      matchingCalls.some((call) => {
        try {
          const args = JSON.parse(call.arguments);
          return (
            args &&
            typeof args === "object" &&
            !Array.isArray(args) &&
            Object.keys(args).sort().join(",") === "package,version" &&
            args.package === "zod" &&
            args.version === "4.1.5"
          );
        } catch {
          return false;
        }
      }),
      output.toolCalls.length === 1,
    ];
  }
  const checksPassed = checks.filter(Boolean).length;
  return {
    passed: checksPassed === checks.length,
    checksPassed,
    checksTotal: checks.length,
  };
}

export function validateUnionAlphaCompletion(
  fixture: UnionAlphaSyntheticFixture,
  completion: UnionAlphaCompletionEnvelope,
): UnionAlphaFixtureOutput {
  if (completion.choiceCount !== 1) {
    throw new Error(`[union-alpha-eval] fixture "${fixture.id}" must return exactly one choice`);
  }
  const expectedFinishReason = fixture.kind === "tool" ? "tool_calls" : "stop";
  if (completion.finishReason !== expectedFinishReason) {
    throw new Error(
      `[union-alpha-eval] fixture "${fixture.id}" returned finish reason "${completion.finishReason ?? "missing"}"; expected "${expectedFinishReason}"`,
    );
  }
  if (fixture.kind !== "tool" && completion.text.trim().length === 0) {
    throw new Error(`[union-alpha-eval] fixture "${fixture.id}" returned empty text`);
  }
  if (fixture.kind === "tool" && completion.toolCalls.length === 0) {
    throw new Error(`[union-alpha-eval] fixture "${fixture.id}" returned no tool call`);
  }
  return {
    text: completion.text,
    toolCalls: completion.toolCalls,
  };
}