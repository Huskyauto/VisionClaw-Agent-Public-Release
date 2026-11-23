# Nightly model intelligence evidence

The model scanner is not a second registry installer. It selects candidates from
the official Anthropic Models API using the existing platform direct key. It
requires an exact ID marked Active in the official model-status table and a
provider-declared release date no more than 90 days old. A date suffix, if
present, must agree. Known aliases, previews, snapshots of already
represented model lines, and deprecated or retired models are excluded. This is
conservative: aliases, evidence-free providers, pricing, benchmark scores and
first availability across other providers are not verified by this source.

The existing program is identified at runtime by its stored name: changing the
seed text alone would not update a running program. If the source is unavailable,
the program ends with `model_catalog_unavailable`; if the catalog has no eligible
unreviewed candidates, it ends without generation. Other programs keep their
usual behavior. Pause the existing research program/schedule to stop scanning.

- **Cost and scope:** two fixed HTTPS reads per process per hour on
  success, or per 15 minutes on failure; no retries, redirections, pagination,
  tenant-supplied endpoint or credentials. Existing owner-only budget guard
  still precedes the two advisory LLM calls per admitted experiment. No separate
  LLM session summary is needed. Unsupported providers stay out of this scanner.
- **Failure and evidence:** the sources share an 8-second deadline, a 128 KB
  cap per response, and one page of 100 model records. Reject malformed, future, mismatched or
  unconfirmed output; store provider metadata separately from advisory analysis.
  Catalog data is cached only in memory. Nothing new is stored on disk.
- **State and authority:** existing tenant-scoped experiment and registry
  records. One pending owner review per canonical model line in this scanner,
  using a transaction lock and lookup. Record review insertion, deduplication,
  source rejection or write failure before finalizing the score; embeddings
  cannot prevent review creation. No registry/routing edits or new approval
  grants. Other registry producers are not changed by this lock. Previously
  queued/replayed scanner findings cannot draft code. Existing generated
  proposals and registry review records are unchanged and should be individually
  verified before approval. The digest does not present historical findings
  without recorded evidence or old scanner proposals as new recommendations.
  Preserve them rather than deleting the history.
- **Evidence:** regressions cover retired, old, duplicate, alias, counterfeit ID,
  future and mismatched-date cases, name-specific runtime gating, and replay.
  No claim that the model itself was invoked successfully, priced, benchmarked,
  or deployed. The separate provider catalog watcher is unchanged.
