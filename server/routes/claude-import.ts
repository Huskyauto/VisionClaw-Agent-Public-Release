import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { autonomyRules } from "@shared/schema";
import {
  parseAgentMarkdown,
  parsedToPersonaInsert,
  buildAutonomyRulesForImport,
  fetchGithubAgentDirectory,
  deriveSourceSlug,
  parseGithubUrl,
  type ParsedAgent,
} from "../claude-subagent-importer";

type Helpers = {
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
};

interface PreviewBody {
  githubUrl?: unknown;
  includeUnderscorePrefixed?: unknown;
}

interface ApplyBody extends PreviewBody {
  selectedSlugs?: unknown;
  activate?: unknown;
}

const KNOWN_COLLECTIONS = [
  {
    label: "pentest-ai-agents (0xSteph)",
    url: "https://github.com/0xSteph/pentest-ai-agents/tree/main/.claude/agents",
    description: "31 offensive-security subagents (recon, exploit, post-exploit, detection). MIT.",
    stars: 789,
    license: "MIT",
  },
  {
    label: "claude-code-subagents-collection (wshobson)",
    url: "https://github.com/wshobson/agents",
    description: "General-purpose agent collection (devops, data, content, etc.).",
    stars: null,
    license: "MIT",
  },
];

function bad(res: Response, status: number, error: string) {
  return res.status(status).json({ error });
}

