// Query-free tests for the honest reply-classification taxonomy
// (server/lib/reply-classification.ts) — CPT 5.6 external review priority 2b.
// Fixtures cover every category; the core invariant under test: out-of-office,
// bounces, automated mail, empty messages, and classification FAILURES can
// never count as demand evidence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  REPLY_CATEGORIES,
  DEMAND_REPLY_CATEGORIES,
  isDemandCategory,
  evidenceTypeForCategory,
  pauseActionForCategory,
  preClassifyReply,
  parseCategoryFromModelText,
  type ReplyCategory,
} from "../../server/lib/reply-classification";

// ── Taxonomy shape ───────────────────────────────────────────────────────────
test("taxonomy contains exactly the contracted categories", () => {
  assert.deepEqual([...REPLY_CATEGORIES], [
    "interested", "meeting_request", "pricing_question", "referral", "not_now",
    "not_interested", "unsubscribe", "wrong_person", "out_of_office", "bounce",
    "automated", "ambiguous",
  ]);
});

test("ONLY explicit-interest categories count as demand", () => {
  assert.deepEqual([...DEMAND_REPLY_CATEGORIES], ["interested", "meeting_request", "pricing_question"]);
  for (const cat of REPLY_CATEGORIES) {
    const demand = isDemandCategory(cat);
    assert.equal(demand, (DEMAND_REPLY_CATEGORIES as readonly string[]).includes(cat), cat);
  }
});

// ── Evidence mapping: the honest-demand invariant ───────────────────────────
test("evidence mapping: demand → positive_reply, rejection → negative_reply, everything else → other", () => {
  for (const cat of DEMAND_REPLY_CATEGORIES) assert.equal(evidenceTypeForCategory(cat), "positive_reply", cat);
  assert.equal(evidenceTypeForCategory("not_interested"), "negative_reply");
  assert.equal(evidenceTypeForCategory("unsubscribe"), "negative_reply");
  for (const cat of ["referral", "not_now", "wrong_person", "out_of_office", "bounce", "automated", "ambiguous"] as ReplyCategory[]) {
    assert.equal(evidenceTypeForCategory(cat), "other", `${cat} must NEVER bump a demand counter`);
  }
});

test("no non-demand category can ever map to positive_reply (proof-of-premise honesty)", () => {
  for (const cat of REPLY_CATEGORIES) {
    if (!isDemandCategory(cat)) assert.notEqual(evidenceTypeForCategory(cat), "positive_reply", cat);
  }
});

// ── Enrollment action mapping ────────────────────────────────────────────────
test("pause actions: rejections/dead addresses stop; humans pause; machines continue", () => {
  for (const cat of ["not_interested", "unsubscribe", "wrong_person", "bounce"] as ReplyCategory[]) {
    assert.equal(pauseActionForCategory(cat), "stop", cat);
  }
  for (const cat of ["out_of_office", "automated"] as ReplyCategory[]) {
    assert.equal(pauseActionForCategory(cat), "none", `${cat} is not a human reply — sequence continues`);
  }
  for (const cat of ["interested", "meeting_request", "pricing_question", "referral", "not_now", "ambiguous"] as ReplyCategory[]) {
    assert.equal(pauseActionForCategory(cat), "pause", cat);
  }
});

