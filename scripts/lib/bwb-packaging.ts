import { createHash } from "node:crypto";

export const BWB_PACKAGING_INSTRUCTIONS = `VIDEO PACKAGING REVIEW — use the existing script-writing call, not another model:
Identify the viewer and strongest honest promise. Generate exactly THREE distinct title/thumbnail
pairs (different curiosity, benefit or contrast angles). Each title is <=60 characters.
For each pair give a thumbnailPrompt (visual/composition/emotion, no text/logos), optional
thumbnailText (empty or 2-4 words; concept only, current renderer does not overlay it), angle,
and evidence: [{scene: ONE_BASED_FINAL_SCENE_NUMBER, quote: "verbatim words from that scene narration"}].
Choose selected: 0, 1 or 2 and explain selectionReason. Set the top-level title and
thumbnailPrompt EXACTLY to the selected pair. Quotes must refer to the final spoken script,
not a source clip that was omitted. Never invent outcomes, numbers, reactions or screenshots.
Title and thumbnail should complement, not repeat, each other. Include packagingReview:
{audience, promise, selected, selectionReason, candidates:[{title, thumbnailPrompt, thumbnailText,
angle, evidence:[{scene,quote}]}]} alongside the existing JSON fields.
This is an editorial hypothesis, not approval or a proven CTR winner. Literal quote matches
establish traceability only, not factual accuracy or visual truth. Keep uncertainty explicit.
After release evaluate clicks together with watch time and early retention; no invented analytics.`;

interface Candidate {
  title: string;
  thumbnailPrompt: string;
  thumbnailText: string;
  angle: string;
  evidence: Array<{ scene: number; quote: string }>;
}

const normalized = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length <= max ? v.trim() : "";

/** Advisory, local and bounded. Never changes the chosen title, triggers a retry,
 * grants publication, or claims semantic verification from literal string matches. */
export function reviewBwbPackaging(input: unknown) {
  const issues: string[] = [];
  const candidates: Candidate[] = [];
  const script = record(input) ? input : {};
  const review = record(script.packagingReview) ? script.packagingReview : {};
  const scenes = Array.isArray(script.scenes) && script.scenes.length <= 500 ? script.scenes : [];
  const audience = text(review.audience, 300);
  const promise = text(review.promise, 500);
  const selectionReason = text(review.selectionReason, 600);
  if (!audience || !promise || !selectionReason) issues.push("Missing bounded audience, promise or selection reason.");
  if (!Array.isArray(review.candidates) || review.candidates.length !== 3) {
    issues.push("Exactly three title/thumbnail candidates are required.");
  } else {
    for (const [i, raw] of review.candidates.entries()) {
      if (!record(raw)) { issues.push(`Candidate ${i + 1} is malformed.`); continue; }
      const title = text(raw.title, 60);
      const thumbnailPrompt = text(raw.thumbnailPrompt, 1600);
      const thumbnailText = raw.thumbnailText === "" || raw.thumbnailText === undefined ? "" : text(raw.thumbnailText, 80);
      const angle = text(raw.angle, 400);
      const titleWords = new Set(normalized(title).match(/[\p{L}\p{N}]+/gu) || []);
      const thumbnailWords = normalized(thumbnailText).match(/[\p{L}\p{N}]+/gu) || [];
      if (!title || !thumbnailPrompt || !angle) issues.push(`Candidate ${i + 1} lacks bounded title, visual or angle.`);
      if (raw.thumbnailText !== undefined && raw.thumbnailText !== "" && !thumbnailText) issues.push(`Candidate ${i + 1} thumbnail text is invalid.`);
      if (thumbnailText && (thumbnailText.split(/\s+/).length < 2 || thumbnailText.split(/\s+/).length > 4 ||
          thumbnailWords.every(word => titleWords.has(word)))) issues.push(`Candidate ${i + 1} thumbnail text must be 2-4 words and not repeat title copy.`);
      const evidence: Candidate["evidence"] = [];
      if (!Array.isArray(raw.evidence) || raw.evidence.length < 1 || raw.evidence.length > 3) {
        issues.push(`Candidate ${i + 1} needs 1-3 narration references.`);
      } else {
        for (const ref of raw.evidence) {
          if (!record(ref)) { issues.push(`Candidate ${i + 1} has malformed evidence.`); continue; }
          const quote = text(ref.quote, 600);
          const index = typeof ref.scene === "number" && Number.isSafeInteger(ref.scene) ? ref.scene - 1 : -1;
          const scene = index >= 0 ? scenes[index] : null;
          const narration = record(scene) ? text(scene.narration, 20_000) : "";
          if (quote.length < 15 || !narration || !normalized(narration).includes(normalized(quote))) {
            issues.push(`Candidate ${i + 1} has missing or nonmatching narration evidence.`);
          } else evidence.push({ scene: index + 1, quote });
        }
      }
      const claimedNumbers = title.match(/\d+(?:[.,]\d+)*/g) || [];
      const quotedNumbers = new Set(evidence.flatMap(ref => ref.quote.match(/\d+(?:[.,]\d+)*/g) || []));
      if (claimedNumbers.some(n => !quotedNumbers.has(n))) issues.push(`Candidate ${i + 1} title numbers are not present in its cited narration.`);
      candidates.push({ title, thumbnailPrompt, thumbnailText, angle, evidence });
    }
  }
  if (candidates.length === 3 && new Set(candidates.map(c => normalized(c.title))).size !== 3) issues.push("Candidate titles must be distinct.");
  const selected = typeof review.selected === "number" && Number.isInteger(review.selected) && review.selected >= 0 && review.selected < 3
    ? review.selected : null;
  const chosen = selected !== null ? candidates[selected] : null;
  if (!chosen || chosen.title !== script.title || chosen.thumbnailPrompt !== script.thumbnailPrompt) {
    issues.push("Selected pair does not match the final script title and thumbnail prompt.");
  }
  const status = issues.length ? "needs_review" as const : "traceable" as const;
  const subjectHash = createHash("sha256").update(JSON.stringify({
    title: text(script.title, 60), thumbnailPrompt: text(script.thumbnailPrompt, 1600),
    narration: scenes.map(s => record(s) ? text(s.narration, 20_000) : ""),
  })).digest("hex");
  const summary = `Packaging: ${status === "traceable" ? "3 pairs linked to final narration" : "needs editorial review"}. ` +
    (status === "traceable" ? `Selected: ${chosen!.title}. Reason: ${selectionReason} ` : issues.slice(0, 3).join(" ") + " ") +
    "Quote matching is not semantic verification, visual proof or audience validation. This is not approval. Thumbnail text is a concept only. CTR, watch time and retention are untested.";
  return {
    version: 1, status, subjectHash, audience, promise, selected,
    selectionReason, candidates, issues: issues.slice(0, 8),
    semanticVerification: "not_established" as const, audiencePerformance: "untested" as const,
    summary,
  };
}
