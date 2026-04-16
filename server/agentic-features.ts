import { db } from "./db";
import { sql, eq, and, desc } from "drizzle-orm";
import { replitOpenai } from "./providers";
import crypto from "crypto";
import { URL } from "url";

function validateUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const hostname = parsed.hostname.toLowerCase();
    const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "169.254.169.254"];
    if (blocked.includes(hostname)) return null;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function safeFetch(url: string, timeoutMs = 10000): Promise<string> {
  const validated = validateUrl(url);
  if (!validated) throw new Error(`Blocked URL: ${url} (private/internal network)`);
  const resp = await fetch(validated, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location");
    if (!location || !validateUrl(location)) throw new Error(`Redirect to blocked URL from ${validated}`);
    const resp2 = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (!resp2.ok) throw new Error(`HTTP ${resp2.status} from redirect ${location}`);
    return resp2.text();
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${validated}`);
  return resp.text();
}

export async function saveEvidence(params: {
  tenantId: number;
  query: string;
  claim: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceDate?: string;
  theme?: string;
  confidence?: number;
  supportingQuote?: string;
  contradicts?: string;
  projectId?: number;
}) {
  const result = await db.execute(sql`
    INSERT INTO research_evidence (tenant_id, project_id, query, claim, source_url, source_title, source_date, theme, confidence, supporting_quote, contradicts)
    VALUES (${params.tenantId}, ${params.projectId || null}, ${params.query}, ${params.claim}, ${params.sourceUrl || null}, ${params.sourceTitle || null}, ${params.sourceDate || null}, ${params.theme || null}, ${params.confidence || 70}, ${params.supportingQuote || null}, ${params.contradicts || null})
    RETURNING id
  `);
  const id = (result as any).rows?.[0]?.id;
  return { success: true, evidenceId: id, message: `Evidence saved: "${params.claim.slice(0, 80)}..."` };
}

export async function queryEvidence(params: {
  tenantId: number;
  query?: string;
  theme?: string;
  minConfidence?: number;
  limit?: number;
}) {
  const limit = Math.min(Math.max(1, params.limit || 20), 100);
  let whereClause = sql`tenant_id = ${params.tenantId} AND status = 'active'`;
  if (params.theme) {
    whereClause = sql`${whereClause} AND theme ILIKE ${'%' + params.theme + '%'}`;
  }
  if (params.query) {
    whereClause = sql`${whereClause} AND (query ILIKE ${'%' + params.query + '%'} OR claim ILIKE ${'%' + params.query + '%'})`;
  }
  if (params.minConfidence !== undefined && params.minConfidence !== null) {
    whereClause = sql`${whereClause} AND confidence >= ${params.minConfidence}`;
  }

  const rows = await db.execute(sql`
    SELECT id, query, claim, source_url, source_title, source_date, theme, confidence, supporting_quote, contradicts, created_at
    FROM research_evidence
    WHERE ${whereClause}
    ORDER BY confidence DESC, created_at DESC
    LIMIT ${limit}
  `);
  const evidence = (rows as any).rows || [];
  const themes = [...new Set(evidence.map((e: any) => e.theme).filter(Boolean))];
  return {
    success: true,
    count: evidence.length,
    themes,
    evidence: evidence.map((e: any) => ({
      id: e.id,
      claim: e.claim,
      source: e.source_title || e.source_url,
      sourceUrl: e.source_url,
      confidence: e.confidence,
      theme: e.theme,
      quote: e.supporting_quote,
      contradicts: e.contradicts,
      date: e.source_date,
    })),
  };
}

export async function synthesizeResearch(params: {
  tenantId: number;
  query: string;
  format?: string;
}) {
  const evidence = await queryEvidence({ tenantId: params.tenantId, query: params.query, limit: 30 });
  if (evidence.count === 0) {
    return { success: false, error: "No evidence found for this query. Use save_evidence to store research findings first." };
  }

  const evidenceText = evidence.evidence.map((e: any, i: number) =>
    `[${i + 1}] ${e.claim} (confidence: ${e.confidence}/100, source: ${e.source || 'unknown'}${e.contradicts ? ', CONTRADICTS: ' + e.contradicts : ''})`
  ).join("\n");

  const format = params.format || "memo";

  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are a research analyst. Synthesize the evidence below into a ${format}. Rules:
- Every claim MUST cite its source using [N] notation
- Flag low-confidence claims (below 60) explicitly
- Note any contradictions between sources
- End with "Open Questions" listing unresolved or under-researched areas
- Be concise and actionable`
        },
        {
          role: "user",
          content: `Research query: "${params.query}"\n\nEvidence:\n${evidenceText}\n\nSynthesize into a ${format}.`
        }
      ],
      max_completion_tokens: 2000,
    });

    const synthesis = resp.choices?.[0]?.message?.content || "";
    const highConfidence = evidence.evidence.filter((e: any) => e.confidence >= 80).length;
    const lowConfidence = evidence.evidence.filter((e: any) => e.confidence < 60).length;
    const contradictions = evidence.evidence.filter((e: any) => e.contradicts).length;

    return {
      success: true,
      synthesis,
      stats: {
        totalEvidence: evidence.count,
        highConfidence,
        lowConfidence,
        contradictions,
        themes: evidence.themes,
      },
    };
  } catch (err: any) {
    return { success: false, error: `Synthesis failed: ${err.message}` };
  }
}

