/**
 * Tools-layer-split S10 — quality-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const sculptorReviewDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "sculptor_review",
    description: "Review a completed sculptor session's work. An AI reviewer evaluates the output for quality, completeness, and correctness, providing a verdict (approve/revise/reject), score, strengths, issues, and suggestions.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "number", description: "The sculptor session ID to review (required)" },
        command: { type: "string", enum: ["review", "compare", "replay", "list"], description: "review: evaluate session work. compare: compare parallel sessions by group. replay: get full timeline. list: list sessions." },
        comparisonGroup: { type: "string", description: "Comparison group ID (required for compare command)" },
      },
      required: ["command"],
    },
  },
};

export const verifyFelixProposalSpecDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "verify_felix_proposal_spec",
    description: "Read-only sanity check: validates a Felix proposal's expected_post_state spec without executing anything. Tells you whether the proposal is safe to approve+execute (verifier registered, spec well-formed, columns whitelisted). Use this BEFORE approve_felix_proposal when you want to know how Felix is planning to verify its own work. Bob-only operation.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Felix proposal id" },
      },
      required: ["id"],
    },
  },
};

export const crossCritiqueDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "cross_critique",
    description: "Three-AI adversarial review panel (Donahoe Trident). Fires Claude/OpenAI/Gemini in parallel against the same target with different lenses (ux/technical/strategic), ranks counter-arguments by 'rebuttal survival score', and surfaces consensus findings (flagged by 2+ panelists). Use BEFORE shipping anything important: a code change, a strategic decision, a customer-facing email, a YouTube script. Returns top-3 findings + consensus list. Persisted for audit.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "The thing to critique — paste the code diff, the plan, the script, or describe the decision in 50-2000 chars." },
        context: { type: "string", description: "Optional extra context (constraints, audience, prior decisions)." },
        panelists: { type: "array", items: { type: "string", enum: ["claude", "openai", "gemini"] }, description: "Optional: subset of the panel. Default: all three." },
      },
      required: ["target"],
    },
  },
};

export const listCritiquesDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_critiques",
    description: "Use BEFORE re-running cross_critique on the same target (don't pay twice for the same review), when Bob asks \"what did the panel say about X\", or when reviewing brand-voice/code-change history. Returns recent cross-critique runs with top finding and consensus count for each.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows (default 10, max 50)." },
      },
    },
  },
};

export const critiqueResponseDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "critique_response",
    description: "Request a quality critique of content before sending it. A specialized Critique Agent evaluates accuracy, completeness, relevance, and clarity on a 1-10 scale and provides improvement suggestions. Use this for important deliverables — reports, analyses, recommendations — before presenting to the user.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The content to critique (draft response, report, analysis, etc.)" },
        context: { type: "string", description: "Context about what this content is for (e.g., 'financial analysis for Q4 report')" },
      },
      required: ["content", "context"],
    },
  },
};

export const qualityBaselineSaveDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "quality_baseline_save",
    description: "R98.7 — Take a structural snapshot of the codebase and save it under a label. Inspired by sentrux's structural-signal sensor. CALL THIS at the START of any multi-file coding task (label='before-<task-name>'). Computes file count, total LOC, god-files (>1000 LOC), top fan-in/fan-out, optional cycles, and a single 0-10000 health score. Sub-2-second pure-TS scan, no external deps. Pair with `quality_baseline_check` afterwards to detect regressions before declaring the task done.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short label for the baseline, e.g. 'before-felix-loop-refactor' or 'r98.6-shipped'. Letters/digits/_/-/. only; max 64 chars." },
        include_cycles: { type: "boolean", description: "Run `madge --circular` for cycle detection. Default false (madge is optional)." },
      },
      required: ["label"],
    },
  },
};

export const qualityBaselineCheckDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "quality_baseline_check",
    description: "R98.7 — Re-scan the codebase and compare to a previously-saved baseline. CALL THIS before declaring any multi-file coding task done. Returns score delta, new god files, god files that grew >50 LOC, file/LOC deltas, and a `regressed` boolean (true if score dropped >100 OR a new god file appeared). If regressed=true, you MUST address the regression OR explicitly tell Bob why you're shipping anyway. Pair with `record_failure_pattern` if the regression caught a mistake you should remember.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label of the baseline you saved with quality_baseline_save." },
        include_cycles: { type: "boolean", description: "Run `madge --circular` for cycle detection. Default false." },
        action: { type: "string", enum: ["compare", "list", "delete"], description: "compare = default behavior; list = show all saved baselines; delete = remove this label." },
      },
      required: [],
    },
  },
};

export const verifyDeliverableDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "verify_deliverable",
    description: "R76 — Verify a customer-facing artifact against its deliverable contract before claiming success. Returns passed/failed with concrete failure reasons (extension mismatch, MIME mismatch, render-check failure, size out of bounds). MUST be called by personas before claiming an HTML page, PDF, slide deck, video, audio, image, csv, or json is delivered.",
    parameters: {
      type: "object",
      properties: {
        deliverable_type: { type: "string", description: "One of: html_page, pdf_document, slide_deck, image, video, audio, csv_data, json_data." },
        file_path: { type: "string", description: "Local file path. Provide either this or file_url." },
        file_url: { type: "string", description: "Public file URL (e.g. Drive viewUrl). Provide either this or file_path." },
      },
      required: ["deliverable_type"],
    },
  },
};

export const verifyMathChainDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "verify_math_chain",
    description: "R77.5 (KisMATH-style Causal CoT graph for arithmetic) — re-executes a sequence of named arithmetic steps (revenue/cost/profit-style) deterministically and reports per-step pass/fail, claimed vs computed value mismatches, unit mismatches on +/-, the final value, optional finalMatch against an expected answer, and which steps are load-bearing vs decorative. Use whenever a persona (Cassandra finance, Atlas analysis, Felix planning) emits an arithmetic chain it wants the supervisor to vouch for. NO LLM calls — pure arithmetic, sub-second.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered list of arithmetic steps. Each step is { id, expression, claimed_value?, unit? } where expression uses only + - * / % ** parens and identifiers declared in earlier steps or in `bindings`.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique identifier for this step (later steps may reference this)." },
              expression: { type: "string", description: "Arithmetic expression. Identifiers must be declared in `bindings` or as the id of an earlier step." },
              claimed_value: { type: "number", description: "Optional — the value the LLM claimed this step equals. If provided, will be checked against the recomputed value." },
              unit: { type: "string", description: "Optional unit string (e.g. 'USD', 'kg'). Mismatched units on +/- emit a warning." },
            },
            required: ["id", "expression"],
          },
        },
        bindings: { type: "object", description: "Initial named numeric values, e.g. { revenue: 1000, cost: 300 }." },
        expected_final: { type: "number", description: "Optional expected value of the last step. Will be reported in `finalMatch`." },
        tolerance: { type: "number", description: "Relative tolerance for floating-point comparisons (default 1e-6)." },
      },
      required: ["steps"],
    },
  },
};

export const gradeDeliverableDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "grade_deliverable",
    description: "R98.13 W3 — VISION/AUDIO QUALITY GRADER. Per-format rubric scoring (0-100) with detailed issues + critique for auto-revise. Video: ffprobe + black-detect + AV-drift + meta-narration scan. Audio: ffprobe + LUFS + end-cut detection. PDF: header + EOF + page count + font embedding. Slides: structural check + optional vision LLM on rendered thumbnails (pass `expected_spec.thumbnail_paths`). HTML app: full jsdom re-run + console-error count + per-app smoke_assertion. Image: magic bytes + size sanity. Returns {ok (score≥85 default), score, passingBar, issues:[{severity,message}], critique, metrics:{...}}. Use AFTER verify_deliverable + BEFORE verify_delivery_proof — if score<85, feed `critique` into a BOUNDED auto-revise loop: revise + re-grade passing `attempt` (incremented each pass) and `prev_scores` (all prior scores). The loop keeps going ONLY while the grader score strictly improves, up to `max_attempts` (default 3); on a plateau/regression or at the cap it escalates to Bob via owner-notification (per W3 spec). Stricter than verify_deliverable's binary pass/fail.",
    parameters: {
      type: "object",
      properties: {
        deliverable_type: { type: "string", description: "video | audio | pdf | slides | html_app | image (also accepts mp4/mp3/pdf_document/slide_deck/html_page synonyms)." },
        file_path: { type: "string", description: "Local file path on disk (must be under ALLOWED_FILE_ROOTS — same path-jail as verify_deliverable)." },
        file_url: { type: "string", description: "Optional public URL. The grader is file-path-only for now (most checks need bytes); URL is recorded but not graded." },
        expected_spec: {
          type: "object",
          description: "Optional expectations the grader uses to do deeper checks.",
          properties: {
            slide_count: { type: "number", description: "Slides only — expected number of slides." },
            requires_photo_on: { type: "array", items: { type: "number" }, description: "Slides only — 1-indexed slide numbers that MUST have a photo (R98.6)." },
            thumbnail_paths: { type: "array", items: { type: "string" }, description: "Slides only — LOCAL file paths (under allowed roots) of rendered slide thumbnails for the vision LLM, or data:image/* URIs. Remote URLs (http/https/ftp/file) REJECTED for SSRF safety. Cap 12. Each ≤8MB; png/jpg/webp only." },
            min_pages: { type: "number", description: "PDF only — minimum page count." },
            max_pages: { type: "number", description: "PDF only — maximum page count." },
            transcript: { type: "string", description: "Video/audio — expected narration script for meta-narration / coverage checks." },
            smoke_assertion: { type: "string", description: "DEPRECATED in grader (R98.13+sec) — smoke_assertion is evaluated at producer time only (build_html_app), not re-evaluated here. Field accepted for backward-compat but ignored. Pass it to build_html_app instead." },
            expected_duration_sec: { type: "number", description: "Video/audio — expected duration; drift >5% (video) or >10% (audio) flagged." },
            brand_colors: { type: "array", items: { type: "string" }, description: "Optional brand hex codes to look for." },
          },
        },
        acceptance_notes: { type: "string", description: "For CUSTOM / dynamically-composed deliverables (no per-format rubric): the acceptance criteria from plan_deliverable's pipeline.acceptance_notes. When supplied for a non-rubric type, an INDEPENDENT completion judge (structurally distinct from the worker) checks the result against these criteria and THAT verdict — not a trivial pass — decides `ok`." },
        request: { type: "string", description: "Optional — the original user request/objective; used with acceptance_notes to build the goal contract for the independent completion gate on custom deliverables." },
        model: { type: "string", description: "Optional vision model override for slides. Default 'gemini-2.5-flash'." },
        attempt: { type: "number", description: "Bounded auto-revise loop — 1-based revise-attempt counter for THIS grade. Omit (or 1) on the first grade; on each re-grade after a revise, pass the value the previous next_step told you to use. Default 1." },
        max_attempts: { type: "number", description: "Bounded auto-revise loop — max revise attempts before escalating to owner-notification (the K cap; TRM-style bounded refinement). Default 3, hard-capped at 5." },
        content_excerpt: { type: "string", description: "R125+137.81 GOLD EXEMPLAR CAPTURE — the production TEXT behind this deliverable (narration script, PDF/doc outline+copy, slide contents, html_app description). ALWAYS pass this when grading: if the grade passes with a top score (≥90) the text is stored as a gold exemplar and future productions of this format get it injected as a few-shot example. Text only, ~6000 chars kept." },
        prev_scores: { type: "array", items: { type: "number" }, description: "Bounded auto-revise loop — scores from PRIOR attempts, oldest→newest (the carried critique-history scratchpad). Lets the loop detect improvement vs plateau: it keeps revising only while the score strictly improves, stops early on a plateau/regression (self-refinement without external signal degrades), and escalates at the attempt cap." },
      },
      required: ["deliverable_type"],
    },
  },
};

export const verifyDeliveryProofDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "verify_delivery_proof",
    description: "R98.12 W2 — REFUSE-TO-DECLARE-DONE GATE. Felix MUST call this before saying a deliverable is done. Confirms three independent proofs of delivery exist: (1) artifact passes deliverable-contract verification (extension/MIME/render/size), (2) a customer-reachable URL is provided AND points to one of the trusted hosts (drive.google.com / docs.google.com / our own /uploads/ or /v/ stream), (3) optionally a project_files row exists for the artifact. Returns {ok, proofs:{artifact,url,projectFile}, missing:[...], summary}. The chat-engine quality gate fails OPEN if a deliverable tool ran this turn and verify_delivery_proof was NOT called — Felix is required to invoke it explicitly.",
    parameters: {
      type: "object",
      properties: {
        deliverable_type: { type: "string", description: "One of: html_page, pdf_document, slide_deck, image, video, audio, csv_data, json_data." },
        file_path: { type: "string", description: "Local file path on disk. Provide either this or file_url (or both)." },
        file_url: { type: "string", description: "Public URL the customer can open. Required for the URL proof — must point to drive.google.com, docs.google.com, our /uploads/, or our /v/ stream." },
        project_id: { type: "number", description: "Optional. If provided, also asserts a project_files row exists with this projectId+fileName." },
        file_name: { type: "string", description: "Optional. Filename to look up in project_files when project_id is set." },
        require_project_file: { type: "boolean", description: "If true, missing project_files row is a FAIL not just an info. Default false." },
      },
      required: ["deliverable_type"],
    },
  },
};

export const verifyWithCoveDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "verify_with_cove",
    description: "R123 — Chain-of-Verification (Dhuliawala et al., Meta FAIR, arXiv:2309.11495). Takes a DRAFT longform answer you (or another persona) just generated and runs a 4-step factuality pass: (1) extract atomic factual claims from the draft, (2) rewrite each as a standalone verification question, (3) answer each question INDEPENDENTLY in a fresh context with NO draft visible (the trick — model can't repeat its own bias if it can't see what it wrote), (4) revise the draft using only verified facts, softening UNCERTAIN claims and replacing contradictions. Use this BEFORE shipping a longform research paragraph, briefing summary, or any narrative where hallucinated names/dates/numbers would embarrass you. Cheaper than ensemble_query (single model, ~maxQuestions+2 short calls) — good for narrative correctness, not for high-stakes decisions. Returns the revised text + list of contradictions caught + Q/A telemetry. NEVER throws — on internal failure returns the original draft with a `warning` field.",
    parameters: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The longform draft to fact-check. Required. Max 16000 chars (will be truncated). Drafts under 80 chars are returned unchanged." },
        topic: { type: "string", description: "Optional: the topic/subject the draft is about. Helps the planner disambiguate but is NOT shown to step-3 answerers as a source." },
        maxQuestions: { type: "number", minimum: 1, maximum: 15, description: "Max verification questions to ask (default 8). Higher = more thorough + more cost." },
        modelTier: { type: "string", enum: ["fast", "balanced", "powerful"], description: "Model tier for all 4 steps. Default 'balanced'." },
        grade: { type: "boolean", description: "Opt-in (default false). When true, instead of revising the draft, returns a `verdictReport`: each claim graded on a 5-level taxonomy (VERIFIED / MINOR_DISTORTION / MAJOR_DISTORTION / UNVERIFIABLE / UNVERIFIABLE_ACCESS) plus a PASS / PASS_WITH_NOTES / FAIL gate. Default off = identical classic-CoVe behavior and zero extra cost." },
        gradeMode: { type: "string", enum: ["draft", "final"], description: "Only used when grade:true. 'final' (default) grades every claim; 'draft' grades a cost-aware sample (≥5 claims or 30%, whichever larger). Ignored unless grade is true." },
      },
      required: ["draft"],
    },
  },
};

export const qualityDomainDefinitions: ToolDefinition[] = [
  sculptorReviewDefinition,
  verifyFelixProposalSpecDefinition,
  crossCritiqueDefinition,
  listCritiquesDefinition,
  critiqueResponseDefinition,
  qualityBaselineSaveDefinition,
  qualityBaselineCheckDefinition,
  verifyDeliverableDefinition,
  verifyMathChainDefinition,
  gradeDeliverableDefinition,
  verifyDeliveryProofDefinition,
  verifyWithCoveDefinition,
];
