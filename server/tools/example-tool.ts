/**
 * Example tool — a copy-paste template for new contributors.
 *
 * This is the smallest complete tool: a definition (the JSON-Schema contract
 * the LLM sees) plus a handler (the code that runs when the agent calls it).
 *
 * It is intentionally STANDALONE and is NOT wired into the live dispatcher —
 * real tools live in `server/tools.ts`, grouped by category. This file exists
 * so a contributor can see the exact shape in isolation before touching the
 * large file. See `docs/adding-a-tool.md` for the full recipe.
 *
 * To turn this into a real tool:
 *   1. Move `exampleToolDefinition` into the appropriate group in
 *      `server/tools.ts` and rename it.
 *   2. Move `echoMessageHandler` alongside it and register it in the dispatch
 *      switch.
 *   3. If the tool mutates production state, moves money, deletes data, sends
 *      mass comms, or exposes credentials, add it to `TOOL_POLICIES`
 *      (server/safety/destructive-tool-policy.ts). The default policy is
 *      `safe`, so an UNregistered destructive tool runs unchecked — don't skip
 *      this.
 */

/** The contract the LLM sees. `name` is what the model calls. */
export const exampleToolDefinition = {
  type: "function" as const,
  function: {
    name: "echo_message",
    description:
      "Returns the provided message verbatim. A minimal reference tool that " +
      "demonstrates the exact shape a VisionClaw tool definition takes. " +
      "Has no real side effects — do not use it in production flows.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The text to echo back.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

/** Arguments the handler receives, parsed from the model's tool call. */
export interface EchoMessageArgs {
  message: string;
}

/** The result the handler returns to the agent loop. */
export interface EchoMessageResult {
  ok: true;
  echoed: string;
}

/**
 * The handler. Keep it pure where possible and THROW on hard failure — the
 * platform's recovery layer handles retries. Never silently swallow errors.
 */
export async function echoMessageHandler(
  args: EchoMessageArgs,
): Promise<EchoMessageResult> {
  if (typeof args?.message !== "string") {
    throw new Error("echo_message: 'message' must be a string");
  }
  return { ok: true, echoed: args.message };
}
