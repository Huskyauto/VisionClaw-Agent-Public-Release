import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Gmail sends refuse known-bounced recipients before acquiring any credential", async () => {
  const { gmailSend } = await import("../../server/google-workspace");
  for (const field of ["to", "cc", "bcc"] as const) {
    const recipients = { to:"owner@example.com",cc:undefined as string | undefined,bcc:undefined as string | undefined };
    recipients[field] = "Admin <admin@visionclaw.ai>";
    await assert.rejects(
      () => gmailSend(0,recipients.to,"Original report","<p>Preserved report</p>",recipients.cc,recipients.bcc),
      /R98\.25 bouncing-recipient gate/,
    );
  }
});

test("Every Gmail MIME send uses shared preflight and encodes only its approved output", () => {
  const source = readFileSync("server/google-workspace.ts","utf8");
  const helper = source.slice(source.indexOf("async function sendGmailMessageWithToken("),source.indexOf("export async function gmailSendAndVerifyInbox("));
  assert.match(helper,/await preflightOutboundEmail\(/);
  assert.match(helper,/mimeHeader\(safe\.subject/);
  assert.match(helper,/safe\.html/);
  assert.match(helper,/safe\.text/);
  assert.ok(helper.indexOf("await preflightOutboundEmail(") < helper.indexOf("gFetch("));
  assert.doesNotMatch(helper,/rawEmail \+= `\\n\$\{params\.body\}`/);
});
