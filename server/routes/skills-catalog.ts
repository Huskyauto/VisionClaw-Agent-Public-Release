/**
 * R125+8.5 — Public Skills Catalog
 *
 * Greg Isenberg's Feb 20 thesis: "people will download skills the way they
 * once downloaded apps." VisionClaw already sits on 27 output-skills; this
 * route exposes the opt-in ones as a browsable catalog.
 *
 * Design mirrors /api/public/gallery + /api/public/trust (R125+6):
 *  - Default-private opt-in via `is_public: true` in _registry.json
 *  - 60s in-memory TTL cache with X-Cache HIT/MISS headers
 *  - Public-by-URL, no auth, no PII
 *  - Source-of-truth is the file-system registry, NOT the DB — this lets
 *    Atlas (R125+11) own catalog edits via `platform_edit_file` without
 *    needing schema-migration authority.
 */

import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";

const CACHE_TTL_MS = 60_000;
const REGISTRY_PATH = path.join(process.cwd(), "data", "output-skills", "_registry.json");
const SKILLS_DIR = path.join(process.cwd(), "data", "output-skills");

interface PublicSkill {
  topic: string;
  department: string;
  summary: string;
  personaFit: string[];
  bytes: number;
  lastReviewed: string;
}

let listCache: { ts: number; mtimeMs: number; payload: any } | null = null;
let detailCache: Map<string, { ts: number; mtimeMs: number; payload: any }> = new Map();

function loadRegistry(): { reg: any; mtimeMs: number } {
  try {
    const stat = fs.statSync(REGISTRY_PATH);
    const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
    return { reg: JSON.parse(raw), mtimeMs: stat.mtimeMs };
  } catch {
    return { reg: { skills: [] }, mtimeMs: 0 };
  }
}

function publicSkillsFromRegistry(reg: any): PublicSkill[] {
  const skills = Array.isArray(reg?.skills) ? reg.skills : [];
  return skills
    .filter((s: any) => s && s.is_public === true && typeof s.topic === "string")
    .map((s: any) => ({
      topic: String(s.topic),
      department: String(s.department || "General"),
      summary: String(s.summary || ""),
      personaFit: Array.isArray(s.persona_fit) ? s.persona_fit.map(String) : [],
      bytes: Number(s.bytes || 0),
      lastReviewed: String(s.last_reviewed || ""),
    }))
    .sort((a: PublicSkill, b: PublicSkill) =>
      a.department === b.department
        ? a.topic.localeCompare(b.topic)
        : a.department.localeCompare(b.department)
    );
}

function safeTopicLookup(reg: any, topic: string): any | null {
  if (typeof topic !== "string") return null;
  if (!/^[a-z0-9-]+$/.test(topic)) return null;
  const skills = Array.isArray(reg?.skills) ? reg.skills : [];
  const found = skills.find((s: any) => s && s.topic === topic && s.is_public === true);
  return found || null;
}

export function registerSkillsCatalogRoutes(app: Express) {
  // List all public skills (catalog view)
  app.get("/api/public/skills", (_req: Request, res: Response) => {
    try {
      const { reg, mtimeMs } = loadRegistry();
      if (
        listCache &&
        Date.now() - listCache.ts < CACHE_TTL_MS &&
        listCache.mtimeMs === mtimeMs
      ) {
        res.setHeader("X-Cache", "HIT");
        return res.json(listCache.payload);
      }
      const items = publicSkillsFromRegistry(reg);
      const departments = Array.from(new Set(items.map((s) => s.department))).sort();
      const payload = {
        generatedAt: new Date().toISOString(),
        count: items.length,
        departmentCount: departments.length,
        departments,
        items,
      };
      listCache = { ts: Date.now(), mtimeMs, payload };
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "skills catalog failed" });
    }
  });

  // Read a single skill's full markdown (only if is_public=true)
  app.get("/api/public/skills/:topic", (req: Request, res: Response) => {
    try {
      const topic = String(req.params.topic || "");
      const { reg, mtimeMs } = loadRegistry();
      const cached = detailCache.get(topic);
      if (
        cached &&
        Date.now() - cached.ts < CACHE_TTL_MS &&
        cached.mtimeMs === mtimeMs
      ) {
        res.setHeader("X-Cache", "HIT");
        return res.json(cached.payload);
      }
      const entry = safeTopicLookup(reg, topic);
      if (!entry) {
        return res.status(404).json({ error: "skill not found or not public" });
      }
      // Defense-in-depth path containment: re-validate the filename from the
      // registry the same way the file route validates user input. Even though
      // the registry is repo-controlled, Atlas (R125+11) will be writing to it,
      // so we treat it as semi-trusted.
      const filename = String(entry.file || "");
      if (!/^[a-z0-9._-]+\.md$/.test(filename)) {
        return res.status(500).json({ error: "registry file pattern invalid" });
      }
      const filePath = path.join(SKILLS_DIR, filename);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(SKILLS_DIR + path.sep)) {
        return res.status(403).json({ error: "forbidden" });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: "skill file missing" });
      }
      const markdown = fs.readFileSync(resolved, "utf-8");
      const payload = {
        topic: entry.topic,
        department: entry.department,
        summary: entry.summary || "",
        personaFit: entry.persona_fit || [],
        bytes: entry.bytes || markdown.length,
        lastReviewed: entry.last_reviewed || "",
        markdown,
      };
      detailCache.set(topic, { ts: Date.now(), mtimeMs, payload });
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "skill detail failed" });
    }
  });
}