export async function addCompetitor(params: {
  tenantId: number;
  name: string;
  website: string;
  pricingUrl?: string;
  productUrl?: string;
  changelogUrl?: string;
  notes?: string;
}) {
  if (!validateUrl(params.website)) return { success: false, error: "Invalid website URL" };
  if (params.pricingUrl && !validateUrl(params.pricingUrl)) return { success: false, error: "Invalid pricing URL" };
  if (params.productUrl && !validateUrl(params.productUrl)) return { success: false, error: "Invalid product URL" };
  if (params.changelogUrl && !validateUrl(params.changelogUrl)) return { success: false, error: "Invalid changelog URL" };
  const result = await db.execute(sql`
    INSERT INTO competitor_registry (tenant_id, name, website, pricing_url, product_url, changelog_url, notes)
    VALUES (${params.tenantId}, ${params.name}, ${params.website}, ${params.pricingUrl || null}, ${params.productUrl || null}, ${params.changelogUrl || null}, ${params.notes || null})
    RETURNING id
  `);
  const id = (result as any).rows?.[0]?.id;
  return { success: true, competitorId: id, message: `Competitor "${params.name}" added to watchlist.` };
}

export async function listCompetitors(params: { tenantId: number }) {
  const rows = await db.execute(sql`
    SELECT c.*, 
      (SELECT COUNT(*) FROM competitor_snapshots WHERE competitor_id = c.id) as snapshot_count,
      (SELECT COUNT(*) FROM competitor_changes WHERE competitor_id = c.id) as change_count,
      (SELECT MAX(created_at) FROM competitor_snapshots WHERE competitor_id = c.id) as last_snapshot
    FROM competitor_registry c
    WHERE c.tenant_id = ${params.tenantId} AND c.is_active = true
    ORDER BY c.name
  `);
  return { success: true, competitors: (rows as any).rows || [] };
}

export async function takeCompetitorSnapshot(params: {
  tenantId: number;
  competitorId: number;
}) {
  const compRows = await db.execute(sql`SELECT * FROM competitor_registry WHERE id = ${params.competitorId} AND tenant_id = ${params.tenantId}`);
  const comp = (compRows as any).rows?.[0];
  if (!comp) return { success: false, error: "Competitor not found" };

  const urls = [comp.website, comp.pricing_url, comp.product_url, comp.changelog_url].filter(Boolean);
  const snapshots: any[] = [];

  for (const url of urls) {
    if (!validateUrl(url)) {
      snapshots.push({ url, error: "Blocked URL (private/internal network)" });
      continue;
    }
    try {
      let content = "";
      try {
        const { isFirecrawlAvailable } = await import("./firecrawl");
        if (isFirecrawlAvailable()) {
          const { firecrawlScrape } = await import("./firecrawl");
          const result = await firecrawlScrape(url, { formats: ["markdown"] });
          content = (result as any)?.markdown || (result as any)?.content || "";
        }
      } catch {}

      if (!content) {
        const rawHtml = await safeFetch(url, 10000);
        content = rawHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 20000);
      }

      const contentHash = crypto.createHash("md5").update(content.slice(0, 5000)).digest("hex");

      const result = await db.execute(sql`
        INSERT INTO competitor_snapshots (tenant_id, competitor_id, url, content_hash, content_text)
        VALUES (${params.tenantId}, ${params.competitorId}, ${url}, ${contentHash}, ${content.slice(0, 50000)})
        RETURNING id
      `);
      snapshots.push({ url, snapshotId: (result as any).rows?.[0]?.id, contentLength: content.length, hash: contentHash });
    } catch (err: any) {
      snapshots.push({ url, error: err.message });
    }
  }

  return { success: true, competitor: comp.name, snapshots };
}