export function registerClaudeImportRoutes(app: Express, helpers: Helpers) {
  const { requirePlatformAdmin, getTenantFromRequest } = helpers;

  app.get("/api/claude-import/known-collections", (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json({ collections: KNOWN_COLLECTIONS });
  });

  app.post("/api/claude-import/preview", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const body = (req.body || {}) as PreviewBody;
    const url = typeof body.githubUrl === "string" ? body.githubUrl.trim() : "";
    if (!url) return bad(res, 400, "githubUrl is required");

    let parsedUrl;
    try {
      parsedUrl = parseGithubUrl(url);
    } catch (e: any) {
      return bad(res, 400, e.message || "invalid githubUrl");
    }

    let fetched;
    try {
      fetched = await fetchGithubAgentDirectory(url, {
        includeUnderscorePrefixed: body.includeUnderscorePrefixed === true,
        maxFiles: 200,
        githubToken: process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN || undefined,
      });
    } catch (e: any) {
      return bad(res, 502, e.message || "GitHub fetch failed");
    }

    const sourceSlug = deriveSourceSlug(url);
    const agents: Array<{
      slug: string;
      filename: string;
      proposedPersonaName: string;
      description: string;
      tier: ParsedAgent["tier"];
      tools: string[];
      hitlRecommendedTools: string[];
      warnings: string[];
      conflicts: boolean;
    }> = [];
    const errors: Array<{ path: string; error: string }> = [];

    const existingPersonas = await storage.getPersonas();
    const existingNames = new Set(existingPersonas.map((p) => p.name));

    for (const f of fetched.files) {
      try {
        const parsed = parseAgentMarkdown(f.content, f.path);
        const proposedName = `${sourceSlug}:${parsed.slug}`;
        agents.push({
          slug: parsed.slug,
          filename: f.path,
          proposedPersonaName: proposedName,
          description: parsed.frontmatter.description || "",
          tier: parsed.tier,
          tools: parsed.mappedTools.map((t) => t.claudeName),
          hitlRecommendedTools: parsed.mappedTools.filter((t) => t.hitlRecommended).map((t) => t.claudeName),
          warnings: parsed.warnings,
          conflicts: existingNames.has(proposedName),
        });
      } catch (e: any) {
        errors.push({ path: f.path, error: e.message || String(e) });
      }
    }

    res.json({
      source: {
        url,
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        ref: fetched.ref,
        subpath: fetched.resolvedSubpath,
        sourceSlug,
      },
      counts: {
        fetched: fetched.files.length,
        parsed: agents.length,
        errors: errors.length,
        skippedNonAgentDocs: fetched.skipped.length,
        conflicts: agents.filter((a) => a.conflicts).length,
      },
      agents,
      errors,
      skippedNonAgentDocs: fetched.skipped,
    });
  });

  app.post("/api/claude-import/apply", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return bad(res, 401, "tenant context required for autonomy rule wiring");
    const body = (req.body || {}) as ApplyBody;
    const url = typeof body.githubUrl === "string" ? body.githubUrl.trim() : "";
    if (!url) return bad(res, 400, "githubUrl is required");

    const selectedSlugs = Array.isArray(body.selectedSlugs)
      ? new Set(body.selectedSlugs.filter((s): s is string => typeof s === "string"))
      : null; // null = import all parsed agents

    let fetched;
    try {
      fetched = await fetchGithubAgentDirectory(url, {
        includeUnderscorePrefixed: body.includeUnderscorePrefixed === true,
        maxFiles: 200,
        githubToken: process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN || undefined,
      });
    } catch (e: any) {
      return bad(res, 502, e.message || "GitHub fetch failed");
    }

    const sourceSlug = deriveSourceSlug(url);
    const importedAt = new Date().toISOString();
    const sourceMeta = { url, ref: fetched.ref, importedAt };

    const existingPersonas = await storage.getPersonas();
    const existingNames = new Set(existingPersonas.map((p) => p.name));

    const created: Array<{ id: number; name: string; tier: string; autonomyRulesCreated: number }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const errors: Array<{ path: string; error: string }> = [];
    let totalAutonomyRules = 0;

    for (const f of fetched.files) {
      let parsed;
      try {
        parsed = parseAgentMarkdown(f.content, f.path);
      } catch (e: any) {
        errors.push({ path: f.path, error: e.message || String(e) });
        continue;
      }
      if (selectedSlugs && !selectedSlugs.has(parsed.slug)) {
        skipped.push({ name: parsed.slug, reason: "not selected" });
        continue;
      }
      const insert = parsedToPersonaInsert(parsed, sourceMeta, sourceSlug);
      if (existingNames.has(insert.name!)) {
        skipped.push({ name: insert.name!, reason: "already exists" });
        continue;
      }
      try {
        const persona = await storage.createPersona(insert);

        // Wire per-persona autonomy_rules for executor-tier imports.
        // Idempotent via the (tenant_id, persona_id, action_type) unique index.
        const ruleSeeds = buildAutonomyRulesForImport(parsed);
        let rulesInserted = 0;
        for (const seed of ruleSeeds) {
          try {
            // Use .returning() so onConflictDoNothing skips don't inflate the counter
            // (architect R80 follow-up: previously rulesInserted++ was unconditional).
            const inserted = await db.insert(autonomyRules).values({
              tenantId,
              personaId: persona.id,
              actionType: seed.actionType,
              autonomyLevel: seed.autonomyLevel,
              description: seed.description,
              enabled: true,
            }).onConflictDoNothing().returning({ id: autonomyRules.id });
            if (inserted.length > 0) rulesInserted++;
          } catch (ruleErr: any) {
            errors.push({ path: f.path, error: `autonomy rule ${seed.actionType}: ${ruleErr.message || ruleErr}` });
          }
        }
        totalAutonomyRules += rulesInserted;

        created.push({ id: persona.id, name: persona.name, tier: parsed.tier, autonomyRulesCreated: rulesInserted });
        existingNames.add(persona.name);
      } catch (e: any) {
        errors.push({ path: f.path, error: e.message || String(e) });
      }
    }

    res.status(200).json({
      source: { url, ref: fetched.ref, sourceSlug, importedAt },
      counts: {
        created: created.length,
        skipped: skipped.length,
        errors: errors.length,
        autonomyRulesCreated: totalAutonomyRules,
      },
      created,
      skipped,
      errors,
    });
  });
}
