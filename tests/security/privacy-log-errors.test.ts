import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redactSensitiveText } from "../../server/log-redactor";

const read = (path: string) => readFileSync(path, "utf8");

describe("privacy-safe logs and authenticated API errors", () => {
  it("redacts email addresses from text before it reaches a console sink", () => {
    assert.equal(redactSensitiveText("recipient: private.person@example.test", { force: true }),
      "recipient: [REDACTED EMAIL]");
  });

  it("does not interpolate video briefs, titles, or image references into console output", () => {
    const source = read("server/build-video-from-brief.ts");
    const consoleCalls = source.match(/console\.(?:log|info|warn|error|debug)\([^\n]*/g) || [];
    assert.doesNotMatch(consoleCalls.join("\n"), /input\.(?:brief|voice)|logTitle|heroCandidate|\$\{validatedUserImage\}/);
  });

  it("does not include email addresses, message subjects, or message content in email logs", () => {
    const source = read("server/email.ts");
    const consoleCalls = source.match(/console\.(?:log|info|warn|error|debug)\([^\n]*/g) || [];
    assert.doesNotMatch(consoleCalls.join("\n"), /params\.(?:to|cc|bcc|replyTo|subject)|virtualEmail|PRIMARY_INBOX|rawTo|from=|to=|subject=|verdict\.reason/);
  });

  it("returns generic errors for server failures in memory routes", () => {
    const source = read("server/routes/memory.ts");
    const serverErrorResponses = source.match(/res\.status\(500\)\.json\([^\n]*/g) || [];
    assert.ok(serverErrorResponses.length > 0);
    assert.doesNotMatch(serverErrorResponses.join("\n"), /(?:err|e)(?:\?\.|\.)message|delivery\.error/);
  });

  it("returns generic errors for server failures in tenant routes", () => {
    const source = read("server/routes/tenants.ts");
    const serverErrorResponses = source.match(/res\.status\(500\)\.json\([^\n]*/g) || [];
    assert.ok(serverErrorResponses.length > 0);
    assert.doesNotMatch(serverErrorResponses.join("\n"), /(?:err|e)(?:\?\.|\.)message/);
  });
});
