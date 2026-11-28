# GLM 5.4 development trial

Scope: one owner-run comparison using AIHubMix's exact `coding-glm-5.4`
identity. It does not register a provider in the application or change any
model menus, defaults, fallbacks, quotas, or jury votes. Z.AI's restricted
Coding Plan is not used.

## Trial boundary

1. **Spend:** At most two sequential requests per invocation, each capped at
   512 output tokens, with no retry. AIHubMix lists $0.06/M uncached input and
   $0.22/M output; at those text rates 2,000 input and 1,024 output tokens cost
   about $0.00035 before any separate image or other charges. This is not a
   guaranteed billing cap. The runner is not scheduled or exposed to requests.
2. **State:** Bundled synthetic fixtures only. No caller-supplied files, application
   imports, databases, or output persistence. Print bounded result metadata,
   not provider-generated prose or credentials.
3. **Failure:** Exact endpoint and exact returned model identity. Requests stay
   pinned to `coding-glm-5.4`; responses may report that ID or Z.AI's exact
   native ID `glm-5.4`, observed from the gateway in development. Neither is
   independent proof of underlying weights. Reject
   redirects, incomplete responses, unknown answer shapes, and unscorable
   output. Stop after provider/authentication/transport failures, except an
   image-related request rejection can still leave the text check useful.
4. **Repeat runs:** One attempt per case in each explicit invocation. No
   automatic replay of ambiguous timeouts or prior runs.
5. **Access:** Trusted local development command, not a web route or agent
   tool. Requires development mode and an explicit `--live` flag. Never send
   production, customer, or repository input to the provider.
6. **Stop:** Do not run it, or remove its development-only secret. Each call
   has a time limit and a response-size limit.
7. **Authority:** Case results are advisory, not votes, approvals, merges, or
   deploy authority. This evaluation cannot apply its own recommendation.
8. **Evaluation:** A screenshot fixture tests a known clipping defect and
   asks for a short marker visible only in the image. The other fixture
   checks that a review abstains when test evidence is missing. Report exact
   provider-returned identity, available usage, and latency. Neither case is
   a baseline comparison against a standing model.

Provider reference: [AIHubMix model details](https://aihubmix.com/model/coding-glm-5.4/llms.txt).

## Running it

Create a development-only `AIHUBMIX_API_KEY` secret. Do not copy it into
deployment secrets. Run only from the development workspace:

```bash
NODE_ENV=development node --import tsx scripts/evaluate-glm54-development.ts --live
```

The synthetic checkout image is a Chromium render: the parent was 264 px wide,
the overflowing button was 296 px, and `box-sizing: border-box` reduced it to
264 px. The exact rendered fixture is pinned by its SHA-256 digest. A pass
means the image marker and CSS diagnosis were correct, and the advisory review
abstained on missing evidence. It does not mean tools, streaming, general
vision, job suitability, or a production jury seat are approved.

## Live development result: November 23, 2026

Both cases passed in one bounded run through the existing evaluation script.
The gateway reported `glm-5.4` for both requests.

| Case | Result | Latency | Provider-reported input / output |
|---|---|---:|---:|
| Screenshot and CSS | Read the marker, identified right-edge clipping, and selected `box-sizing: border-box` | 1.37 s | 236 / 27 tokens |
| Non-voting review | Abstained because the candidate did not supply a verified test receipt | 1.44 s | 115 / 27 tokens |

Estimated at published token rates, the two successful calls cost about
$0.000033 before any separate image charges; this is not an invoice amount.
An earlier request was refused with HTTP 403 for an unconfirmed reason.
The later success confirms current inference access, not service reliability.
Use screenshot-to-code diagnosis as the first evaluation workload. Do not
assign a voting seat without a broader, identical-workload comparison.

## Head-to-head development trial: November 23, 2026

Eight new synthetic cases compared AIHubMix's reported `glm-5.4` with the
Replit fallback lane's reported `gpt-5.4-2026-03-05`. Both received the same
prompts and byte-identical screenshots. Each had one attempt per case, no
retries, and a 1,024-token output limit. Providers used their own default
reasoning settings. The original Gemini 2.5 Flash comparison was unscorable:
its configured gateway returned HTTP 400 for all four image cases and the
first text case. The remaining Gemini requests were not attempted, and the
cause of its rejections was not established. The GLM run was not repeated.

| Scored outcome | GLM 5.4 | GPT-5.4 |
|---|---:|---:|
| Correct layout cause | 4/4 | 3/4 |
| Accepted fix verified in Chromium | 3/4 | 3/4 |
| Image-only marker read correctly | 3/4 | 2/4 |
| Full screenshot pass (cause, fix and marker) | 2/4 | 1/4 |
| Correct advisory verdict and reason | 4/4 | 4/4 |
| Median screenshot response time | 2.73 s | 1.23 s |
| Median advisory response time | 1.36 s | 0.88 s |

The browser ran each recognized patch against the predeclared behavior at
360 and 560 px. Unpatched controls failed and known patch controls passed.
The browser only applied pre-authored patch literals, never raw model CSS.
An unrecognized patch was not credited as a fix; this does not prove that
every untested alternative was invalid.

- **Flex row:** both verified `.item { min-width: 0 }`; both missed the marker.
- **Scrollable grid:** GPT's `minmax(0, 1fr)` track passed while preserving
  table scrolling; GLM identified the cause but did not supply a recognized fix.
- **Sticky header:** GLM's `overflow: clip` on the wrapper passed while keeping
  the intended scroll container; GPT's diagnosis and patch did not pass.
- **Fixed backdrop:** both verified removal of the shell transform.
- **Advisory review:** both approved an exact matching pass, rejected an exact
  failure, abstained on a stale receipt, and rejected conflicting exact
  receipts with an unsuperseded failure. These were fictional receipt
  decisions, not actual jury deliberations or votes.

Across the eight calls, GLM reported 1,843 input and 446 output tokens, about
$0.00021 at AIHubMix's listed text rates, excluding any separate image fees.
This is an estimate for the GLM head-to-head calls, not a billing receipt or
whole-trial cost comparison. GPT reported 1,766 input and 178 output tokens.
Latency includes the provider transport and is not a load or reliability test.

**Placement:** Keep the current model and jury configuration. GLM is worth
retaining as a development-only second opinion for difficult CSS layouts:
the fixes were complementary, not a general accuracy or speed win. This
small, engineer-authored set does not justify a default, automatic escalation,
or a voting seat. No customer, production, or repository input was sent.
