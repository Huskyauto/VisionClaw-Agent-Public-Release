<!--
Thanks for opening a PR! A focused, well-tested PR is the fastest path to merge.
-->

## What does this PR do?

<!-- One or two sentences. Link any relevant issues with `Closes #123`. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New tool (added to `server/tools.ts` and seeded if needed)
- [ ] New persona / skill / governance rule
- [ ] Documentation only
- [ ] Refactor (no functional change)
- [ ] Breaking change

## Testing performed

<!--
Describe how you verified the change. For tool/agent changes, paste the
prompt you used and a snippet of the response. For UI changes, mention which
pages you clicked through.
-->

- [ ] `npm run build` succeeds locally
- [ ] App boots and `/setup` shows green for the components I touched
- [ ] If this touches database access: a fresh seed (`scripts/seed.ts`) still works

## Screenshots (UI changes only)

<!-- Drag images directly into this box. -->

## Checklist

- [ ] Code style matches the rest of the file (TypeScript, no commented-out blocks).
- [ ] New interactive elements have `data-testid` attributes.
- [ ] No secrets, API keys, or owner-specific paths committed (the public-mirror sanitizer will reject them anyway).
- [ ] If the PR adds a tool, the description in `server/tools.ts` clearly explains when an agent should call it.

## Anything else the maintainer should know?
