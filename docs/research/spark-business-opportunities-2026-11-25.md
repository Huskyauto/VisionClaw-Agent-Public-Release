# Spark business-opportunity review — November 25, 2026

## Decision

Implement one small preparation step: an **HVAC Invoice Processing Pilot** in
the existing owner-only Customer Revenue Launchpad and a real offline scorer
for operator-supplied extraction results. No extraction engine, customer-data
upload, model installation, payment path, prospect contact or public offer is
activated. This measures a business outcome before adding another service.

Source: Bob's supplied *Daily AI Edge Report — November 25, 2026* from Muse Spark.
The source is advisory evidence, not permission from Spark to act. Bob explicitly
requested implementation of useful business opportunities. Retain the other
ideas below without treating vendor announcements as customer demand.

## Source verification and corrections

1. **PrismML Bonsai 2.5 27B:** the first-party November 24 release and documentation
   confirm Apache 2.0 weights and a 5.93 GB PTQ1_0 packing. Performance numbers are
   vendor-reported. Crucially, PTQ1_0 requires PrismML's llama.cpp binaries;
   upstream llama.cpp b11556+ uses a roughly 7.6 GB Q2_0 file. Weight size excludes
   runtime, KV cache, vision and concurrency overhead. It does not fit this 4 GB
   VM. Do not download it here, assume compatibility with existing Ollama, or
   replace the approved laptop models before a separate bounded comparison.
   - https://prismml.com/news/bonsai-2-5-27b
   - https://docs.prismml.com/models/bonsai-2-5-27b
2. **Nemotron Parse 2.0:** NVIDIA's model catalog confirms document-image parsing,
   tables/charts and handwriting support, commercial use subject to the NVIDIA
   Open Model License and tokenizer CC-BY-4.0 obligations. Its listed Hugging Face
   release date is **August 3, 2026**, not November 24. It is not a fresh launch
   merely because a current digest mentions it. Parsing layout/text is not
   proof of invoice-field accuracy or accounting readiness.
   - https://catalog.ngc.nvidia.com/orgs/nim/nvidia/models/nemotron-parse-v2.0
   - Catalog-linked model: https://huggingface.co/nvidia/NVIDIA-Nemotron-Parse-2.0
3. **Cognition SWE-2.1 and DXC Frontier Code Assurance:** primary announcement
   pages were located for November 24. This supports the existence of the
   announcements, not our access, permissive commercial resale, quality,
   liability coverage or any vendor score. Free trial access is temporary.
   - https://cognition.com/blog/swe-2-1
   - https://dxc.com/newsroom/11242026-dxc-introduces-frontier-code-assurance-a-managed-code-security-service-built-on-claude-mythos
4. **Lara:** a November 24 Tigerless press release was located. No particular
   repository, license, reusable component or security review has been established
   in this assessment. Do not import code based on “regulated production code.”
   - https://www.accessnewswire.com/newsroom/en/banking-and-financial-services/tigerless-health-launches-lara-the-enterprise-ai-agent-born-from-reg-1255973
5. **GLM-5.4:** this is already covered by VisionClaw's bounded GLM review/trial.
   Do not duplicate the integration or unlock general routing from a Coding Plan
   entitlement. Quantum news, health acquisitions, Waldo and Cloudera are not
   independently evaluated here because none is necessary for the selected pilot.

## Ranked business hypotheses

Scores are engineering judgments, **not measured demand**. Eight dimensions are
scored 0–5: pain, buyer access, willingness to pay, VisionClaw advantage, evidence,
speed to sale, repeatability, delivery confidence. Subtract five 0–5 penalties:
build effort, variable cost, legal/credibility risk, unverified dependencies,
support burden. Prices are test hypotheses requiring owner and buyer approval.

| Rank | Offer and buyer | Shape | Eight scores | Five penalties | Net | Price hypothesis |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Human-reviewed invoice-entry pilot for HVAC shop owners/office managers | Diagnostic → DFY | 5/4/3/4/3/4/4/3 | 1/1/2/1/2 | 23 | $250 for 20 approved invoices |
| 2 | Private-AI workflow readiness for a small business with sensitive administrative documents | Existing readiness assessment | 4/3/3/4/3/3/3/3 | 1/1/3/2/2 | 17 | Existing $1,500 assessment hypothesis |
| 3 | Authorized repository security triage for a small SaaS/agency owner | Human-reviewed diagnostic | 4/2/3/3/3/3/4/2 | 2/2/5/2/3 | 10 | $497 one-off first, not monthly by default |
| 4 | Local coding-cost comparison for Bob, later a private deployment service | Internal benchmark → service | 3/4/2/3/2/2/3/2 | 3/1/2/4/3 | 8 | No price until independent task evidence |
| 5 | Plain-language reporting over a business's approved operational spreadsheet | Existing custom reporting | 3/2/2/3/2/2/3/2 | 3/2/3/2/3 | 6 | Paid discovery only after a specific reporting job |

