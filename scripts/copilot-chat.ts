// Workspace-owner entry point. Prompt arrives via stdin, never secret-bearing argv.
import { runCopilotChat } from "../server/copilot-chat";
import { ownerTenantId } from "../server/agentic/autonomous-budget";
let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk.toString();
  if (prompt.length > 12000) throw new Error("Copilot prompt exceeds 12,000 characters");
}
const modelIndex = process.argv.indexOf("--model");
const result = await runCopilotChat({
  tenantId: ownerTenantId(), prompt, model: modelIndex === -1 ? undefined : process.argv[modelIndex + 1],
});
console.log(JSON.stringify(result));
if (!result.success) process.exitCode = 1;
