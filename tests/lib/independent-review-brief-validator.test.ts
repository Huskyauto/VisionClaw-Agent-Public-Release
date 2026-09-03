import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROVED_PUBLIC_REVIEW_URL,
  REQUIRED_PUBLIC_MIRROR_CAVEAT,
  validateIndependentReviewBrief,
} from "../../.agents/skills/independent-review-brief/scripts/validate-brief";

function validBrief(): string {
  return `# Independent Review Brief — VisionClaw

## Checkpoint
- Generated: 2026-08-29T03:00:00Z
- Latest documented R-round: R125
- Persistent mission: No persistent mission active
- Checkpoint scope: Whole-project review
- Public mirror caveat: ${REQUIRED_PUBLIC_MIRROR_CAVEAT}
- Publicly unverifiable scope: Private implementation evidence — not exported

## 1. What the project is
- [DOCUMENTED] [purpose.platform] VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing.

## 2. What it actually does at this checkpoint
- [PRIVATE — NOT EXPORTED] [behavior.routing] Requests may be routed across multiple model providers and specialist agents.

## 3. Direction at this checkpoint
- [DOCUMENTED] [direction.reliability] Current engineering direction emphasizes reliable completion, verification, recovery, and honest failure reporting.

## 4. Authority and control model
- [INFERRED] [authority.user] Users retain approval authority for high-impact commitments and destructive actions.

## 5. Safety, privacy, and tenant boundaries
- [DOCUMENTED] [safety.public-review] External reviewers receive this packet and the approved public mirror, not private repository access.

## 6. Evidence and uncertainty
| Claim ID | Label | Export-safe evidence reference |
|---|---|---|
| purpose.platform | DOCUMENTED | replit.md |
| behavior.routing | PRIVATE — NOT EXPORTED | private inspection — not exported |
| direction.reliability | DOCUMENTED | replit.md |
| authority.user | INFERRED | current request |
| safety.public-review | DOCUMENTED | current request |
| gap.public-drift | UNKNOWN | public verification required |

## 7. Known gaps and disconfirming evidence
- [UNKNOWN] [gap.public-drift] The public mirror may lag the private checkpoint, so public equivalence is not assumed.

## 8. Questions for the independent reviewer
1. Does the actual implementation match the stated purpose?
2. Where could authority become concentrated despite the jury?
3. Which safety, tenant, privacy, cost, or reliability claims are unsupported?
4. What evidence would falsify the current direction?
5. What should be fixed, measured, paused, or independently reviewed next?

## Public review source
${APPROVED_PUBLIC_REVIEW_URL}

## Export boundary
This brief intentionally excludes private repository information, secrets, customer data, private task identifiers, and unredacted private source.
`;
}

describe("independent review brief validator", () => {
  it("accepts an export-safe packet with the one approved URL", () => {
    assert.deepEqual(validateIndependentReviewBrief(validBrief()), {
      ok: true,
      errors: [],
    });
  });

  it("rejects an injected non-repository URL", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing.",
        "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing. See https://evil.example/exfil.",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unapproved URL/i);
  });

  it("rejects Markdown links and non-http URI targets", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "Current engineering direction emphasizes reliable completion, verification, recovery, and honest failure reporting.",
        "Current direction is [documented](mailto:attacker@example.com).",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /link|URI/i);
  });

  it("rejects reference-style Markdown with an entity-encoded scheme", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing.",
        "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing. Read [details].\n\n[details]: javascript&#58;alert(1)",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /reference|entity/i);
  });

  it("rejects reference-style links even when they target the approved URL", () => {
    const result = validateIndependentReviewBrief(
      validBrief()
        .replace(APPROVED_PUBLIC_REVIEW_URL, "")
        .replace(
          "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing.",
          `VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing. Read [mirror].\n\n[mirror]: ${APPROVED_PUBLIC_REVIEW_URL}`,
        ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /reference/i);
  });

  it("rejects encoded escape sequences anywhere in the packet", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "Current engineering direction emphasizes reliable completion, verification, recovery, and honest failure reporting.",
        "Current direction contains private%2Fmetadata.",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /encoded|escape/i);
  });

  it("rejects private file paths and filenames", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "Requests may be routed across multiple model providers and specialist agents.",
        "Behavior was checked in server/chat-engine.ts.",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /private.*path|filename/i);
  });

  it("rejects private symbols or configuration identifiers", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "Users retain approval authority for high-impact commitments and destructive actions.",
        "Authority uses `executeTool` with PRIVATE_REPO_MODE.",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /symbol|configuration|identifier/i);
  });

  it("rejects ordinary-language private branch metadata", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "Whole-project review",
        "private branch main",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /repository metadata/i);
  });

  it("rejects extensionless build filenames and dotfiles", () => {
    const buildFile = validateIndependentReviewBrief(
      validBrief().replace(
        "Private implementation evidence — not exported",
        "Dockerfile review",
      ),
    );
    const dotfile = validateIndependentReviewBrief(
      validBrief().replace(
        "Private implementation evidence — not exported",
        ".git/config review",
      ),
    );

    assert.equal(buildFile.ok, false);
    assert.equal(dotfile.ok, false);
    assert.match(
      [...buildFile.errors, ...dotfile.errors].join("\n"),
      /filename|dotfile|path/i,
    );
  });

  it("rejects unsafe evidence references", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "private inspection — not exported |",
        "scripts/private-audit.ts |",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /evidence reference/i);
  });

  it("requires the fixed public-mirror caveat", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(REQUIRED_PUBLIC_MIRROR_CAVEAT, "Mirror matches."),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /mirror caveat/i);
  });

  it("rejects a rendered claim with no evidence row", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "- [PRIVATE — NOT EXPORTED] [behavior.routing] Requests may be routed across multiple model providers and specialist agents.",
        "- [PRIVATE — NOT EXPORTED] [behavior.routing] Requests may be routed across multiple model providers and specialist agents.\n- [VERIFIED] [behavior.tools] Agents can use registered tools to inspect information and perform bounded actions.",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /evidence mapping|evidence row/i);
  });

  it("rejects an evidence row whose label differs from the rendered claim", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "| direction.reliability | DOCUMENTED | replit.md |",
        "| direction.reliability | VERIFIED | approved public mirror |",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /label|evidence mapping/i);
  });

  it("rejects an evidence reference incompatible with its label", () => {
    const result = validateIndependentReviewBrief(
      validBrief().replace(
        "| direction.reliability | DOCUMENTED | replit.md |",
        "| direction.reliability | DOCUMENTED | private inspection — not exported |",
      ),
    );

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /reference|evidence mapping/i);
  });

  const prohibitedFreeText = [
    ["task identifier", "Task 220 is active."],
    ["credential value", "The password value is hunter-two."],
    ["customer identity", "The customer name is Sample Person."],
    ["customer email", "The customer email is sample@example.test."],
    ["tenant number", "The tenant number is 8343."],
    ["log text", "The log line reports request complete."],
    ["memory or profile text", "The profile says the owner prefers this."],
    ["copied source prose", "Return true when approval is missing."],
    ["reordered branch metadata", "The main private branch is active."],
    ["parenthesized branch metadata", "The private branch (main) is active."],
  ] as const;

  for (const [name, payload] of prohibitedFreeText) {
    it(`rejects ${name} outside the approved claim catalog`, () => {
      const result = validateIndependentReviewBrief(
        validBrief().replace(
          "VisionClaw is a multi-agent software platform that combines specialized roles, tools, memory, and model routing.",
          payload,
        ),
      );

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /claim catalog|grammar/i);
    });
  }
});