export async function detectCompetitorChanges(params: {
  tenantId: number;
  competitorId?: number;
}) {
  let compFilter = sql`tenant_id = ${params.tenantId} AND is_active = true`;
  if (params.competitorId) {
    compFilter = sql`${compFilter} AND id = ${params.competitorId}`;
  }

  const comps = await db.execute(sql`SELECT * FROM competitor_registry WHERE ${compFilter}`);
  const competitors = (comps as any).rows || [];
  const allChanges: any[] = [];

  for (const comp of competitors) {
    const snaps = await db.execute(sql`
      SELECT DISTINCT ON (url) id, url, content_hash, content_text, created_at
      FROM competitor_snapshots
      WHERE competitor_id = ${comp.id} AND tenant_id = ${params.tenantId}
      ORDER BY url, created_at DESC
    `);
    const latestSnapshots = (snaps as any).rows || [];

    const prevSnaps = await db.execute(sql`
      SELECT s1.url, s1.content_hash as prev_hash, s1.content_text as prev_text, s1.created_at as prev_date
      FROM competitor_snapshots s1
      WHERE s1.competitor_id = ${comp.id} AND s1.tenant_id = ${params.tenantId}
        AND s1.id NOT IN (
          SELECT DISTINCT ON (url) id FROM competitor_snapshots
          WHERE competitor_id = ${comp.id}
          ORDER BY url, created_at DESC
        )
      ORDER BY s1.url, s1.created_at DESC
    `);
    const previousByUrl = new Map<string, any>();
    for (const p of (prevSnaps as any).rows || []) {
      if (!previousByUrl.has(p.url)) previousByUrl.set(p.url, p);
    }

    for (const snap of latestSnapshots) {
      const prev = previousByUrl.get(snap.url);
      if (!prev) continue;
      if (prev.prev_hash === snap.content_hash) continue;

      try {
        const resp = await replitOpenai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [
            {
              role: "system",
              content: `You are a competitive intelligence analyst. Compare the previous and current versions of a competitor's page. Identify meaningful changes in: pricing, features, messaging, positioning, or product. Ignore cosmetic changes. Return JSON: { "changes": [{ "type": "pricing|feature|messaging|positioning|product|other", "summary": "...", "significance": "high|medium|low" }] }`
            },
            {
              role: "user",
              content: `Competitor: ${comp.name}\nURL: ${snap.url}\n\nPREVIOUS (${prev.prev_date}):\n${(prev.prev_text || "").slice(0, 3000)}\n\nCURRENT:\n${(snap.content_text || "").slice(0, 3000)}`
            }
          ],
          max_completion_tokens: 500,
        });

        const text = resp.choices?.[0]?.message?.content || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const change of (parsed.changes || [])) {
            await db.execute(sql`
              INSERT INTO competitor_changes (tenant_id, competitor_id, snapshot_id, change_type, summary, details, significance)
              VALUES (${params.tenantId}, ${comp.id}, ${snap.id}, ${change.type}, ${change.summary}, ${JSON.stringify(change)}, ${change.significance || 'medium'})
            `);
            allChanges.push({ competitor: comp.name, url: snap.url, ...change });
          }
        }
      } catch (err: any) {
        console.error(`[competitor-intel] Change detection error for ${comp.name} / ${snap.url}: ${err.message}`);
      }
    }
  }

  return {
    success: true,
    changesDetected: allChanges.length,
    changes: allChanges,
    competitorsAnalyzed: competitors.length,
  };
}

