import { createHash } from "node:crypto";
import { load, JSON_SCHEMA } from "js-yaml";

export const ROOT = "1DIoxMTB5BY-QAVBKELwO3k9s0L8K5cKA";
export const VERSION = "daily-ai-insights-review/1";
export const LIMITS = Object.freeze({ reports: 20, bytes: 1024 * 1024, sources: 6, pages: 10, minutes: 15 });
export const AGENTS = ["muse-spark", "grok-bot", "instinct-bot", "cue-bot", "claude"];
export const HEADINGS = [
  "Newest AI News — Models and Major Announcements",
  "Cutting-Edge Applications, Tools, and Agent Systems",
  "Quantum Computing",
  "AI for Business, Income, and Other Endeavors",
  "How These Developments Could Improve VisionClaw",
];
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export interface DriveFile { id: string; name: string; mimeType?: string; parents?: string[]; md5Checksum?: string; size?: string }
export interface Report {
  id: string; name: string; reportId: string; date: string; agent: string;
  revision: number; protocol: string; digest: string; sections: string[]; text: string;
  status: string; checksum?: string;
}

/** JSON-schema YAML excludes dates/custom tags. Metadata cannot supply authority. */
export function parseReport(file: DriveFile, text: string): Report {
  if (Buffer.byteLength(text) > LIMITS.bytes || text.includes("\0")) throw new Error("Report exceeds text bounds");
  const front = /^---\r?\n([\s\S]{1,12000}?)\r?\n---\r?\n/.exec(text);
  if (!front || /[&*][A-Za-z_]/.test(front[1])) throw new Error("Missing or unsafe report frontmatter");
  const m: any = load(front[1], { schema: JSON_SCHEMA, json: false });
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("Invalid report metadata");
  const match = /^(\d{4}-\d{2}-\d{2})__([a-z0-9-]+)__report__([a-z0-9-]+)__v(\d{3,6})\.md$/.exec(file.name);
  if (!match || !AGENTS.includes(match[2]) || m.schema_version !== "daily-ai-insights/1.1" || m.document_kind !== "report" ||
      m.timezone !== "America/Chicago" || m.report_date !== match[1] || m.agent_id !== match[2] ||
      !Number.isSafeInteger(m.revision) || m.revision !== Number(match[4]) || m.revision < 1 ||
      m.report_id !== `${match[1]}__${match[2]}__report__${match[3]}` ||
      !["complete", "partial", "blocked"].includes(m.research_status)) throw new Error("Filename/protocol/revision metadata conflict");
  const date = new Date(`${m.report_date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== m.report_date) throw new Error("Invalid report date");
  const body = text.slice(front[0].length);
  const headings = [...body.matchAll(/^## (\d)\. (.+)\r?$/gm)];
  if (headings.length !== 5 || headings.some((h, i) => Number(h[1]) !== i + 1 || h[2] !== HEADINGS[i])) {
    throw new Error("Report must preserve all five headings in the agreed order");
  }
  const sections = headings.map((h, i) => body.slice(h.index! + h[0].length, headings[i + 1]?.index).trim());
  if (sections.some(s => !s) || /^#{1,2}\s/m.test(sections[4])) throw new Error("Empty section or material after final section");
  return {
    id: file.id, name: file.name, reportId: m.report_id, date: m.report_date,
    agent: m.agent_id, revision: m.revision, protocol: m.schema_version,
    digest: sha(text), text, sections, status: m.research_status,
    checksum: createHash("md5").update(text).digest("hex"),
  };
}

/** Intl follows DST. A production heartbeat may catch up after 08:00 once/day. */
export function localSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, due: Number(p.hour) >= 8 };
}
