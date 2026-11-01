import { hashReportBytes, matchesReportDigest } from "./business-report-evidence";
import { reportReplySchema } from "./business-report-reply-contract";
import { normalizeReportBlockLayout } from "./business-report-block-layout";
import { validateMuseReportReply, type BusinessReportReviewInput, type BusinessReportReviewState } from "./business-report-review";

/** Only an exactly retained, complete model response with a reproducible
 * deterministic content failure can earn this separate operator grant.
 * Valid output is reuse-only; uncertain network/checkpoint failures return null. */
export function inspectInvalidCompilerReply(input: BusinessReportReviewInput, state: BusinessReportReviewState, run: any) {
  const raw = run?.response;
  if (run?.status !== "response_received" || run.requestId !== state.requestId || run.digest !== state.digest ||
      raw?.httpStatus !== 200 || typeof raw.rawBody !== "string" || raw.rawBody.length > 2_000_000 ||
      hashReportBytes(raw.rawBody) !== raw.responseHash) return null;
  let candidate: any;
  try {
    const body = JSON.parse(raw.rawBody);
    if (!/^gemini-4-argon(?:-\d{3}|-\d{4}-\d{2}-\d{2})?$/.test(body.modelVersion) ||
        body.candidates?.length !== 1 || body.candidates[0].finishReason !== "STOP" ||
        !Number.isSafeInteger(body.usageMetadata?.promptTokenCount) || body.usageMetadata.promptTokenCount < 0 ||
        !Number.isSafeInteger(body.usageMetadata?.candidatesTokenCount) || body.usageMetadata.candidatesTokenCount <= 0 ||
        body.usageMetadata.thoughtsTokenCount !== undefined &&
          (!Number.isSafeInteger(body.usageMetadata.thoughtsTokenCount) || body.usageMetadata.thoughtsTokenCount < 0)) return null;
    const parts = body.candidates[0].content?.parts;
    if (!Array.isArray(parts) || parts.some((p: any) => typeof p.text !== "string" || p.thought)) return null;
    candidate = normalizeReportBlockLayout(JSON.parse(parts.map((p: any) => p.text).join(""))).candidate;
    if (candidate?.requestId !== state.requestId || !matchesReportDigest(candidate?.digest, state.digest)) return null;
  } catch { return null; }
  let diagnostics: Array<{ path: string; code: string }> = [];
  const parsed = reportReplySchema.safeParse(candidate);
  if (!parsed.success) diagnostics = parsed.error.issues.map(i => ({ path: i.path.join("."), code: i.code }));
  else {
    try { validateMuseReportReply(input, { ...state, phase: "compiling" }, parsed.data); return null; }
    catch (error: any) {
      if (Array.isArray(error.issues) && error.issues.length) diagnostics = error.issues.map((i: any) => ({ path: i.path, code: i.code }));
      else {
        const known: Record<string, string> = {
          "Unbound inline citation": "inline_citation_missing_from_sourceIds",
          "Factual quotation must occur verbatim in its exact retrieved source": "nonverbatim_factual_quote",
          "Unretrieved citation URL": "unretrieved_url",
        };
        if (!known[error?.message]) return null;
        diagnostics = [{ path: "report", code: known[error.message] }];
      }
    }
  }
  if (!diagnostics.length || diagnostics.length > 128 ||
      diagnostics.some(d => typeof d.path !== "string" || typeof d.code !== "string")) return null;
  return { responseHash: raw.responseHash as string, diagnostics,
    diagnosticHash: hashReportBytes(JSON.stringify(diagnostics)) };
}
