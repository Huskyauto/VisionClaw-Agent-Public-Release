# Implementation and verification

1. Red/green tests for unrelated-turn isolation and explicit context intent.
2. Replace synthetic user-note injection with labeled assistant-context data,
   preserve last real user message, persist bounded turn provenance.
3. Extend the existing tenant-checked session inspector, without a new tool.
4. Red/green ready-lane selection and bounded timeout classification tests;
   preserve explicit pins, cost gates and quorum.
5. Verify focused tests, types/build, independent review and local startup.
6. Record provider-access evidence and outstanding credential/inference limits.

Independent review: no serious new isolation/permission violation; two MEDIUM
failure paths addressed with token-fenced late preparation cleanup and escalation
persistence independent of concordance. The raw-query live probe caught/fixed
Drizzle JS-array interpolation; synthetic dev rows were cleaned after verifying
read/write and foreign-tenant exclusion. Full live Felix acceptance and broader
streaming/background context coverage remain partial, not falsely certified.