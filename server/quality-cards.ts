// R98.14 — "What good looks like" knowledge cards. The Replit-Agent-style
// instinct ("you know good code when you see it") delivered as explicit,
// per-format quality criteria baked directly into Felix's persona prompt.
//
// These cards are not aspirational poetry. They are concrete, checkable rules
// drawn from how professional creators actually grade their own work — the
// kind of standards a senior video editor / podcast producer / report writer /
// designer would tell you off the top of their head. Felix references them
// when planning a deliverable AND when grading one.
//
// Tied into:
//   - server/seed-persona-prompts.ts (Felix R98.14 section appends these)
//   - server/deliverable-grader.ts (grader rubrics enforce a subset)
//   - server/reference-learner.ts (reference patterns extend, never override, these defaults)

export const QUALITY_CARDS: Record<string, string[]> = {
  video: [
    "HOOK FIRST 3 SECONDS — visual surprise, bold statement, or specific question. Never start with logo card or 'hi everyone'.",
    "ONE SUBJECT PER SCENE — cuts every 4-7 seconds. Static shots over 8s lose the viewer.",
    "NARRATION BREATHES — 1-2 second pauses between thoughts. Never wall-of-words. Read your script aloud; if you're out of breath, cut it.",
    "MUSIC DUCKS UNDER VOICE by 12-18 dB. Voice is always the foreground; music is texture.",
    "NO FILLER WORDS — strip every 'um', 'uh', 'like', 'you know'. Every line earns its place.",
    "CAPTIONS ON ALL SPOKEN CONTENT — accessibility AND silent autoplay reach. Burn them in or use SRT.",
    "ASPECT RATIO MATCHES PLATFORM — 9:16 short-form, 16:9 landscape, 1:1 feed. Never mix in one delivery.",
    "BRAND COLORS USED 2-3 TIMES MAX — over-branding kills trust. Logo at start, watermark corner, end card. Done.",
    "END WITH ONE CLEAR NEXT STEP — visit URL, reply, subscribe, book a call. Never two CTAs.",
    "AUDIO LUFS -16 to -14 (YouTube/Spotify range), no clipping (peak ≤ -1 dBFS).",
  ],
  audio: [
    "WARM INTRO — 3-5s of music + identity. Never cold-open with silence; never start mid-sentence.",
    "LOUDNESS NORMALIZED to -16 LUFS (podcast standard) or -14 LUFS (Spotify-style).",
    "PEAK CEILING -1 dBFS — never clip. Use a limiter on the master, not just the voice channel.",
    "FADE IN 0.5s, FADE OUT 1-2s — abrupt cuts feel amateur.",
    "SEGMENT MARKERS for content >3 minutes — chapter breaks, music stings, or production drops.",
    "ID3 TAGS SET — title, artist, album. Players that hide tagless files exist.",
    "MONO FOR VOICE-ONLY, STEREO FOR MUSIC OR DIALOGUE — no fake stereo width on a single mic.",
    "TAIL CHECK — last 1.5s must be intentional silence or fade, NEVER cut narration mid-word.",
    "TRANSCRIPT MATCHES SCRIPT ≥ 95% — if TTS dropped or mispronounced, retry that chunk.",
  ],
  pdf: [
    "COVER PAGE — title + ONE hero stat or visual. Not a wall of bullet points.",
    "EXECUTIVE SUMMARY ON PAGE 2 — single page, scannable in 30 seconds. The reader who reads only this should still know the answer.",
    "BODY: H2 SECTIONS — each follows intro / evidence / takeaway. Never just data dump.",
    "CHARTS CAPTIONED WITH THE TAKEAWAY — 'revenue grew 40% YoY' not 'figure 1: revenue chart'.",
    "PAGE NUMBERS + SOURCE CITATIONS in footer. Every claim has a source.",
    "BRAND COLOR IN HEADLINES ONLY — body text always near-black on near-white for readability.",
    "EMBEDDED FONTS — pdf renders identically on every device. No 'best viewed in Acrobat' nonsense.",
    "WHITE SPACE — margins ≥ 1 inch (or equivalent). Cramped pages signal cramped thinking.",
    "TABLES: bold header row, alternating row tint, right-align numbers, left-align text.",
    "LINKS LIVE — every URL clickable. Never paste raw URLs in body text.",
  ],
  slides: [
    "ONE IDEA PER SLIDE — if you need two, that's two slides. Period.",
    "IMAGE-LED, NOT TEXT-WALL — max 6 lines or 36 words per slide. The eye reads 1 idea, not 5.",
    "FONT SIZES — headlines 36pt+, body 24pt+, NEVER below 18pt. People in row 12 still need to read.",
    "BRAND COLOR IN 2-3 ELEMENTS PER SLIDE max — headline + accent line + maybe icon. Not every word.",
    "SPEAKER NOTES HOLD THE EXPLANATION — the slide just anchors the idea. If the slide can stand alone, your talk is redundant.",
    "TRANSITIONS UNIFORM — fade or none, never mix. Power-Point-spinning-cube is brand suicide.",
    "EVERY DATA SLIDE has a takeaway headline ('Sales up 40% in Q3') NOT a description ('Q3 Sales Data').",
    "PHOTO ON HUMAN/PERSONAL SLIDES — when narration uses 'I', 'my', 'we', the slide must show a real face. (R98.6 contract.)",
    "LAST SLIDE IS A SINGLE CTA — book the call, visit the URL, email the address. Not 'Thank you'.",
    "16:9 FOR PRESENTATIONS, 4:3 ONLY for legacy projector requirement.",
  ],
  html_app: [
    "LOADS IN <1s on 3G — single file, inline CSS+JS, no external CDN.",
    "SINGLE PRIMARY ACTION ABOVE THE FOLD — the thing the user came to do, button or input, no scrolling required.",
    "KEYBOARD ACCESSIBLE — Tab through controls in logical order, Enter activates the primary action.",
    "WORKS OFFLINE once loaded — no analytics, no third-party scripts, no 'phone home'.",
    "ONE COLOR THEME, max 3 accent colors. Light/dark mode optional but tasteful if included.",
    "MOBILE-FIRST RESPONSIVE — test at 360px width. If it breaks at narrow widths, it's broken.",
    "INLINE FAVICON (data URI) + descriptive <title> — looks polished even in a bookmark bar.",
    "NO console.log() IN PRODUCTION — clean console signals professional code.",
    "SHOWS EMPTY STATE / LOADING STATE / ERROR STATE — never just a blank white screen.",
    "INPUT VALIDATION INLINE — never browser alert(). Show the error next to the field.",
    "PERSISTS USER STATE if applicable — localStorage so the user doesn't lose work on refresh.",
  ],
  spreadsheet: [
    "HEADER ROW BOLD + FROZEN — scrolling never loses context.",
    "ONE SHEET PER LOGICAL ENTITY — don't cram 5 tables into one sheet with blank rows between.",
    "FORMULAS USE NAMED RANGES, not magic cell references. =SUM(Sales) beats =SUM(B2:B500).",
    "SOURCE DATA ON ITS OWN SHEET — calculated views reference it. Never edit raw data in the analysis sheet.",
    "NUMBER FORMATS CONSISTENT — currency right-aligned, percentages with 1 decimal, dates ISO YYYY-MM-DD.",
    "CONDITIONAL FORMATTING SUBTLE — light tint, not screaming red. The data tells the story.",
    "TOTALS ROW CLEARLY SEPARATED — bold + top border, never just at the bottom of the table.",
    "NO EMPTY ROWS/COLUMNS in data ranges — breaks pivot tables and filters.",
    "FILE NAMED WITH DATE — 'Q3-revenue-2026-05-04.xlsx' not 'final_v2_REAL_FINAL.xlsx'.",
  ],
  document: [
    "CLEAR HIERARCHY — Title → H1 → H2 → H3, never jumping levels (no H1 followed by H3).",
    "TOC FOR DOCS >5 PAGES — clickable links, regenerated on every save.",
    "ONE IDEA PER PARAGRAPH — readers skim. Long paragraphs hide the point.",
    "ACTIVE VOICE, SECOND PERSON for instructions ('Click Save' not 'The user clicks Save').",
    "QUOTES + CODE BLOCKS visually distinct — indented or boxed, monospace font for code.",
    "LISTS WHEN THERE ARE 3+ ITEMS — prose for 1-2, bullets for 3+.",
    "DEFINE ACRONYMS ON FIRST USE — 'API (application programming interface)' the first time only.",
    "LINKS HAVE DESCRIPTIVE TEXT — 'see the deployment guide' not 'click here'.",
    "PAGE BREAKS AT SECTION BOUNDARIES — never split a heading from its first paragraph.",
  ],
  image: [
    "SUBJECT OCCUPIES 30-60% of frame — rule of thirds; never dead-center unless intentional symmetry.",
    "BACKGROUND UNCLUTTERED — single dominant texture/color. The eye should know where to land.",
    "LIGHTING MATCHES MOOD — soft for portrait, hard for product, golden-hour for outdoor.",
    "RESOLUTION ≥ 2x display size — retina-ready. Pixelated images signal cheapness.",
    "FOR PEOPLE: eyes sharp + looking INTO frame, not out. Eyes out of frame loses connection.",
    "COLOR PALETTE LIMITED — 3-5 colors max. Rainbow images feel chaotic.",
    "NO WATERMARKS unless brand-required — if branded, corner-placed, ≤10% opacity, ≤5% area.",
    "FILE FORMAT MATCHES USE — PNG for graphics with transparency, JPG for photos, WebP for web bandwidth.",
  ],
};

