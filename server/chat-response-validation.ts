interface IncompleteOutcomeResult {
  reason: string;
  originalLength: number;
}

interface IncompleteOutcomeContext {
  attachmentCount?: number;
  currentAttachmentCount?: number;
}

export function isAttachmentReviewRequest(
  userMessage: string,
  context: IncompleteOutcomeContext = {},
): boolean {
  const attachmentCount = Number.isInteger(context.attachmentCount) && Number(context.attachmentCount) > 0
    ? Number(context.attachmentCount)
    : 0;
  const currentAttachmentCount = Number.isInteger(context.currentAttachmentCount) && Number(context.currentAttachmentCount) >= 0
    ? Number(context.currentAttachmentCount)
    : attachmentCount;
  const explicitlyReferencesUploads = /\b(attach(?:ed|ment|ments)?|upload(?:ed|s)?)\b/i.test(userMessage);
  const referencesFiles = /\b(files?|documents?|articles?|pdfs?|spreadsheets?|presentations?|decks?|images?)\b/i.test(userMessage);
  return attachmentCount > 0
    && (explicitlyReferencesUploads || (currentAttachmentCount > 0 && referencesFiles))
    && /\b(review|read|analy[sz]e|assess|evaluate|inspect|examine|summari[sz]e|report|opinion|critique|compare|explain|identify|extract|describe|go through|tell me)\b/i.test(userMessage);
}

