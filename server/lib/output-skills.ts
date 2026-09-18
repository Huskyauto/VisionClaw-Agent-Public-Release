import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export interface OutputSkillMeta {
  topic: string;
  file: string;
  department: string;
  persona_fit: string[];
  last_reviewed: string;
  sha256?: string;
  bytes?: number;
}

export interface OutputSkillRegistry {
  version: number;
  source_repo: string;
  source_license: string;
  source_author: string;
  imported_at: string;
  imported_in_round: string;
  skills: OutputSkillMeta[];
}

const SKILLS_DIR = realpathSync(resolve(process.cwd(), "data/output-skills"));
const REGISTRY_PATH = join(SKILLS_DIR, "_registry.json");

let _registry: OutputSkillRegistry | null = null;

export function loadRegistry(): OutputSkillRegistry {
  if (_registry) return _registry;
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  _registry = JSON.parse(raw) as OutputSkillRegistry;
  return _registry;
}

export function listOutputSkills(filter?: {
  department?: string;
  persona?: string;
}): OutputSkillMeta[] {
  const reg = loadRegistry();
  let skills = reg.skills;
  if (filter?.department) {
    const d = filter.department.toLowerCase();
    skills = skills.filter((s) => s.department.toLowerCase() === d);
  }
  if (filter?.persona) {
    const p = filter.persona.toLowerCase();
    skills = skills.filter((s) => s.persona_fit.some((pf) => pf.toLowerCase() === p));
  }
  return skills;
}

const VALID_TOPIC = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function lookupOutputSkill(topic: string): {
  ok: boolean;
  topic?: string;
  department?: string;
  content?: string;
  available_topics?: string[];
  error?: string;
} {
  if (typeof topic !== "string" || topic.length === 0) {
    return { ok: false, error: "topic must be a non-empty string" };
  }
  if (topic.includes("\u0000")) {
    return { ok: false, error: "topic contains NUL byte" };
  }
  const normalized = topic.trim().toLowerCase();
  if (!VALID_TOPIC.test(normalized)) {
    return {
      ok: false,
      error: "topic must match [a-z0-9-]+ (no slashes, no dots, no parent-dir refs)",
    };
  }
  const reg = loadRegistry();
  const meta = reg.skills.find((s) => s.topic === normalized);
  if (!meta) {
    return {
      ok: false,
      error: `unknown topic "${normalized}"`,
      available_topics: reg.skills.map((s) => s.topic),
    };
  }
  // Path jail: file must resolve under SKILLS_DIR after realpath.
  const candidate = realpathSync(join(SKILLS_DIR, meta.file));
  if (!candidate.startsWith(SKILLS_DIR + "/") && candidate !== SKILLS_DIR) {
    return { ok: false, error: "skill file outside output-skills jail" };
  }
  // Architect R113.7+sec post-edit review, HIGH (integrity): hash-pin enforcement
  // MUST happen at runtime, not just in CI tests. Fail-CLOSED on any mismatch AND
  // on missing/malformed pin metadata — a tampered template OR a registry entry
  // with its pin stripped must never reach a persona's deliverable scaffolding.
  const buf = readFileSync(candidate);
  if (typeof meta.bytes !== "number" || !Number.isInteger(meta.bytes) || meta.bytes < 0) {
    return {
      ok: false,
      error: `integrity: registry entry for "${normalized}" is missing or has invalid \`bytes\` pin — refusing to serve unpinned template`,
    };
  }
  if (buf.byteLength !== meta.bytes) {
    return {
      ok: false,
      error: `integrity: byte-length mismatch for "${normalized}" (got ${buf.byteLength}, expected ${meta.bytes}) — template may be tampered or out-of-date`,
    };
  }
  if (typeof meta.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(meta.sha256)) {
    return {
      ok: false,
      error: `integrity: registry entry for "${normalized}" is missing or has malformed \`sha256\` pin — refusing to serve unpinned template`,
    };
  }
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== meta.sha256) {
    return {
      ok: false,
      error: `integrity: sha256 mismatch for "${normalized}" — template may be tampered or out-of-date`,
    };
  }
  const content = buf.toString("utf-8");
  return {
    ok: true,
    topic: meta.topic,
    department: meta.department,
    content,
  };
}
