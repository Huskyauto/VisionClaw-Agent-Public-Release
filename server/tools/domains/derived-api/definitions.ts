/**
 * Tools-layer-split — derived-api domain definitions.
 * 4 tools: capture_list, recipe_derive, recipe_replay, recipe_list/delete.
 */
import type { ToolDefinition } from "../../types";

export const captureListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "derived_api_capture_list",
    description: "List the network calls captured from the current browser session. Use after the user has browsed a site, to see what API calls were recorded before calling derived_api_derive.",
    parameters: {
      type: "object",
      properties: {
        urlFilter: { type: "string", description: "Optional substring to filter captured URLs by." },
      },
      required: [],
    },
  },
};

export const recipeDeriveDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "derived_api_derive",
    description: "Derive a reusable plain-HTTP recipe from captured browser network traffic. The LLM distills the calls matching urlFilter into a URL template + param schema so the site can be queried later without opening a browser. Auth values are never stored — only header names.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short unique name for this recipe, e.g. 'twitter-search'." },
        urlFilter: { type: "string", description: "Substring to match captured URLs against, e.g. 'api.twitter.com/search'." },
        hint: { type: "string", description: "Optional free-text hint to help the LLM understand what the endpoint does." },
      },
      required: ["name", "urlFilter"],
    },
  },
};

export const recipeReplayDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "derived_api_replay",
    description: "Replay a saved API recipe with live parameters and optional auth headers. Returns the HTTP status and response body. If the site returns 401/403 the recipe is marked needs_reverify. Use when the user wants to query a site they previously recorded without opening a browser.",
    parameters: {
      type: "object",
      properties: {
        recipeName: { type: "string", description: "Name of the saved recipe to replay." },
        params: { type: "object", description: "Key-value pairs to fill {param} placeholders in the URL template." },
        headers: { type: "object", description: "Live request headers (e.g. Authorization). Values are never stored." },
        body: { type: "string", description: "Request body for POST/PUT recipes (overrides the stored body template)." },
      },
      required: ["recipeName"],
    },
  },
};

export const recipeListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "derived_api_list",
    description: "List all saved API recipes for this account.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const recipeDeleteDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "derived_api_delete",
    description: "Delete a saved API recipe by name.",
    parameters: {
      type: "object",
      properties: {
        recipeName: { type: "string", description: "Name of the recipe to delete." },
      },
      required: ["recipeName"],
    },
  },
};

export const derivedApiDomainDefinitions: ToolDefinition[] = [
  captureListDefinition,
  recipeDeriveDefinition,
  recipeReplayDefinition,
  recipeListDefinition,
  recipeDeleteDefinition,
];