// One-line summaries Felix can drop into a planning chain-of-thought without
// reading the whole card. Useful when context is tight.
export const QUALITY_TAGLINES: Record<string, string> = {
  video: "Hook in 3s · cuts every 4-7s · narration breathes · music ducks · captions always · one CTA · LUFS -16 to -14.",
  audio: "Warm intro · -16 LUFS · peaks ≤ -1 dBFS · fade in/out · ID3 tags · last 1.5s never cut mid-word.",
  pdf: "Cover hero stat · exec summary p2 · H2 sections (intro/evidence/takeaway) · charts captioned with takeaway · embedded fonts · sources cited.",
  slides: "One idea per slide · image-led ≤36 words · 36pt headlines / 24pt body · brand color in 2-3 elements · photo on first-person slides (R98.6) · single CTA on last slide.",
  html_app: "<1s load · single file · primary action above fold · keyboard accessible · works offline · mobile responsive 360px · empty/loading/error states · no console errors.",
  spreadsheet: "Bold frozen header · one entity per sheet · named-range formulas · source data separate from views · consistent number formats · subtle conditional formatting.",
  document: "Title → H1 → H2 → H3 (no jumps) · one idea per paragraph · active voice · 3+ items = bullets · descriptive link text · TOC for >5 pages.",
  image: "Subject 30-60% frame · uncluttered background · 3-5 color palette · 2x retina resolution · eyes into frame for portraits · format matches use.",
};

export function qualityCardForFormat(format: string): string {
  const card = QUALITY_CARDS[format];
  if (!card) return "";
  return `WHAT GOOD LOOKS LIKE — ${format.toUpperCase()}:\n${card.map((line) => `  - ${line}`).join("\n")}`;
}

export function allQualityCardsAsPromptBlock(): string {
  const blocks = Object.keys(QUALITY_CARDS).map(qualityCardForFormat).filter(Boolean);
  return `R98.14 — QUALITY-INSTINCT CARDS (the explicit "what good looks like" knowledge that lets you grade your own work the way a senior creator does — read these BEFORE planning AND BEFORE shipping):\n\n${blocks.join("\n\n")}\n\nQuick taglines for in-flight reference:\n${Object.entries(QUALITY_TAGLINES).map(([f, t]) => `  - ${f}: ${t}`).join("\n")}\n\nThese are defaults. If a customer-supplied reference (via learn_from_reference) returns sharper patterns for a specific style, those layer ON TOP of these baselines, never below them.`;
}
