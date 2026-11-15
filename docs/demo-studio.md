# Integrated Demo Studio and interface quality

## Outcome
Owner sidebar **Demo Studio** at `/admin/demo-studio` creates usable offline
HTML walkthroughs. The editor and existing `build_html_app` tool share the same
validated renderer. This is a production feature in source, not a trial flag.
Publication remains owner-controlled.

Edit/reorder/add/remove steps, choose screenshots, set optional pointer position,
play/pause/seek, download HTML, and save/reopen project JSON. Drafts are
page-session-only, clearly labeled; project files are the explicit durable copy.
Nothing uploads, sends or saves screenshots automatically.

## Agent use
```
build_html_app({
  topic: "Report review walkthrough",
  demo: {
    version: 1,
    title: "Review a report",
    steps: [
      {title: "Review", description: "Read the draft and check the evidence.", seconds: 6},
      {title: "Approve", description: "Approve delivery only after review.", seconds: 5}
    ]
  }
})
```
The demo branch never invokes a model. It keeps the existing static DOM
validation and delivery pipeline. `verification_scope: static-dom-only` means
generated scripts were not executed by the server. Fixture tests execute only
our deterministic template, never arbitrary model-generated HTML. Use existing
delivery and verification tools with their normal tenant/approval controls.
The downloadable HTML is always labeled a reconstruction, never execution
evidence. No account, payment or backend operation occurs during playback.

## Adopted lessons and limits
- Emil: mobile/touch/keyboard usability, long/missing/non-Latin data, useful
  empty/error states, animation restraint and reduced-motion support are now
  unconditional instructions in the existing utility generator. These prompt
  requirements are not a guarantee of compliance or a new production gate.
- Fil: independent implementation of a single-clock, seekable DOM/CSS
  walkthrough. Every frame is derived from time, not chains of timers.
- MengTo: reference-based builder instructions distinguish retrieved layout,
  timing, state and asset observations from inference and require authorized
  assets. No bulk skill import or dependency.
- Hairline/Blender/Dream Loop/REA: no packages, speculative agents or services
  added. Pointer illustration libraries and native reverse-engineering tools
  are not prerequisites for this capability.

Sources: https://github.com/emilkowalski/skills ,
https://github.com/MengTo/Skills ,
https://fil.design/skills/html-demo/demo/index.html .
No upstream code or artwork was copied.

## Pre-build design gate and acceptance
1. Cost: zero model/API calls in demo mode; ordinary utility routing unchanged.
2. State: explicit downloaded JSON/HTML, no UI disk/database/browser-storage
   writes; agent staging uses its existing approved artifact lifecycle.
3. Failure: schema/import errors retain the draft; preview sandbox has scripts
   but no same-origin authority; generated HTML has no remote dependencies.
4. Idempotency: pure rendering from validated data; downloads are explicit local
   file creation. No automatic sends, uploads, retries or recurring jobs.
5. Tenant/limits: owner-only UI, existing tool authorization; 12 steps, 2–30
   seconds each, bounded raster data URLs, aggregate 6-MB UTF-8 project limit.
6. Stop/observe: pause playback, export or leave the editor. No autonomous loop
   needing an operational kill switch; validation errors stay visible.
7. Authority: user edits/downloads; agent execution uses existing tool policy.
   Reconstruction cannot grant approval or replace delivery receipts.
8. Delta: no new model, service, tool, package, schema or runtime agent count.
   Checks cover deterministic seeking, hostile input, actual no-model builder,
   strict admission and recoverable failures.

## Review basis
Requested: fully usable sidebar features or already-integrated agent behavior;
no dormant trials. Scope: Demo Studio, shared deterministic builder mode,
existing HTML generation requirements and persona wiring. Not included:
general-purpose video editing, AI screenshot generation, binary execution,
automatic publishing or new cloud persistence.
