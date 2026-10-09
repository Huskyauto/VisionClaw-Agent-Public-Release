# Browser Workbench

## User contract
Add a collapsible Browser Workbench sidebar folder immediately after Income
Opportunities. All signed-in users can access its overview, existing browser
controls and dedicated browser-related files/folders. Do not replace My Vault.
Explain capabilities, workflow, security, session expiry and limitations honestly.
Keep existing human-control and exact-page gates unchanged. No publication.

## Design gate
1. Cost: no model calls or autonomous processes; reuse tenant upload/download
   storage. Cap library at 100 folders/500 files/100 MB and uploads at 8 MB.
2. State: one tenant-owned PostgreSQL library row; JSON contains organizational
   references only. Bytes remain in existing authenticated file storage.
3. Failure: reject invalid state, foreign file references and stale revisions.
   Upload bytes and filing metadata commit together in the same transaction.
   Never repeat an ambiguous upload automatically; revision/UUID/digest receipts
   prevent duplication. No shared Google credentials or public filesystem uploads.
4. Idempotency: revision fencing plus UUID/digest receipts under a row lock.
   Reusing an operation for different content fails; stale operations do not apply.
5. Tenant/limits: authenticated tenant only, same human-session/API-key guard and
   account limiter as browser controls. Every library and file query is scoped.
6. Stop/observe: entirely manual; users stop by leaving the page. No new loop.
   UI exposes confirmed saves/errors; APIs return explicit statuses.
7. Authority: humans organize their own files, confirm removal, and choose when
   to hand control back. No new agent mutation permissions or approvals.
8. Delta: navigation and bounded organization, not expanded browser or model
   powers. Compare navigation, CRUD persistence, foreign-tenant denial, concurrent
   revisions and unchanged control tests.

## File semantics
Folders may contain subfolders; delete only empty folders. Upload, add an existing
own file, rename its workbench label, move it, download it, or remove its workbench
reference. Removing a reference does not delete My Vault bytes; say this explicitly.
Browser downloads are not automatically imported; users save/upload files here.
No filesystem paths, arbitrary URLs, external mounts or public grants are created.

## Publication/rollback
Apply the additive library table/FK only to development. Replit Publish applies
managed production schema differences after explicit owner approval. No startup
DDL or custom production migration. Roll back routes/navigation before dropping
the library table; existing file bytes and My Vault remain untouched.