export function detectIncompleteOutcome(
  userMessage: string,
  response: string,
  toolsUsed: { name: string; input: any; output: any }[],
  context: IncompleteOutcomeContext = {},
): IncompleteOutcomeResult | null {
  const responseLen = response.length;

  const attachmentCount = Number.isInteger(context.attachmentCount) && Number(context.attachmentCount) > 0
    ? Number(context.attachmentCount)
    : 0;
  const currentAttachmentCount = Number.isInteger(context.currentAttachmentCount) && Number(context.currentAttachmentCount) >= 0
    ? Number(context.currentAttachmentCount)
    : attachmentCount;
  const requestedAttachmentReview = isAttachmentReviewRequest(userMessage, context);
  const attachmentDeferralPatterns = [
    /\b(?:I(?:'|’)ll|I will|I (?:still )?need to|I(?:'m| am) (?:going to|starting to|about to))[^.!?\n]{0,50}\b(?:review|read|open|check|inspect|examine|analy[sz](?:e|ing)|go through|look through)\b/i,
    /\bI(?:'m| am)\s+(?:reviewing|reading|opening|checking|inspecting|examining|analy[sz]ing|going through|looking through)\b/i,
    /\bLet me[^.!?\n]{0,40}\b(?:review|read|open|check|inspect|examine|analy[sz](?:e|ing)|go through|look through)\b/i,
  ];
  const lastDeferralMatch = attachmentDeferralPatterns
    .flatMap((pattern) => [
      ...response.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)),
    ])
    .sort((a, b) => (b.index ?? -1) - (a.index ?? -1))[0];
  let contentAfterLastDeferral = "";
  if (lastDeferralMatch) {
    const suffix = response.slice((lastDeferralMatch.index ?? 0) + lastDeferralMatch[0].length);
    const boundary = suffix.match(/[.!?;:](?:\s+|$)|\n{2,}/);
    if (boundary?.index !== undefined) {
      contentAfterLastDeferral = suffix.slice(boundary.index + boundary[0].length).trim();
    }
  }
  if (
    requestedAttachmentReview
    && toolsUsed.length === 0
    && lastDeferralMatch
    && contentAfterLastDeferral.length < 120
  ) {
    return {
      reason: `Promised to read or review ${attachmentCount} attached files instead of delivering the requested analysis`,
      originalLength: responseLen,
    };
  }

  // Empty (or near-empty) reply after ANY tool use is ALWAYS incomplete — the
  // user sees tool-activity chrome ("Used N tools") with no written answer and
  // has to re-ask. Checked BEFORE the orchestrate/delegate/research gate below,
  // which would otherwise return null for plain diagnostic/status tool turns
  // (the exact "runs tools then skips the answer" bug).
  if (toolsUsed.length >= 1 && responseLen < 10) {
    return { reason: `Used ${toolsUsed.length} tool(s) but produced no written response (${responseLen} chars) — the user would see tool activity with no answer`, originalLength: responseLen };
  }

  const usedOrchestrate = toolsUsed.some(t => t.name === "orchestrate");
  const usedDelegate = toolsUsed.some(t => t.name === "delegate_task");
  const usedResearch = toolsUsed.some(t =>
    ["trend_research", "firecrawl_scrape", "firecrawl_crawl", "web_search", "competitor_briefing", "search_memory"].includes(t.name)
  );

  if (!usedOrchestrate && !usedDelegate && !usedResearch) return null;

  const incompletePatterns = [
    /I('ll| will) (work on|look into|get (started|back)|begin|proceed|prepare|start)/i,
    /Let me (know|work on|start|begin|look into|prepare)/i,
    /I('m| am) (working on|starting|beginning|preparing|looking into)/i,
    /stay tuned|check back|I'll have (it|this|the)/i,
    /once (I|it|the|this) (have|is|complete|finish)/i,
    /in progress|under way|getting started/i,
  ];

  const isPromise = incompletePatterns.some(p => p.test(response));
  if (isPromise) {
    return { reason: "Response contains promises to do work later instead of delivering results now", originalLength: responseLen };
  }

  if (usedOrchestrate) {
    const orchestrateResult = toolsUsed.find(t => t.name === "orchestrate")?.output;
    const orchestrateHasContent = orchestrateResult && (
      orchestrateResult.summary?.length > 500 ||
      orchestrateResult.steps?.some((s: any) => s.result?.length > 100)
    );

    if (orchestrateHasContent && responseLen < 300) {
      return { reason: "Orchestration produced substantial content but response is too short — deliverable content not presented to user", originalLength: responseLen };
    }

    const statusReportPattern = /orchestration (completed|finished|done)|steps? (completed|succeeded|finished)|execution complete/i;
    if (statusReportPattern.test(response) && responseLen < 800 && orchestrateHasContent) {
      return { reason: "Response is a status report about orchestration instead of presenting the actual deliverable content", originalLength: responseLen };
    }
  }

  const actionVerbs = /\b(report|analysis|analyze|research|write|create|build|draft|prepare|compile|generate|investigate|review|audit|assess|evaluate)\b/i;
  if (actionVerbs.test(userMessage) && responseLen < 200 && toolsUsed.length > 0) {
    return { reason: "User requested a substantial deliverable but response is too brief given tools were used", originalLength: responseLen };
  }

  const usedWebResearch = toolsUsed.some(t =>
    ["web_search", "web_fetch", "browser", "deep_research", "stealth_browse", "vision_browse"].includes(t.name)
  );
  const didCreateDeliverable = toolsUsed.some(t =>
    ["create_pdf", "create_styled_report", "create_document", "create_slides", "create_spreadsheet"].includes(t.name)
  );
  const deliverableRequest = /\b(business analysis|financial (summary|report|analysis)|market (analysis|research|report)|competitive (analysis|report)|executive (summary|brief)|due diligence|company (report|analysis|profile|brief))\b/i;
  if (deliverableRequest.test(userMessage) && usedWebResearch && !didCreateDeliverable && !usedOrchestrate && !usedDelegate && responseLen < 1500) {
    return { reason: "User requested a formal deliverable (report/analysis/summary), research was done, but no document was created — response is likely a status update instead of the actual deliverable", originalLength: responseLen };
  }

  if (toolsUsed.length >= 5 && responseLen < 100) {
    return { reason: `Used ${toolsUsed.length} tools but response is under 100 chars — likely empty or trivial response after substantial work`, originalLength: responseLen };
  }

  return null;
}