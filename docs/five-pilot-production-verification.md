# Five-pilot production verification — 2026-10-19

**Result: PASS for the requested five pilots on the published app.**

Official deployment metadata confirmed a successful public VM deployment at
https://agenticcorporation.net. Production startup logs showed serving on port5000
at20:29UTC. Actual production tool-execution logs at21:13UTC corroborated Forge's
natural governance description and Felix's five guarded pilot invocations.
Both chats completed without tool errors, delegation or failover.

| Pilot | Executed production evidence |
|---|---|
| Business health | Synthetic baseline20%; next period10%, improved−10percentage points; missing inputs remained Unknown. Saved report and comparison retrieved correctly. |
| Release readiness | Six unknown areas produced “Incomplete — evidence gaps,” not approval. Report/history persisted. |
| Governance | Six unsupported controls produced six gaps and0/6 documented, explicitly not certification. Report/history persisted. |
| Cost/routing | Synthetic rates/tokens calculated6USD and0 qualified savings. This is a fixture estimate, not a6USD charge; no routing was changed. |
| Website/agent readiness | Live guarded read-only run returned all five evidence checks for the owner's public homepage. No booking, external action or benchmark completion was claimed. |

## Persistence and safeguards

- Four saved kinds accepted identical request-ID retries without duplicate rows
  or changes to the saved result.
- Changed health input with an existing request ID returned409 and preserved
  the original comparison.
- Deleting a referenced synthetic baseline returned409.
- Invalid kind/input returned422.
- Anonymous, forged-session/tenant/admin headers and invalid API keys were401.
  Valid customer/API-key credentials were not borrowed.
- Owner Drive-health, OneDrive-health and cache-stat requests returned200,
  confirming the earlier session-hydration correction is live.

## Actual browser journey

The owner workbench at `/admin/pilot-tools` showed all four saved pilot tabs and
their exact synthetic results. One additional health re-scan was submitted
through the UI against the exact September baseline:5%, improved−5percentage
points, four other indicators Unknown. Creation returned201; the same run and
results survived reload. Its nonempty plain-text report was checked. The UI
does not offer a Markdown download control; none was claimed tested.

Deleting only that UI-created record returned200 and it disappeared after reload.
`/admin/website-audit` loaded its Quick Audit panel; no additional scan was started.
Readiness execution was already verified through the guarded chat tool.

## Cleanup and limits

Five API fixture reports, the one UI-created report and two diagnostic
conversations were removed through their normal owner APIs. Original history
was preserved; no customer records, configuration, provider routing, schema,
credentials or production source were changed. The two local private fixture
files were removed. Exact server-side revocation of the test Bearer session is
unverified; no guessed logout endpoint or unrelated-session clearing was used.

The expected alternate-auth `/api/auth/user`401 remained. The browser also
reported failed Google Fonts requests; the exact Open Sans URL returned200 in
a separate direct fetch. The UI stayed readable and functional. No pilot API5xx
or owner Drive-health403 appeared. These observations identify the current
resource warnings, not conclusively the earlier unlabeled network error.

Two harness assumptions were corrected without rerunning the model requests:
the richer health endpoint requires authentication, and unsupported governance
controls correctly become evidence gaps rather than literal Unknown findings.
After browser use, cleanup refreshed its CSRF context and used canonical JSON
headers before deleting exact fixture identities in dependency-safe order.

No further publish is needed for these verified tools. No additional push or
publication was performed. This focused operational verification is not a new
whole-repository security audit or a retest of the earlier uncertain paid turn.

Structured evidence:
`data/feature-contracts/post-publish-recovery/production-verification.json`.
