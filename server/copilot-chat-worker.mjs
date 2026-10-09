// Trusted one-shot child. Never forward raw provider errors or credential values.
import { CopilotClient } from "@github/copilot-sdk";

// Independent bound survives loss of the parent and cannot outlive quota lease.
const stopGroup = () => {
  try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); }
};
const deadline = setTimeout(stopGroup, 120000);
deadline.unref();
process.once("disconnect", stopGroup);

process.once("message", async ({ prompt, model }) => {
  const client = new CopilotClient({
    mode: "empty", gitHubToken: process.env.COPILOT_GITHUB_TOKEN,
    useLoggedInUser: false, workingDirectory: process.cwd(), baseDirectory: process.cwd(),
    env: { PATH: process.env.PATH, HOME: process.cwd(), TMPDIR: process.cwd(), SSL_CERT_FILE: process.env.SSL_CERT_FILE },
    enableRemoteSessions: false, logLevel: "none",
  });
  let reply = { success: false };
  try {
    await client.start();
    const models = await client.listModels();
    if (!models.some(item => item.id === model)) throw new Error("Model unavailable");
    const session = await client.createSession({
      model, availableTools: [], excludedTools: ["builtin:*", "mcp:*", "custom:*"],
      tools: [], mcpServers: {}, skillDirectories: [], includedBuiltinSkills: [],
      onPermissionRequest: async () => ({ kind: "denied-interactively-by-user" }),
      systemMessage: { mode: "replace", content: "You are a text-only assistant. Answer the supplied prompt. You have no tools, file access, shell, web access, MCP, or authority to take actions. Never claim that you executed an action." },
      infiniteSessions: { enabled: false }, enableTelemetry: false,
    });
    const response = await session.sendAndWait({ prompt }, 110000);
    const text = response?.data?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Empty response");
    reply = { success: true, text: text.slice(0, 16000), truncated: text.length > 16000, model };
  } catch { /* Parent returns an explicit sanitized failure, never a fallback. */ }
  finally {
    await client.forceStop();
    process.send?.(reply, () => process.exit(reply.success ? 0 : 1));
  }
});
