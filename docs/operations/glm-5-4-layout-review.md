# GLM 5.4 layout second opinion

In **Website Audit / AI Readiness Report → GLM 5.4 layout second opinion**,
use the first diagnostic as usual. If a clipping, scroll or positioning fix
does not work, select a cropped **public or synthetic** screenshot and paste
only the relevant CSS rules. Inspect the screenshot preview, confirm the
disclosure, then select **Send to GLM 5.4**. Review the response as advice and
verify the change in Chromium or another target browser. Do not paste secrets,
internal code, customer information, screenshots from signed-in pages, or
configuration. Inputs or results are not persisted by this feature.

The single AIHubMix request leaves VisionClaw. [AIHubMix's ZDR terms](https://aihubmix.com/legal/zdr)
describe its default setting and warn that upstream providers may retain data
differently. The feature does not establish the route's end-to-end retention.
It re-encodes the image without metadata and screens the CSS, but cannot
determine what's in the pixels; the owner's explicit review is required.

## Enable, verify, and stop

- Feature flag `GLM54_LAYOUT_REVIEW_ENABLED=1` and `AIHUBMIX_API_KEY` Secret in
  the target environment; other values disable it. The old development CLI
  remains development-only and is not made available in the app.
- Authenticated canonical owner and POST CSRF. API keys do not confer access.
  PNG, JPEG or WebP up to 360 KB, no image URLs, at most 3,000 CSS characters.
  The dedicated route re-encodes to a maximum 1,100 pixels on the longest side.
- One in flight and six submissions per process per hour. Each accepted
  submission reserves five cents against the durable shared daily metered-AI
  ceiling. This is conservative admission accounting, not an invoice or a
  per-image pricing guarantee. A duplicated submission ID cannot spend again;
  provider errors and ambiguous outcomes do not release the reservation early.
- One HTTPS call, 25 seconds, 512 output tokens, no redirect, alternate
  model or automatic retry. The report requires an exact documented model ID
  and a finished, structured answer. Only timing, status and model identity
  are logged for successful reviews; no screenshot, CSS or advice is logged.
- To stop new submissions, set the flag to `0` and restart the serving
  environment, or revoke the key at the provider. No default models, jury
  seats, tools, or automatic audit steps change.

Run `node --import tsx --test tests/unit/glm54-layout-review.test.ts` for offline
regressions. Verify deployment in the original published app by confirming an
anonymous request is refused, then submitting one synthetic owner case in the
Website Audit UI. A publish flag or app health check alone is not proof of
live model access.

## Pre-publish evidence (November 23, 2026)

- The release-check client and server build succeeded with dev-data sync off.
- A signed-in 430 px Chromium run used a bundled synthetic screenshot. Preview
  and consent gated dispatch; the canonical owner POST reserved budget, returned
  `glm-5.4` and displayed the expected `box-sizing: border-box` recommendation.
  Consent reset and the test session was revoked afterward.
- The running development server rejected an oversized body (`413`), malformed
  JSON (`400`), encoded JSON and form POSTs (`415`), and anonymous valid input
  (`403`). Sixteen focused tests passed, covering the offline owner/admission,
  native image/metadata, bounded response, redirect, and durable budget logic.
- Independent scoped review found no remaining pre-publish blocker. Replit's
  production configuration reports the exact enable flag and the Secret's
  presence; the original VM still requires owner Republish.
- This does not establish production model access or multi-process load capacity.
