import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoldenPathDispatcher, isLegacyReplayAuthorityFreeze, ReplayToolBlocked, withGoldenPathProgress,
} from "../../scripts/lib/golden-path-replay-runtime";
import {
  prepareToolInvocation,
  snapshotToolAuthority,
} from "../../server/tools/invocation-authority";
import { enforceToolPolicy } from "../../server/safety/destructive-tool-policy";

test("the replay's five tool names reach the normal policy with scoped system authority and no approval", async () => {
  const called: string[] = [];
  const dispatch = createGoldenPathDispatcher(async (name, params, input) => {
    const ctx = snapshotToolAuthority(input);
    assert.equal(ctx.tenantId, 1);
    assert.equal(ctx.actor, "system");
    assert.equal(ctx.invokedVia, "golden-path-replay");
    assert.equal(ctx.approvalGranted, undefined);
    const stamped = prepareToolInvocation(params, ctx);
    assert.equal(stamped._tenantId, 1);
    assert.equal(stamped._personaId, undefined);
    const policy = await enforceToolPolicy(name, stamped, {
      tenantId: ctx.tenantId, personaName: "system", invokedVia: ctx.invokedVia,
      hasApproval: ctx.approvalGranted === true,
    });
    assert.equal(policy.action, "allow", name);
    called.push(name);
    return { fixture: true };
  });
  const tools = ["build_html_app", "create_styled_report", "start_video_job", "mpeg_produce_parallel", "grade_deliverable"] as const;
  for (const name of tools) {
    assert.deepEqual(await dispatch(name, {
      prompt: "Fixed nightly fixture", _tenantId: 42, _personaId: 17, _approved: true,
    }), { fixture: true });
  }
  assert.equal(called.length, tools.length);
  await assert.rejects(dispatch("send_email" as never, {}), /not a golden-path replay tool/i);
  assert.equal(called.length, tools.length);
});

test("a policy refusal stays an infrastructure failure rather than an artifact result", async () => {
  const dispatch = createGoldenPathDispatcher(async () => ({
    error: "Blocked by destructive-tool policy", blocked: true,
  }));
  await assert.rejects(dispatch("build_html_app", {}), ReplayToolBlocked);
});

test("only the exact historical pre-dispatch failures may bypass a persisted freeze", () => {
  const error = "Tool authority or policy enforcement unavailable; no execution.";
  assert.equal(isLegacyReplayAuthorityFreeze(
    `producer returned no usable artifact path (got: ${JSON.stringify({ error, blocked: true })})`,
  ), true);
  assert.equal(isLegacyReplayAuthorityFreeze(
    `producer threw: Two-scene video job did not start with exactly two scenes: ${error}`,
  ), true);
  assert.equal(isLegacyReplayAuthorityFreeze(`grader fail: ${error}`), false);
  assert.equal(isLegacyReplayAuthorityFreeze("duration changed by 50%"), false);
});

test("a later policy denial preserves and alerts on a completed regression", async () => {
  const failed: string[] = [];
  const events: string[] = [];
  await assert.rejects(withGoldenPathProgress(async () => {
    failed.push("first_fixture");
    throw new ReplayToolBlocked("grade_deliverable");
  }, () => {
    events.push(`saved ${failed.join(",")}`);
  }, async () => {
    events.push(`alerted ${failed.join(",")}`);
  }), ReplayToolBlocked);
  assert.deepEqual(events, ["saved first_fixture", "alerted first_fixture"]);
});
