import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUnrecoverableChatStreamError } from "../../client/src/lib/chat-stream-errors";

const source = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");

test("a terminal paid-provider error is fatal, but recoverable telemetry is not", () => {
  assert.equal(isUnrecoverableChatStreamError({
    type: "provider_error", error: "Synthetic provider interruption", retryable: false,
  }), true);
  assert.equal(isUnrecoverableChatStreamError({
    type: "provider_error", error: "Recoverable telemetry", retryable: true,
  }), false);
  assert.equal(isUnrecoverableChatStreamError({ type: "tool_result", error: "Tool failure" }), false);
  const chat = readFileSync(new URL("../../client/src/pages/chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /status: data\.type === "provider_error"\s*\? "Completion and any charge are uncertain\. Do not automatically resend/);
});

test("paid creation and mid-stream failures mark a connected turn interrupted", () => {
  const expression = source.match(/const __wasAborted = ([^;]+);/)?.[1];
  assert.ok(expression, "actual persistence boundary must be found");
  const interrupted = new Function("req", "streamAborted", "paidStreamFailure",
    `return ${expression.replace("(req as any)", "req")}`) as
      (req: unknown, streamAborted: boolean, paidStreamFailure: boolean) => boolean;
  const connected = { _clientDisconnected: () => false };
  assert.equal(interrupted(connected, false, true), true);
  assert.equal(interrupted(connected, false, false), false);
  assert.equal(interrupted(connected, true, false), true);
  assert.equal(interrupted({ _clientDisconnected: () => true }, false, false), true);
});

test("paid stop marks the loop aborted and retains its terminal error/no-retry contract", () => {
  const stop = source.slice(source.indexOf("const stopPaidStream ="),
    source.indexOf("// Tool-budget caps", source.indexOf("const stopPaidStream =")));
  assert.match(stop, /streamAborted = true/);
  assert.match(stop, /paidStreamFailure = true/);
  assert.match(stop, /retryable: false/);
});

test("interrupted turns do not trigger success-only title and message-sent work", () => {
  const boundary = source.indexOf("const __wasAborted =");
  const stop = source.indexOf("if (__wasAborted) {", boundary);
  const broadcast = source.indexOf("broadcastToConversation", boundary);
  assert.ok(stop > boundary && stop < broadcast);
  const earlyExit = source.slice(stop, broadcast);
  assert.match(earlyExit, /interrupted: true/);
  assert.match(earlyExit, /res\.end\(\)/);
  assert.match(earlyExit, /return;/);
  assert.ok(broadcast < source.indexOf("const needsTitle =", boundary));
  assert.ok(broadcast < source.indexOf('type: "message", action: "sent"', boundary));
});

test("reviewed connection and approval logs do not interpolate phone identifiers", () => {
  const approval = readFileSync(new URL("../../server/whatsapp-approval.ts", import.meta.url), "utf8");
  const connection = readFileSync(new URL("../../server/whatsapp.ts", import.meta.url), "utf8");
  for (const file of [approval, connection]) {
    assert.doesNotMatch(file, /console\.(?:log|warn|error)\([^\n]*\$\{(?:phone|cleaned|jid|normalizedJid|label|s\.connected(?:Phone|Lid))\}/);
    assert.doesNotMatch(file, /console\.(?:log|warn|error)\([^\n]*(?:\$\{text\.slice|targetJid)/);
  }
});
