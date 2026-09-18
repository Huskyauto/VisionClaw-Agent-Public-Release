import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { typesafeJevDefinition } from "./definitions";
async function handler(params: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
  try {
    // Call-time import keeps the migrated tools package acyclic while the
    // provider/status module remains available to the root route facade.
    const { askTypeSafeJev } = await import("../../../typesafe-jev");
    return {
      ok: true,
      advisory: true,
      ...await askTypeSafeJev({ state: params.state, questions: params.questions }, fetch, _ctx.abortSignal),
    };
  }
  catch (error) { return { error: error instanceof Error ? error.message : "TypeSafe Jev request failed" }; }
}
export const typesafeJevTools: RegisteredTool[] = [{ definition: typesafeJevDefinition, handler }];