export async function competitorBriefing(params: { tenantId: number; period?: string }) {
  const validPeriods = ["1 day", "3 days", "7 days", "14 days", "30 days", "60 days", "90 days", "1 month", "3 months", "6 months"];
  const period = validPeriods.includes(params.period || "") ? params.period! : "7 days";
  const changes = await db.execute(sql`
    SELECT cc.*, cr.name as competitor_name, cr.website
    FROM competitor_changes cc
    JOIN competitor_registry cr ON cr.id = cc.competitor_id
    WHERE cc.tenant_id = ${params.tenantId}
      AND cc.created_at > NOW() - CAST(${period} AS INTERVAL)
    ORDER BY cc.created_at DESC
    LIMIT 50
  `);
  const rows = (changes as any).rows || [];

  if (rows.length === 0) {
    return { success: true, briefing: "No competitor changes detected in the selected period.", changes: [] };
  }

  const changesSummary = rows.map((r: any) =>
    `- ${r.competitor_name}: [${r.change_type}] ${r.summary} (significance: ${r.significance})`
  ).join("\n");

  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: "You are a strategic intelligence analyst. Write a concise executive briefing on competitor movements. Group by competitor, highlight high-significance changes first, and end with strategic implications and recommended actions."
        },
        {
          role: "user",
          content: `Competitor changes in the last ${period}:\n${changesSummary}\n\nWrite an executive competitor intelligence briefing.`
        }
      ],
      max_completion_tokens: 1500,
    });

    return {
      success: true,
      briefing: resp.choices?.[0]?.message?.content || "",
      changesCount: rows.length,
      period,
    };
  } catch (err: any) {
    return { success: false, error: `Briefing generation failed: ${err.message}` };
  }
}

export async function defineICP(params: {
  tenantId: number;
  name: string;
  icpDescription: string;
  criteria: string;
}) {
  const result = await db.execute(sql`
    INSERT INTO lead_scoring_rules (tenant_id, name, icp_description, criteria)
    VALUES (${params.tenantId}, ${params.name}, ${params.icpDescription}, ${params.criteria})
    RETURNING id
  `);
  return { success: true, ruleId: (result as any).rows?.[0]?.id, message: `ICP scoring rule "${params.name}" created.` };
}

export async function enrichLead(params: {
  tenantId: number;
  leadName: string;
  leadEmail?: string;
  companyName?: string;
  companyUrl?: string;
  role?: string;
}) {
  let companyDescription = "";
  let industry = "";
  let companySize = "";
  let enrichmentData: any = {};

  if (params.companyUrl) {
    if (!validateUrl(params.companyUrl)) return { success: false, error: "Invalid or blocked company URL" };
    try {
      let content = "";
      try {
        const { isFirecrawlAvailable, firecrawlScrape } = await import("./firecrawl");
        if (isFirecrawlAvailable()) {
          const result = await firecrawlScrape(params.companyUrl, { formats: ["markdown"] });
          content = ((result as any)?.markdown || "").slice(0, 5000);
        }
      } catch {}

      if (!content) {
        const html = await safeFetch(params.companyUrl, 8000);
        content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 5000);
      }

      if (content) {
        const resp = await replitOpenai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [
            {
              role: "system",
              content: 'Extract company info from this website content. Return JSON: { "description": "...", "industry": "...", "companySize": "startup|small|medium|large|enterprise", "products": "...", "targetMarket": "..." }'
            },
            { role: "user", content: content.slice(0, 3000) }
          ],
          max_completion_tokens: 300,
        });
        const text = resp.choices?.[0]?.message?.content || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          enrichmentData = JSON.parse(jsonMatch[0]);
          companyDescription = enrichmentData.description || "";
          industry = enrichmentData.industry || "";
          companySize = enrichmentData.companySize || "";
        }
      }
    } catch (err: any) {
      console.error(`[lead-enrichment] Error enriching from ${params.companyUrl}: ${err.message}`);
    }
  }

  const result = await db.execute(sql`
    INSERT INTO lead_enrichments (tenant_id, lead_name, lead_email, company_name, company_url, company_description, industry, company_size, role, enrichment_data, qualification_status)
    VALUES (${params.tenantId}, ${params.leadName}, ${params.leadEmail || null}, ${params.companyName || null}, ${params.companyUrl || null}, ${companyDescription}, ${industry}, ${companySize}, ${params.role || null}, ${JSON.stringify(enrichmentData)}, 'enriched')
    RETURNING id
  `);

  return {
    success: true,
    leadId: (result as any).rows?.[0]?.id,
    enrichment: {
      description: companyDescription,
      industry,
      companySize,
      ...enrichmentData,
    },
  };
}

