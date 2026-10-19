import { runReflectionOwnerWork, REFLECTION_SOURCES } from "../server/lib/reflection-owner-work";

// This is an internal owner repository helper, not a chat tool or HTTP API.
// It accepts no raw prompt, customer records, runtime log or credential input.
const args = process.argv.slice(2);
const task = args.find(a => a.startsWith("--task="))?.slice(7);
const sourcePath = args.find(a => a.startsWith("--source="))?.slice(9);
if (args.length !== 2 || !["review-source", "draft-tests", "compile-runbook"].includes(task || "") ||
    !(REFLECTION_SOURCES as readonly string[]).includes(sourcePath || "")) {
  console.error("Usage: npx tsx scripts/reflection-owner-work.ts --task=review-source|draft-tests|compile-runbook --source=<allowlisted source>");
  console.error(`Allowed sources: ${REFLECTION_SOURCES.join(", ")}`);
  process.exitCode = 2;
} else {
  try {
    const result = await runReflectionOwnerWork({ tenantId: 1,
      task: task as "review-source" | "draft-tests" | "compile-runbook",
      sourcePath: sourcePath as typeof REFLECTION_SOURCES[number] });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof Error && /^Reflection owner work failed at (?:source|inference|accounting-setup|accounting|completion|output-schema|grounding); no retry or paid fallback$/.test(error.message)) {
      console.error(error.message);
    }
    console.error("Reflection owner work did not complete. Check the enable flag, approval expiry, account policy and source/response validation. No automatic retry or paid fallback.");
    process.exitCode = 1;
  }
}
