export const BUILD_EXPERIMENT_GUIDANCE = `BUILD EXPERIMENT DISCIPLINE (advisory):
Before substantial implementation, name the user outcome, hardest assumption,
cheapest decisive test, time/spend bound, and stop condition. Reuse existing
machinery; test that uncertainty before expanding UI or infrastructure.
Define success with independent evidence plus an unacceptable "win" (such as
a valid file with unsupported claims). Retain inconclusive evidence honestly.
For a small fix, use a small regression test rather than a planning ceremony.
This guidance does not grant spend, tool access, retries, approval or publication.
Continue authorized work; do not add redundant permission questions.`;

export function buildExperimentGuidance(userText: string): string {
  return /\b(build|implement|develop|create|refactor|automate)\b/i.test(userText.slice(0, 16_000))
    ? BUILD_EXPERIMENT_GUIDANCE : "";
}