export async function scoreLeads(params: { tenantId: number; ruleId?: number }) {
  let icpRule: any = null;
  if (params.ruleId) {
    const r = await db.execute(sql`SELECT * FROM lead_scoring_rules WHERE id = ${params.ruleId} AND tenant_id = ${params.tenantId}`);
    icpRule = (r as any).rows?.[0];
  } else {
    const r = await db.execute(sql`SELECT * FROM lead_scoring_rules WHERE tenant_id = ${params.tenantId} AND is_active = true ORDER BY created_at DESC LIMIT 1`);
    icpRule = (r as any).rows?.[0];
  }
  if (!icpRule) return { success: false, error: "No ICP scoring rule found. Use define_icp first." };

  const leads = await db.execute(sql`
    SELECT * FROM lead_enrichments
    WHERE tenant_id = ${params.tenantId} AND (qualification_status = 'enriched' OR qualification_status = 'unscored')
    LIMIT 20
  `);
  const leadRows = (leads as any).rows || [];
  if (leadRows.length === 0) return { success: true, message: "No leads to score.", scored: 0 };

  const scored: any[] = [];
  for (const lead of leadRows) {
    try {
      const resp = await replitOpenai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a lead qualification expert. Score this lead against the ICP. Return JSON: { "score": 0-100, "grade": "A|B|C|D|F", "reasoning": "..." }\n\nICP: ${icpRule.icp_description}\nCriteria: ${icpRule.criteria}`
          },
          {
            role: "user",
            content: `Lead: ${lead.lead_name}\nEmail: ${lead.lead_email || 'unknown'}\nCompany: ${lead.company_name || 'unknown'}\nURL: ${lead.company_url || 'none'}\nIndustry: ${lead.industry || 'unknown'}\nSize: ${lead.company_size || 'unknown'}\nRole: ${lead.role || 'unknown'}\nDescription: ${(lead.company_description || '').slice(0, 500)}`
          }
        ],
        max_completion_tokens: 200,
      });

      const text = resp.choices?.[0]?.message?.content || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const score = Math.min(100, Math.max(0, parsed.score || 50));
        const grade = parsed.grade || (score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D");
        const status = score >= 70 ? "qualified" : score >= 40 ? "nurture" : "disqualified";

        await db.execute(sql`
          UPDATE lead_enrichments SET icp_score = ${score}, icp_grade = ${grade}, qualification_status = ${status}, notes = ${parsed.reasoning || ''}, updated_at = NOW()
          WHERE id = ${lead.id}
        `);
        scored.push({ id: lead.id, name: lead.lead_name, score, grade, status, reasoning: parsed.reasoning });
      }
    } catch (err: any) {
      console.error(`[lead-scoring] Error scoring lead ${lead.lead_name}: ${err.message}`);
    }
  }

  return { success: true, scored: scored.length, icpRule: icpRule.name, results: scored };
}

export async function qualifyLeads(params: { tenantId: number; minScore?: number }) {
  const minScore = params.minScore || 0;
  const leads = await db.execute(sql`
    SELECT * FROM lead_enrichments
    WHERE tenant_id = ${params.tenantId} AND icp_score IS NOT NULL
    ORDER BY icp_score DESC
  `);
  const all = (leads as any).rows || [];
  const qualified = all.filter((l: any) => l.icp_score >= (params.minScore || 70));
  const nurture = all.filter((l: any) => l.icp_score >= 40 && l.icp_score < 70);
  const disqualified = all.filter((l: any) => l.icp_score < 40);

  return {
    success: true,
    total: all.length,
    qualified: qualified.map((l: any) => ({ id: l.id, name: l.lead_name, company: l.company_name, score: l.icp_score, grade: l.icp_grade })),
    nurture: nurture.map((l: any) => ({ id: l.id, name: l.lead_name, company: l.company_name, score: l.icp_score, grade: l.icp_grade })),
    disqualified: disqualified.length,
    summary: `${qualified.length} qualified, ${nurture.length} nurture, ${disqualified.length} disqualified`,
  };
}

export async function createSequence(params: {
  tenantId: number;
  name: string;
  description?: string;
  steps: Array<{ subject?: string; bodyTemplate: string; waitDays?: number; channel?: string }>;
}) {
  if (!params.steps || params.steps.length === 0) {
    return { success: false, error: "At least one step is required." };
  }

  const seqResult = await db.execute(sql`
    INSERT INTO outreach_sequences (tenant_id, name, description)
    VALUES (${params.tenantId}, ${params.name}, ${params.description || null})
    RETURNING id
  `);
  const sequenceId = (seqResult as any).rows?.[0]?.id;

  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    await db.execute(sql`
      INSERT INTO outreach_sequence_steps (sequence_id, step_number, channel, subject, body_template, wait_days)
      VALUES (${sequenceId}, ${i + 1}, ${step.channel ?? 'email'}, ${step.subject ?? null}, ${step.bodyTemplate}, ${step.waitDays ?? 3})
    `);
  }

  return { success: true, sequenceId, stepsCreated: params.steps.length, message: `Sequence "${params.name}" created with ${params.steps.length} steps.` };
}

export async function enrollInSequence(params: {
  tenantId: number;
  sequenceId: number;
  contactName: string;
  contactEmail: string;
  companyName?: string;
  personalContext?: string;
}) {
  const seq = await db.execute(sql`SELECT * FROM outreach_sequences WHERE id = ${params.sequenceId} AND tenant_id = ${params.tenantId}`);
  if (!((seq as any).rows?.length)) return { success: false, error: "Sequence not found" };

  const existing = await db.execute(sql`
    SELECT id FROM outreach_enrollments WHERE sequence_id = ${params.sequenceId} AND contact_email = ${params.contactEmail} AND status = 'active'
  `);
  if ((existing as any).rows?.length) return { success: false, error: "Contact already enrolled in this sequence" };

  const result = await db.execute(sql`
    INSERT INTO outreach_enrollments (tenant_id, sequence_id, contact_name, contact_email, company_name, personal_context, next_send_at)
    VALUES (${params.tenantId}, ${params.sequenceId}, ${params.contactName}, ${params.contactEmail}, ${params.companyName || null}, ${params.personalContext || null}, NOW())
    RETURNING id
  `);

  return { success: true, enrollmentId: (result as any).rows?.[0]?.id, message: `${params.contactName} enrolled in sequence.` };
}

export async function advanceSequence(params: { tenantId: number; sequenceId?: number }) {
  let filter = sql`e.tenant_id = ${params.tenantId} AND e.status = 'active' AND (e.next_send_at IS NULL OR e.next_send_at <= NOW())`;
  if (params.sequenceId) {
    filter = sql`${filter} AND e.sequence_id = ${params.sequenceId}`;
  }

  const enrollments = await db.execute(sql`
    SELECT e.*, s.name as sequence_name
    FROM outreach_enrollments e
    JOIN outreach_sequences s ON s.id = e.sequence_id
    WHERE ${filter}
    ORDER BY e.next_send_at ASC
    LIMIT 20
    FOR UPDATE OF e SKIP LOCKED
  `);
  const rows = (enrollments as any).rows || [];
  if (rows.length === 0) return { success: true, message: "No enrollments ready to advance.", sent: 0 };

  const results: any[] = [];
  for (const enrollment of rows) {
    const stepResult = await db.execute(sql`
      SELECT * FROM outreach_sequence_steps WHERE sequence_id = ${enrollment.sequence_id} AND step_number = ${enrollment.current_step}
    `);
    const step = (stepResult as any).rows?.[0];
    if (!step) {
      await db.execute(sql`UPDATE outreach_enrollments SET status = 'completed', updated_at = NOW() WHERE id = ${enrollment.id}`);
      results.push({ contact: enrollment.contact_name, status: "completed", reason: "All steps done" });
      continue;
    }

    try {
      let body = step.body_template;
      body = body.replace(/\{\{name\}\}/g, enrollment.contact_name)
        .replace(/\{\{company\}\}/g, enrollment.company_name || "your company")
        .replace(/\{\{email\}\}/g, enrollment.contact_email);

      if (enrollment.personal_context) {
        try {
          const resp = await replitOpenai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              { role: "system", content: "Personalize this outreach email using the context provided. Keep the structure, adjust tone and details to feel natural and relevant. Return ONLY the personalized email body." },
              { role: "user", content: `Template:\n${body}\n\nContext about recipient:\n${enrollment.personal_context}\n\nPersonalize this email.` }
            ],
            max_completion_tokens: 500,
          });
          body = resp.choices?.[0]?.message?.content || body;
        } catch (err: any) {
          console.error(`[outreach] Personalization failed for ${enrollment.contact_name}: ${err.message}`);
        }
      }

      const { sendEmail } = await import("./email");
      await sendEmail(params.tenantId, enrollment.contact_email, step.subject || `Following up`, body);

      const nextStep = enrollment.current_step + 1;
      const nextSendAt = new Date(Date.now() + (step.wait_days || 3) * 86400000);

      await db.execute(sql`
        UPDATE outreach_enrollments
        SET current_step = ${nextStep}, last_sent_at = NOW(), next_send_at = ${nextSendAt}, updated_at = NOW()
        WHERE id = ${enrollment.id}
      `);
      results.push({ contact: enrollment.contact_name, email: enrollment.contact_email, stepSent: enrollment.current_step, subject: step.subject, nextStepAt: nextSendAt.toISOString() });
    } catch (err: any) {
      results.push({ contact: enrollment.contact_name, error: err.message });
    }
  }

  return { success: true, sent: results.filter(r => !r.error).length, results };
}

export async function classifyReply(params: {
  tenantId: number;
  contactEmail: string;
  replyContent: string;
}) {
  const enrollment = await db.execute(sql`
    SELECT e.*, s.name as sequence_name
    FROM outreach_enrollments e
    JOIN outreach_sequences s ON s.id = e.sequence_id
    WHERE e.tenant_id = ${params.tenantId} AND e.contact_email = ${params.contactEmail} AND e.status = 'active'
    ORDER BY e.created_at DESC LIMIT 1
  `);
  const row = (enrollment as any).rows?.[0];

  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: 'Classify this reply to an outreach email. Return JSON: { "classification": "positive|interested|meeting_request|objection|unsubscribe|out_of_office|not_interested|bounce|other", "sentiment": "positive|neutral|negative", "action": "schedule_meeting|send_info|pause_sequence|stop_sequence|continue|escalate", "summary": "..." }'
        },
        { role: "user", content: params.replyContent.slice(0, 2000) }
      ],
      max_completion_tokens: 200,
    });

    const text = resp.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { classification: "other", sentiment: "neutral", action: "continue", summary: "Could not classify" };

    if (row) {
      const shouldStop = ["unsubscribe", "not_interested", "bounce"].includes(parsed.classification);
      const shouldPause = ["meeting_request", "positive", "interested"].includes(parsed.classification);
      const newStatus = shouldStop ? "stopped" : shouldPause ? "paused" : "active";

      await db.execute(sql`
        UPDATE outreach_enrollments
        SET reply_classification = ${parsed.classification}, reply_content = ${params.replyContent.slice(0, 2000)}, status = ${newStatus}, updated_at = NOW()
        WHERE id = ${row.id}
      `);
    }

    return {
      success: true,
      classification: parsed.classification,
      sentiment: parsed.sentiment,
      recommendedAction: parsed.action,
      summary: parsed.summary,
      sequenceUpdated: !!row,
      enrollmentStatus: row ? (["unsubscribe", "not_interested", "bounce"].includes(parsed.classification) ? "stopped" : ["meeting_request", "positive", "interested"].includes(parsed.classification) ? "paused" : "active") : null,
    };
  } catch (err: any) {
    return { success: false, error: `Classification failed: ${err.message}` };
  }
}

export async function listSequences(params: { tenantId: number }) {
  const seqs = await db.execute(sql`
    SELECT s.*,
      (SELECT COUNT(*) FROM outreach_sequence_steps WHERE sequence_id = s.id) as step_count,
      (SELECT COUNT(*) FROM outreach_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments,
      (SELECT COUNT(*) FROM outreach_enrollments WHERE sequence_id = s.id AND status = 'completed') as completed,
      (SELECT COUNT(*) FROM outreach_enrollments WHERE sequence_id = s.id AND reply_classification IS NOT NULL) as replies
    FROM outreach_sequences s
    WHERE s.tenant_id = ${params.tenantId}
    ORDER BY s.created_at DESC
  `);
  return { success: true, sequences: (seqs as any).rows || [] };
}