// ── Deterministic pre-classifier fixtures ────────────────────────────────────
describe("preClassifyReply fixtures", () => {
  const cases: Array<[string, { from: string; subject?: string; snippet: string }, ReplyCategory | null]> = [
    ["empty message → ambiguous, never demand", { from: "p@x.com", snippet: "" }, "ambiguous"],
    ["whitespace-only → ambiguous", { from: "p@x.com", subject: " ", snippet: "  " }, "ambiguous"],
    ["empty body with a real subject → ambiguous, never reaches the model", { from: "p@x.com", subject: "Re: Quick question [vcm-1-tok]", snippet: "" }, "ambiguous"],
    ["whitespace body with a subject → ambiguous", { from: "p@x.com", subject: "Re: offer", snippet: "   " }, "ambiguous"],
    ["mailer-daemon sender → bounce", { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", snippet: "anything" }, "bounce"],
    ["mailer-daemon sender with EMPTY body → still bounce (not ambiguous review spam)", { from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification", snippet: "" }, "bounce"],
    ["no-reply sender with empty body → automated", { from: "no-reply@corp.com", subject: "Receipt", snippet: "" }, "automated"],
    ["undeliverable text → bounce", { from: "p@x.com", subject: "Undeliverable: your note", snippet: "address not found" }, "bounce"],
    ["550 5.1.1 → bounce", { from: "postmaster@corp.com", snippet: "550 5.1.1 user unknown" }, "bounce"],
    ["OOO subject → out_of_office", { from: "p@x.com", subject: "Automatic reply: Quick question", snippet: "I am out of the office until Monday" }, "out_of_office"],
    ["vacation text → out_of_office", { from: "p@x.com", snippet: "I'm on annual leave with limited access to my email" }, "out_of_office"],
    ["no-reply sender → automated", { from: "no-reply@notifications.example.com", snippet: "Your ticket was received" }, "automated"],
    ["automated body → automated", { from: "p@x.com", snippet: "This is an automated response. Do not reply to this email." }, "automated"],
    ["unsubscribe → unsubscribe", { from: "p@x.com", snippet: "Please UNSUBSCRIBE me and remove me from your list" }, "unsubscribe"],
    ["opt-out → unsubscribe", { from: "p@x.com", snippet: "stop emailing me" }, "unsubscribe"],
    ["wrong person → wrong_person", { from: "p@x.com", snippet: "I'm not the right person for this, and Sarah no longer works here" }, "wrong_person"],
    ["left company → wrong_person", { from: "p@x.com", snippet: "John has left the company" }, "wrong_person"],
    ["explicit rejection → not_interested", { from: "p@x.com", snippet: "Thanks but we're not interested" }, "not_interested"],
    ["not a fit → not_interested", { from: "p@x.com", snippet: "This is not a fit for us right now" }, "not_interested"],
    ["genuine interest → null (model decides, never keyword-positive)", { from: "p@x.com", snippet: "This looks great, how much does it cost?" }, null],
    ["neutral human reply → null (model decides)", { from: "p@x.com", snippet: "Can you send more details about what you do?" }, null],
  ];
  for (const [name, args, expected] of cases) {
    test(name, () => assert.equal(preClassifyReply(args), expected));
  }
});

// ── Model-output parsing: fail CLOSED to ambiguous ──────────────────────────
describe("parseCategoryFromModelText", () => {
  test("accepts clean JSON and bare labels", () => {
    assert.equal(parseCategoryFromModelText('{"category":"interested"}'), "interested");
    assert.equal(parseCategoryFromModelText('Sure! {"category": "meeting_request"} hope that helps'), "meeting_request");
    assert.equal(parseCategoryFromModelText("pricing_question"), "pricing_question");
    assert.equal(parseCategoryFromModelText('"not_now".'), "not_now");
  });
  test("every failure shape lands on ambiguous, never a demand label", () => {
    for (const bad of [
      "", "   ", null, undefined, 42, {},
      "positive", "POSITIVE_REPLY", "interested in what?",
      '{"category":"buy_now"}', '{"cat":"interested"}', '{"category":42}',
      "{broken json", '{"category":"interested"', // truncated JSON
    ]) {
      const got = parseCategoryFromModelText(bad as any);
      assert.equal(got, "ambiguous", `input ${JSON.stringify(bad)} → ${got}`);
    }
  });
  test("classification failure can never be demand", () => {
    assert.equal(isDemandCategory(parseCategoryFromModelText("garbage")), false);
    assert.equal(evidenceTypeForCategory(parseCategoryFromModelText(null)), "other");
  });
});
