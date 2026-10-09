# Implementation and acceptance
- Build tested, bounded library transitions and tenant-scoped repository/routes.
- Add overview/library pages and relocate navigation beside Income Opportunities.
- Apply only additive development DDL; retain existing control behavior.
- Verify core transitions, tenant isolation, revisions, replay and existing tests.
- Check build/types, scoped independent review, phone/desktop navigation and
  one protected library CRUD journey; remove only synthetic fixtures.
- Update runbook and agent guidance without expanding tool permissions; no publish.

## Confirmed engineering evidence
- 48 backend/control tests plus seven frontend response/selection/download tests
  passed, with typecheck/production build passing on final code.
- Live development database: exactly one concurrent revision winner; foreign
  file denied; upload replay inserted bytes once; changed byte digest denied;
  quota checked before inserting bytes. Rejected saves retained revision/state.
- Canonical synthetic password login returned 200; authenticated CSRF bootstrap
  then real library GET 200, foreign-file POST 404, anonymous GET 401.
- Independent review closed account-owned local state, cached error rendering
  and interrupted/malformed mutation confirmation findings; targeted tests passed.
- Protected 390×844 / 1280×900 UI acceptance passed: sidebar and all three links,
  descriptive overview, nested-folder create/rename, native private upload,
  reload persistence and byte-for-byte download, file-label rename, move to root,
  confirmed reference removal, Vault-byte retention/add-back and empty deletion.
  The original upload's HTTP status was not captured; its persisted bytes,
  metadata and authenticated download were verified. Traced later CRUD POSTs200.
- Move's excluded current-folder initialization was caught and fixed; pure
  default-selection regression and resumed exact UI flow passed. Download uses
  the existing API's authoritative original filename, not the workbench label.
- One synthetic GET503 hid cached rows/counts and disabled writes; live refresh
  recovered them. One aborted synthetic create POST produced an unknown-save
  fence with no auto-repeat; live refresh restored the unchanged library.
- No production or real-owner fixtures were used. Exact synthetic accounts,
  auth sessions, library rows, file bytes and temporary helper/credentials removed.