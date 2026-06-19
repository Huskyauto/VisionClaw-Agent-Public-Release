# Adding a New Tool

Tools are the **verbs** the agent team uses — `forecast_ticker`,
`analyze_portfolio`, `deliver_product`, and ~390 others. This is the full
recipe for adding one, with a working template you can copy.

A runnable, standalone reference lives at
[`server/tools/example-tool.ts`](../server/tools/example-tool.ts) — read it
first; it's ~60 lines and shows the exact shape.

> **Where tools live:** the live tools are all defined in
> [`server/tools.ts`](../server/tools.ts), grouped by category. It's a large
> file by design (one dispatch surface). The example file above is *separate*
> only so you can see the shape without scrolling.

---

## The recipe (4 steps)

### 1. Pick a name an LLM would reach for

Use `snake_case` and name it like the verb a person would say:
`summarize_pdf`, not `pdf_util_v2`. The model picks tools by name + description,
so clarity here is the single biggest driver of whether your tool gets used
correctly. If you'd like maintainer feedback before writing code, open an issue
with the **"New tool proposal"** template.

### 2. Add the tool definition

This is the JSON-Schema contract the model sees. Put it in the right category
group in `server/tools.ts`:

```ts
{
  type: "function",
  function: {
    name: "your_tool",
    description:
      "1-3 sentences telling the LLM exactly when to call this. Be specific " +
      "about inputs, outputs, and when NOT to use it.",
    parameters: {
      type: "object",
      properties: {
        some_input: { type: "string", description: "What it is." },
      },
      required: ["some_input"],
      additionalProperties: false,
    },
  },
}
```

A few description rules that matter in practice:
- Front-load the *when to call*. Tool-pick summaries are truncated to ~200–240
  chars, so a "don't use this for X" buried at the end is invisible.
- Be explicit about side effects. "Read-only" vs "writes to the database" vs
  "sends email" changes how aggressively the agent reaches for it.

### 3. Implement the handler

Keep it pure where possible. **Throw on hard failure** — the platform's
3-layer recovery handles retries and structured refusals. Do not silently
swallow errors (there's a CI scanner that hunts that pattern).

```ts
export async function yourToolHandler(args: { some_input: string }) {
  if (typeof args?.some_input !== "string") {
    throw new Error("your_tool: 'some_input' must be a string");
  }
  // ...do the work...
  return { ok: true, result: /* ... */ };
}
```

Register the handler in the dispatch switch alongside the definition.

If your handler constructs an OpenAI client, route it through
`createMeteredOpenAIClient` in `server/providers.ts` instead of
`new OpenAI({...})` — this keeps the agent cost ledger accurate.

### 4. Classify it for safety

This step is **not optional** for tools with teeth.

- **Read-only, idempotent, sub-second, no destructive side effects?** You may
  add it to the Glasses Gateway voice-safe allowlist (`VOICE_SAFE_TOOLS`). If
  unsure, leave it off — voice-safety is opt-in by design.
- **Mutates production state, moves money, deletes data, sends mass comms, or
  exposes credentials?** It **must** be registered in `TOOL_POLICIES`
  (`server/safety/destructive-tool-policy.ts`). The default policy is `safe`,
  so an unregistered destructive tool runs **unchecked**. The destructive-tool
  policy fails CLOSED — that's the safety net, don't bypass it.

---

## Before you open the PR

```bash
npm run check     # typecheck must stay clean (hard gate)
npm run build     # production bundle must build (hard gate)
node --import tsx --test tests/tools/*.test.ts   # tool-dispatch contract
```

If your tool is destructive, add or extend a test under `tests/safety/` proving
the policy fires. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for how PRs against
the public mirror are merged.
