/**
 * aeo-score.ts — citation-readiness scorer for AI answer engines.
 *
 * Answer engines (Google AI Overviews, ChatGPT, Perplexity, Gemini) lift
 * extractable, self-contained passages. This scores a Markdown draft on the
 * structural signals that make a passage liftable. Every signal is
 * mechanically checkable — pure text analysis, no LLM, no network, no DB.
 *
 * ADVISORY by design: it returns a score + per-signal breakdown + concrete
 * advice; it never gates anything by itself.
 *
 * Adapted (TypeScript reimplementation) from `aeo_score.py` in
 * siddiqss/semantic-seo-suite (MIT). Signal weights preserved:
 *   DEF    definition-first lead        15
 *   QA     question-H2 answer coverage  30
 *   TLDR   extractive summary up top    10
 *   LIFT   structured blocks             15
 *   BREV   answer-sentence brevity       10
 *   SELF   self-contained claims         10
 *   SCHEMA machine context (front-matter)10
 */

export interface AeoSignal {
  id: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface AeoScoreResult {
  score: number;
  grade: "strong" | "moderate" | "weak";
  signals: AeoSignal[];
  advice: string[];
  stats: {
    blocks: number;
    headings: number;
    questionHeadings: number;
    paragraphs: number;
  };
}

type Block = { kind: "h1" | "h2" | "h3" | "list" | "table" | "para"; text: string };

const QUESTION_STARTS = [
  "what", "why", "how", "when", "where", "which", "who",
  "is", "are", "can", "do", "does", "should", "will", "vs",
];

const DANGLING_OPENERS = /^(this|that|it|these|those|they)\b/i;

function splitFrontMatter(text: string): { frontMatter: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { frontMatter: {}, body: text };
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { frontMatter: {}, body: text };
  const frontMatter: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const first = line[0] ?? "";
    if (line.includes(":") && first !== " " && first !== "-") {
      const idx = line.indexOf(":");
      frontMatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { frontMatter, body: m[2] };
}

function toBlocks(body: string): Block[] {
  const out: Block[] = [];
  const buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push({ kind: "para", text: buf.join(" ").trim() });
      buf.length = 0;
    }
  };
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (!s) { flush(); continue; }
    if (s.startsWith("#")) {
      flush();
      const lvl = Math.min(s.length - s.replace(/^#+/, "").length, 3);
      out.push({ kind: `h${lvl}` as Block["kind"], text: s.replace(/^#+\s*/, "").trim() });
    } else if (/^[-*+]\s+/.test(s) || /^\d+[.)]\s+/.test(s)) {
      flush();
      // merge consecutive list lines into one list block
      const last = out[out.length - 1];
      if (last && last.kind === "list") last.text += "\n" + s;
      else out.push({ kind: "list", text: s });
    } else if (s.startsWith("|") && s.endsWith("|")) {
      flush();
      const last = out[out.length - 1];
      if (last && last.kind === "table") last.text += "\n" + s;
      else out.push({ kind: "table", text: s });
    } else {
      buf.push(s);
    }
  }
  flush();
  return out;
}

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isQuestionHeading(text: string): boolean {
  const lower = text.toLowerCase().replace(/[*_`]/g, "").trim();
  if (lower.endsWith("?")) return true;
  const first = lower.split(/\s+/)[0] ?? "";
  return QUESTION_STARTS.includes(first);
}

export function scoreAeo(markdown: string): AeoScoreResult {
  const { frontMatter, body } = splitFrontMatter(markdown ?? "");
  const blocks = toBlocks(body);
  const paras = blocks.filter((b) => b.kind === "para");
  const headings = blocks.filter((b) => b.kind === "h1" || b.kind === "h2" || b.kind === "h3");

  const signals: AeoSignal[] = [];
  const advice: string[] = [];

  // DEF (15) — definition-first lead: first paragraph defines the subject, <=50 words.
  {
    const firstPara = paras[0];
    let points = 0;
    let detail = "no opening paragraph found";
    if (firstPara) {
      const wc = wordCount(firstPara.text);
      const defines = /\b(is|are|means|refers to|describes)\b/i.test(firstPara.text);
      if (defines && wc <= 50) { points = 15; detail = `lead defines the subject in ${wc} words`; }
      else if (defines) { points = 7; detail = `lead defines the subject but runs ${wc} words (target ≤50)`; }
      else { detail = "lead paragraph does not define the subject (no is/are/means/refers-to)"; }
    }
    if (points < 15) advice.push("Open with a ≤50-word paragraph that directly defines the subject ('X is …').");
    signals.push({ id: "DEF", label: "definition-first lead", points, max: 15, detail });
  }

  // QA (30) — question headings answered in <=50 words immediately after.
  const questionHeadings: number[] = [];
  {
    let answered = 0;
    blocks.forEach((b, i) => {
      if ((b.kind === "h2" || b.kind === "h3") && isQuestionHeading(b.text)) {
        questionHeadings.push(i);
        const next = blocks[i + 1];
        if (next && next.kind === "para" && wordCount(next.text) <= 50) answered++;
      }
    });
    let points = 0;
    let detail: string;
    if (questionHeadings.length === 0) {
      detail = "no question-style H2/H3 headings found";
      advice.push("Add question-style H2s ('What is …?', 'How does …?') — answer engines match them to user queries.");
    } else {
      points = Math.round((answered / questionHeadings.length) * 30);
      detail = `${answered}/${questionHeadings.length} question headings answered in ≤50 words immediately below`;
      if (answered < questionHeadings.length) {
        advice.push("Put a ≤50-word direct answer as the FIRST paragraph under every question heading.");
      }
    }
    signals.push({ id: "QA", label: "question-H2 answer coverage", points, max: 30, detail });
  }

  // TLDR (10) — a short standalone summary in the first blocks.
  {
    const head = blocks.slice(0, 5);
    const hit = head.some(
      (b) =>
        /\b(tl;?dr|summary|key takeaways?|in short|at a glance)\b/i.test(b.text) ||
        (b.kind === "para" && /^\*\*[^*]+\*\*/.test(b.text) && wordCount(b.text) <= 60),
    );
    const points = hit ? 10 : 0;
    if (!hit) advice.push("Add a TL;DR / summary block near the top — engines lift standalone summaries.");
    signals.push({
      id: "TLDR", label: "extractive summary up top", points, max: 10,
      detail: hit ? "summary block found in the opening" : "no TL;DR/summary in the first blocks",
    });
  }

  // LIFT (15) — structured blocks: >=1 list and/or table.
  {
    const hasList = blocks.some((b) => b.kind === "list");
    const hasTable = blocks.some((b) => b.kind === "table");
    const points = (hasList ? 8 : 0) + (hasTable ? 7 : 0);
    if (!hasList) advice.push("Add at least one bulleted/numbered list — engines quote structured blocks.");
    if (!hasTable) advice.push("Consider a comparison/spec table where the content supports one.");
    signals.push({
      id: "LIFT", label: "structured blocks", points, max: 15,
      detail: `list: ${hasList ? "yes" : "no"}, table: ${hasTable ? "yes" : "no"}`,
    });
  }

  // BREV (10) — median sentence length <=25 words across paragraphs.
  {
    const allSentences = paras.flatMap((p) => sentences(p.text));
    let points = 0;
    let detail = "no sentences found";
    if (allSentences.length) {
      const lens = allSentences.map(wordCount).sort((a, b) => a - b);
      const median = lens[Math.floor(lens.length / 2)];
      points = median <= 25 ? 10 : median <= 32 ? 5 : 0;
      detail = `median sentence length ${median} words (target ≤25)`;
      if (points < 10) advice.push("Shorten sentences — median ≤25 words keeps passages liftable.");
    }
    signals.push({ id: "BREV", label: "answer-sentence brevity", points, max: 10, detail });
  }

  // SELF (10) — paragraphs don't open with a dangling This/It/That/These/Those/They.
  {
    let points = 10;
    let detail = "no paragraphs to check";
    if (paras.length) {
      const clean = paras.filter((p) => !DANGLING_OPENERS.test(p.text)).length;
      points = Math.round((clean / paras.length) * 10);
      detail = `${clean}/${paras.length} paragraphs open self-contained`;
      if (points < 10) advice.push("Avoid opening paragraphs with This/It/That — each passage should stand alone when quoted.");
    }
    signals.push({ id: "SELF", label: "self-contained claims", points, max: 10, detail });
  }

  // SCHEMA (10) — front-matter schema_type present.
  {
    const has = Boolean(frontMatter["schema_type"] || frontMatter["schema"]);
    const points = has ? 10 : 0;
    if (!has) advice.push("Declare a schema_type in front-matter (Article/FAQ/HowTo) and ship matching JSON-LD.");
    signals.push({
      id: "SCHEMA", label: "machine context", points, max: 10,
      detail: has ? `schema_type: ${frontMatter["schema_type"] || frontMatter["schema"]}` : "no schema_type in front-matter",
    });
  }

  const score = signals.reduce((s, x) => s + x.points, 0);
  const grade: AeoScoreResult["grade"] = score >= 75 ? "strong" : score >= 50 ? "moderate" : "weak";

  return {
    score,
    grade,
    signals,
    advice,
    stats: {
      blocks: blocks.length,
      headings: headings.length,
      questionHeadings: questionHeadings.length,
      paragraphs: paras.length,
    },
  };
}
