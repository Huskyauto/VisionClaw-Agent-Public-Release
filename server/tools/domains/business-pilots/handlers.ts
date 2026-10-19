import { defineTool } from "../../define-tool";
import { businessPilotDefinition } from "./definitions";

export const businessPilotTool = defineTool(businessPilotDefinition, async (params, ctx) => {
  const { executeBusinessPilot } = await import("../../../lib/business-pilot-agent");
  return executeBusinessPilot(params, ctx);
});
