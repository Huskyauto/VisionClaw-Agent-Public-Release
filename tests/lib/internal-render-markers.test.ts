import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inheritInternalRenderStaging,
  isInternalTransientTtsSegment,
  markInternalRenderStaging,
  markInternalTransientTtsSegment,
  shouldPublishLocalProductOutput,
  shouldRequireAudioDriveDurability,
  shouldRequireFinalRenderDriveDurability,
} from "../../server/lib/internal-render-markers";
import { isActiveAttentionEventStatus } from "../../shared/attention-status";
import { stripTrustSignals } from "../../server/tools/context";

test("only a server-issued marker exempts transient renderer audio from Drive delivery", () => {
  assert.equal(
    isInternalTransientTtsSegment({ _internalTtsSegment: true }),
    false,
    "an ordinary tool argument must never disable durable audio delivery",
  );
  assert.equal(shouldRequireAudioDriveDurability({ _internalTtsSegment: true }), true);

  const rendererRequest = markInternalTransientTtsSegment({ text: "temporary narration" });
  assert.equal(isInternalTransientTtsSegment(rendererRequest), true);
  assert.equal(shouldRequireAudioDriveDurability(rendererRequest), false);
  assert.equal(shouldPublishLocalProductOutput(rendererRequest), false);
  assert.equal(
    JSON.stringify(rendererRequest),
    JSON.stringify({ text: "temporary narration" }),
    "the marker must not cross a JSON/tool-contract boundary",
  );
});

test("only server-marked render staging may bypass final-video Drive delivery", () => {
  assert.equal(
    shouldRequireFinalRenderDriveDurability({ uploadToDrive: false }),
    true,
    "a normal tool argument must not create a local-only final video",
  );
  assert.equal(
    shouldRequireFinalRenderDriveDurability(markInternalRenderStaging({ uploadToDrive: false })),
    false,
  );
});

test("trusted render handlers preserve staging only from a server-issued source request", () => {
  const handlerOptions = { title: "chapter", uploadToDrive: false };

  assert.equal(
    shouldRequireFinalRenderDriveDurability(
      inheritInternalRenderStaging({ _internalRenderStaging: true }, { ...handlerOptions }),
    ),
    true,
    "a JSON property must not survive handler reconstruction as staging authority",
  );
  assert.equal(
    shouldRequireFinalRenderDriveDurability(
      inheritInternalRenderStaging(
        markInternalRenderStaging({ replay: true }),
        { ...handlerOptions },
      ),
    ),
    false,
  );
});

test("dispatcher stripping retains private staging but removes caller trust signals", () => {
  const dispatched = stripTrustSignals(
    markInternalRenderStaging({
      uploadToDrive: false,
      _tenantId: 999,
      _internalRenderStaging: true,
    }),
  );

  assert.equal(dispatched._tenantId, undefined);
  assert.equal(dispatched._internalRenderStaging, true);
  assert.equal(
    shouldRequireFinalRenderDriveDurability(dispatched),
    false,
    "the private staging capability must survive the dispatch clone",
  );
});

test("attention wake status retains routed events but excludes resolved history", () => {
  assert.equal(isActiveAttentionEventStatus("pending"), true);
  assert.equal(isActiveAttentionEventStatus("routed"), true);
  assert.equal(isActiveAttentionEventStatus("no_subscribers"), false);
  assert.equal(isActiveAttentionEventStatus("processed"), false);
  assert.equal(isActiveAttentionEventStatus("failed"), false);
});