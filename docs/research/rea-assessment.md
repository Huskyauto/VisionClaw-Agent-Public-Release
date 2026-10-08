# REA assessment — October 5, 2026

## Verdict

Useful specialist capability; do not install or expose globally in VisionClaw.
Retain for a bounded, authorized binary or packaged-application investigation.
The external toolkit assessment is documentation/source inspection, not runtime
acceptance or a benchmark.

## Primary sources inspected

- https://github.com/morluto/rea
- https://raw.githubusercontent.com/morluto/rea/main/README.md
- https://raw.githubusercontent.com/morluto/rea/main/SECURITY.md
- https://raw.githubusercontent.com/morluto/rea/main/package.json
- https://raw.githubusercontent.com/morluto/rea/main/docs/installation.md

The inspected package declares version 4.0.1; the supplied screenshot shows 3.2.1.

## Capability comparison

| Representative case | Existing baseline | REA contribution | Assessment |
| --- | --- | --- | --- |
| Understand a public website's interface | VisionClaw browser observation and design-document extraction | Structured browser/script observations and capture comparisons | Overlap; passive REA CDP requires a literal loopback endpoint, not a direct replacement for remote browser services |
| Recover structure from an authorized Electron/ASAR or .NET release without executing it | Source inspection when source is available; current inspected tool surfaces have no dedicated REA/Hopper/Ghidra adapter | Static module/IPC/storage mapping, managed metadata/CIL inspection, build comparison | Promising specialist addition; dynamic relationships and obfuscation remain limitations |
| Analyze an authorized native executable with no source | General shell/file inspection, not a dedicated decompiler integration | Hopper/Ghidra decompilation, cross-references, call graphs | Clearest new capability, but requires an external analysis engine and supported host |
| Explain exactly what executed at runtime | Existing browser/process evidence is distinct from static code | Controlled scenarios and Inspector observations | Do not infer execution or causality from recovered call graphs; broad Frida/LLDB native tracing remains roadmap work |
| Open an untrusted binary beside production credentials | Not an acceptable test setting | Provider executes with the current OS user's permissions | Reject; REA explicitly is not a sandbox |

These are engineer-visible compatibility cases, not executed held-out targets.
No package was installed, agent configuration altered, target executed, or
customer data inspected.

## Constraints

- Supported Linux distributions named by upstream are Ubuntu, Fedora and Arch;
  this workspace's NixOS is not a documented supported host. Compatibility is
  unverified, not proven impossible.
- Native analysis needs Hopper (separate license/demo limits) or Ghidra.
  The inspected Ghidra integration requires Ghidra 12.1.4 and JDK 21.
- Windows Ghidra operations are currently unavailable pending ownership,
  permission and path controls.
- Local analysis does not imply that evidence sent to an agent stays off its
  model provider. Sensitive captures still need the platform's data controls.
- REA's MIT license licenses REA, not third-party software being investigated.
  Target authorization, applicable licenses and independent implementation matter.

## Smallest worthwhile future trial

On a restricted supported worker without production credentials, compare
ordinary source/file inspection with REA against independently prepared,
owned synthetic packaged releases: one known route/IPC change, one changed
managed/native routine, and one unresolved dynamic relationship.

Require correct, artifact-bound findings; changed behaviors identified;
unresolved relationships marked unknown rather than falsely verified; and
observed time, memory and model cost. Adoption needs a reproducible gain over
the existing baseline with no authorization or isolation failure. Failure to
resolve a target is not permission to weaken evidence requirements.

## Transferable ideas, not shipped changes

Byte-and-provider-bound analysis snapshots; explicit observed/inferred/unknown
claims; and cross-version evidence comparisons are useful design references.
Check existing VisionClaw authority receipts, evidence-confidence labels and
semantic checkpoints before adding another overlapping framework.

## Own-project follow-up

Upstream's [JavaScript workflows](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)
also cover semantic feature tracing, historical source-to-bundle mapping and
export return-shape comparisons. These can investigate owned source projects
without Hopper/Ghidra; ambiguous calls and partial inventories remain unknown,
not proof of equivalent behavior.

One directly useful principle is syntax-aware import analysis. A report-only,
six-case synthetic comparison ran the actual existing domain-boundary CLI on
temporary fixtures: it missed a sibling-domain side-effect import and a
multiline dynamic import (4/6 correct), while a small TypeScript AST sketch
classified all six correctly. This was an engineer-visible experiment, not
independent validation of REA itself.

The native domain-boundary checker was then strengthened with the already
installed TypeScript parser, without importing REA. Its regression checks cover
literal import forms, safe imports/comments, unresolved dynamic targets and
malformed input. The canonical test runner includes them. This is a CI
stability improvement, not evidence that a production incident was repaired.

Defer broader semantic graphs, source-to-bundle matching and export comparison
until an owned-project investigation demonstrates an unmet need beyond current
compiler, module-boundary and behavioral tests.
