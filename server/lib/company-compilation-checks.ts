/** Only fixed validator reasons may reach package status or operational logs. */
const CHECKS = new Map<string, { check: string; label: string }>([
  ["Factual quotation must occur verbatim in its exact retrieved source",
    { check: "SOURCE_EXCERPT_MISMATCH", label: "A factual excerpt does not match its cited saved source." }],
  ["Author compilation exceeds its synthesis input allowance",
    { check: "AUTHOR_SIZE_LIMIT", label: "The author response exceeds its synthesis input allowance." }],
  ["Unretrieved citation URL",
    { check: "UNKNOWN_CITATION_URL", label: "A referenced website address is not in the saved research." }],
  ["Invalid block or unknown citation",
    { check: "INVALID_BLOCK_OR_CITATION", label: "A content block or its source citation is invalid." }],
  ["Invalid report section order or blocks",
    { check: "INVALID_SECTION_STRUCTURE", label: "The required section order or block limits were not met." }],
  ["Invalid complete report section/unknowns contract",
    { check: "INVALID_REPORT_STRUCTURE", label: "The complete report sections or unresolved questions are missing or invalid." }],
  ["Unbound inline citation",
    { check: "UNBOUND_INLINE_CITATION", label: "An inline citation is not bound to that content block." }],
  ["Compiled report section is too short",
    { check: "SECTION_TOO_SHORT", label: "A required report section does not contain enough content." }],
  ["Full substantive compilation required",
    { check: "INSUFFICIENT_REPORT_CONTENT", label: "The response does not contain the required complete report." }],
  ["Retained compilation has invalid JSON structure",
    { check: "INVALID_JSON_STRUCTURE", label: "The saved response has invalid JSON structure." }],
  ["Synthesis exceeds its pre-admitted full narration allowance",
    { check: "NARRATION_SIZE_LIMIT", label: "The synthesis exceeds its full narration allowance." }],
  ["Synthesis exceeds its JSON output allowance",
    { check: "SYNTHESIS_SIZE_LIMIT", label: "The synthesis exceeds its JSON output allowance." }],
]);

export function compilationValidationFailure(error: unknown):
  { check: string; label: string } | undefined {
  return error instanceof Error ? CHECKS.get(error.message) : undefined;
}

/** Status describes durable receipts, not whether the last poll saw a claim. */
export function compilationCorrectionStopReason(slots: {
  phase: string; correction?: { phase: string };
}[]): string {
  return slots.some(slot => slot.phase !== "complete" && slot.correction?.phase === "claimed")
    ? "The corrective call's outcome is uncertain and requires reconciliation."
    : "The corrective response was received and saved but did not pass acceptance checks.";
}
