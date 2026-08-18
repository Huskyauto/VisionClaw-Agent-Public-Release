/**
 * Tools-layer-split — derived-api domain handlers.
 * Reads tenantId from ctx (dispatcher-stripped), never from params.
 */
import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  captureListDefinition,
  recipeDeriveDefinition,
  recipeReplayDefinition,
  recipeListDefinition,
  recipeDeleteDefinition,
} from "./definitions";

async function disabledCheck(): Promise<ToolResult | null> {
  const { derivedApiDisabled } = await import("../../../lib/derived-api");
  return derivedApiDisabled() ? { error: "Derived API feature is disabled (DERIVED_API_DISABLED=1)" } : null;
}

async function captureListHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required." };
  const off = await disabledCheck(); if (off) return off;
  const { listCapturedCalls } = await import("../../../lib/derived-api");
  const calls = listCapturedCalls(ctx.tenantId as number, params.urlFilter);
  if (calls.length === 0) {
    return { message: "No captured calls yet. Browse a site in the browser tool first — capture is automatic." };
  }
  return {
    count: calls.length,
    calls: calls.map((c) => ({
      method: c.method,
      url: c.url,
      status: c.status,
      hadAuth: c.hadAuth,
      ts: new Date(c.ts).toISOString(),
    })),
  };
}

async function recipeDeriveHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required." };
  if (!params.name) return { error: "name is required." };
  if (!params.urlFilter) return { error: "urlFilter is required." };
  const { deriveRecipe } = await import("../../../lib/derived-api");
  const result = await deriveRecipe(ctx.tenantId as number, {
    name: params.name,
    urlFilter: params.urlFilter,
    hint: params.hint,
  });
  if ("error" in result) return result;
  return {
    success: true,
    message: `Recipe "${result.recipe.name}" saved. Use derived_api_replay to call it without opening the browser.`,
    recipe: result.recipe,
  };
}

async function recipeReplayHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required." };
  if (!params.recipeName) return { error: "recipeName is required." };
  const { replayRecipe } = await import("../../../lib/derived-api");
  return replayRecipe(ctx.tenantId as number, {
    recipeName: params.recipeName,
    params: params.params,
    headers: params.headers,
    body: params.body,
  });
}

async function recipeListHandler(_params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required." };
  const off = await disabledCheck(); if (off) return off;
  const { listRecipes } = await import("../../../lib/derived-api");
  const recipes = await listRecipes(ctx.tenantId as number);
  return { count: recipes.length, recipes };
}

async function recipeDeleteHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required." };
  const off = await disabledCheck(); if (off) return off;
  if (!params.recipeName) return { error: "recipeName is required." };
  const { listRecipes, deleteRecipe } = await import("../../../lib/derived-api");
  const all = await listRecipes(ctx.tenantId as number);
  const match = all.find((r) => r.name === params.recipeName);
  if (!match) return { error: `Recipe "${params.recipeName}" not found.` };
  const ok = await deleteRecipe(ctx.tenantId as number, match.id);
  return ok ? { success: true, message: `Recipe "${params.recipeName}" deleted.` } : { error: "Delete failed." };
}

export const derivedApiDomainTools: RegisteredTool[] = [
  defineTool(captureListDefinition, captureListHandler),
  defineTool(recipeDeriveDefinition, recipeDeriveHandler),
  defineTool(recipeReplayDefinition, recipeReplayHandler),
  defineTool(recipeListDefinition, recipeListHandler),
  defineTool(recipeDeleteDefinition, recipeDeleteHandler),
];
