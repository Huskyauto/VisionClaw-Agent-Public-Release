import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAssistantMarkdown } from "../../client/src/lib/normalize-chat-markdown";

test("separates malformed bold labels from the following sentence", () => {
  const input = [
    "**What this means, plainly**You were right.",
    "**Best next move**I should continue.",
    "**Current honest status**- We are closer.",
  ].join("\n");

  assert.equal(
    normalizeAssistantMarkdown(input),
    [
      "**What this means, plainly** You were right.",
      "**Best next move** I should continue.",
      "**Current honest status** - We are closer.",
    ].join("\n"),
  );
});

test("does not rewrite Markdown-like text inside fenced code", () => {
  const input = "````md\n**Best next move**I should continue.\n```\n**Current honest status**- Still fenced.\n````\n**Best next move**I should continue.";
  assert.equal(
    normalizeAssistantMarkdown(input),
    "````md\n**Best next move**I should continue.\n```\n**Current honest status**- Still fenced.\n````\n**Best next move** I should continue.",
  );
});

test("preserves intentional adjacent emphasis, underline syntax, and inline code", () => {
  const input = [
    "**React**Markdown",
    "__Label__Value",
    "`**Best next move**I should continue.`",
    "Use **Best next move**I as a literal example.",
  ].join("\n");

  assert.equal(normalizeAssistantMarkdown(input), input);
});