### Why the invoice pilot wins

The buyer, manual task and measurable result are concrete, and Bob can evaluate
HVAC invoice errors competently. The scorer needs no new inference service and
does not depend on the unresolved laptop connection. It compares accuracy and
whole-workflow time instead of announcing a parsing “microservice” before anyone
has agreed to use or buy it. It is not yet sellable extraction software.

### Private-AI readiness: reuse, do not create a duplicate offer

The Launchpad already has **AI Readiness & Governance Audit** and the Fable
workspace has a done-for-you deployment concept. Assess one administrative
workflow using synthetic or explicitly sanitized data: map where data travels,
what remains local, which providers/logs/backups receive it, offline requirements,
hardware and support cost, and the customer's authorized approver.

Never label the current hosted VisionClaw plus Tailscale/hosted fallback “air
gapped.” A local model is not proof that orchestration or telemetry stays local.
Do not claim HIPAA/Illinois legal compliance or diagnostic/therapeutic capability.
No PHI or privileged documents are needed for initial buyer discovery.

### Managed code assurance: retain as a controlled service concept

Require written repository-owner permission, approved export/retention settings,
a sanitized or synthetic first fixture, human verification and precise scope.
Use existing SAST/dependency checks before adding another paid model. Findings
are advisory; no “secure,” “certified” or penetration-test guarantee. Do not
upload a private repository to Devin, sell exploits, or assume a vendor's trial
is licensed for customer work. A monthly offer requires evidence of recurring
changes and a maintenance commitment, not a renamed one-off scan.

### Bonsai local coding: retain behind connection and compatibility evidence

First restore and verify the existing Legion/Surface path. Then consider an
isolated, owner-approved laptop trial with fixed tasks, existing-model controls,
tests of exact outputs, memory/latency measurements and a rollback. Never use the
weight-file size to claim zero cost: downloads, power, labor and support matter.
Do not change either laptop's endpoint, runtime or model allowlist as part of
this business review.

### Plain-language data agent: narrow to business reporting

Prototype only after a business identifies one repeated reporting question.
Use declared synthetic rows and reconcile every total against deterministic
calculation. No health/ring data is collected, inferred, stored or processed by
this work; health-specific advice and emotion inference are out of scope.
VisionClaw already has retrieval and reporting, so importing a whole external
memory/orchestration system is not justified by a launch announcement.

## Discovery packet for the selected offer

Five questions before a paid pilot:

1. How many supplier invoices do you enter weekly, and in which system?
2. Which five header fields take time or cause corrections?
3. Can an authorized approver supply 20 representative scans and checked truth?
4. Must every processing step stay on your hardware? Who can approve retention?
5. If a supervised sample saves at least 30% of total handling time with no
   critical-field errors, would a $250 fixed pilot be worth discussing?

**Draft only — not sent:**
“I'm testing a small, human-reviewed way to reduce supplier-invoice entry for
HVAC offices. The first step is measuring 20 approved invoices against manual
entry, including correction time. Nothing posts to your accounting system.
Would that address a real time-consuming task in your office?”

The smallest buyer-evidence test is one explicitly approved discovery
conversation, not another autonomous feature. No prospect has been contacted.

## Implementation boundary and eight-question design check

1. **Cost:** evaluator = 0 model/API calls × any sample count; max 100 documents,
   max 1 MiB input, fixed five-field comparisons. No new runtime dependency.
2. **State:** pure computation; CLI reads one operator-selected local file and
   prints aggregate JSON. No local state, DB, queues, invoices or results persisted.
   Compiled source/offer definitions are code, not mutable production state.
3. **Failure:** malformed input/ambiguous IDs fail closed with no values in errors;
   missing predictions reduce accuracy. Model and delivery failures are outside
   this non-generating scorer.
4. **Idempotency:** deterministic score of the same bytes; no external side
   effects to duplicate. Future paid execution must use existing receipts.
5. **Tenant/limits:** existing owner/tenant-checked Launchpad routes unchanged.
   CLI is an operator action, not a new public endpoint or agent permission.
6. **Stop/observe:** no scheduler; do not run the CLI to stop. Aggregate score and
   blocker codes make failure visible. Remove the idea entry to withdraw it.
7. **Authority:** agents can propose; owner/customer approve data use and sales.
   CLI cannot approve an external send, invoice posting, payment or deployment.
8. **Delta evidence:** previously no deterministic invoice pilot scorer; now
   synthetic cases establish missing-record accounting, exact money matching
   and review-inclusive timing. They do not establish OCR quality, a working
   local model, real-customer consent or market demand.

## What remains genuinely unverified

Real scans, extractor compatibility, customer permissions, invoice accuracy,
elapsed time, buyer willingness to pay, actual unit costs and delivery acceptance.
No new model/API credential, dependency, table, agent tool, checkout SKU,
customer row, external message or production configuration change is required.
