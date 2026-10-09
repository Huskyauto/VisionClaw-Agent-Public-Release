import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Agent Card advertises the supported streamable MCP endpoint", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/routes/api-v1.ts"), "utf8");

  assert.match(source, /mcpServer: baseUrl \? `\$\{baseUrl\}\/mcp` : "\/mcp"/);
  assert.doesNotMatch(source, /mcpServer: baseUrl \? `\$\{baseUrl\}\/api\/mcp\/sse`/);
});