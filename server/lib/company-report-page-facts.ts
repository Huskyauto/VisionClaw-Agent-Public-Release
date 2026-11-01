import { load } from "cheerio";
import { minimizeReportText } from "./business-report-evidence";
import { isReviewBearingPublicText } from "./report-customer-feedback";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
/** A review link in navigation must not discard independently bounded main
 * content. Never retain a review, infer satisfaction, or trust HTML that the
 * browser did not actually show. Unknown/unlabelled boundaries stay excluded. */
export function renderedCompanyFacts(snapshot: string, html: string, requireMain = false): string {
  const $ = load(html);
  const main = $('main,[role=main],article,[data-elementor-type="page"],[data-elementor-type="wp-page"]').first();
  // Cheerio .text() concatenates adjacent blocks ("Reviews" + "This…"),
  // hiding word boundaries. Keep separators when classifying a whole region.
  const regionText = (region: typeof main) => region.find("*").addBack().contents()
    .filter((_, node) => node.type === "text" && !$(node).parents("script,style").length)
    .map((_, node) => $(node).text()).get().join(" ");
  const marked = (node: Parameters<typeof $>[0]) => /review|testimonial|rating|feedback|comment|trustindex|ti-widget/i.test(
    ["id", "class", "itemprop", "itemtype", "aria-label", "data-testid"].map(key => $(node).attr(key) || "").join(" "));
  if (!main.length) {
    if (requireMain || isReviewBearingPublicText(snapshot) || $("*").toArray().some(marked) ||
        isReviewBearingPublicText(regionText($("body")))) return "";
    const text = minimizeReportText(snapshot);
    return text.length >= 100 ? text.slice(0, 12000) : "";
  }
  // Inspect attributes BEFORE deleting anything. A review label on a heading
  // class must exclude its sibling opinions too, not launder them into facts.
  const boundaries = new Set<Parameters<typeof $>[0]>();
  for (const node of main.find("*").addBack().toArray().filter(marked)) {
    const boundary = $(node).closest("section,[data-elementor-type]");
    if (!boundary.length || boundary[0] === main[0]) return "";
    boundaries.add(boundary[0]);
  }
  for (const boundary of boundaries) $(boundary).remove();
  // Page builders embed reusable templates inside pages. Exclude an entire
  // feedback-bearing subtemplate, not just its heading or individual keywords.
  main.find("section,[data-elementor-type]").each((_, node) => {
    if (isReviewBearingPublicText(regionText($(node)))) $(node).remove();
  });
  // Residual feedback labels mean the region could not be separated safely.
  if (isReviewBearingPublicText(regionText(main))) return "";
  // Only after ALL region classification and the residual check may unrelated
  // page chrome/quotations be deleted. Never erase a cue before evaluating it.
  main.find("nav,footer,header,aside,script,style,form,blockquote,q,iframe").remove();
  const rendered = normalize(snapshot), blocks = new Set<string>();
  main.find("h1,h2,h3,p,li").each((_, node) => {
    const text = normalize($(node).text());
    if (text.length >= 20 && rendered.includes(text)) blocks.add(text);
  });
  const result = minimizeReportText([...blocks].join("\n"));
  return result.length >= 100 ? result.slice(0, 12000) : "";
}
