import { db } from "./db";
import { sql } from "drizzle-orm";

async function postToChannel(tenantId: number, channelName: string, message: string) {
  try {
    const channelResult = await db.execute(sql`
      SELECT id FROM agent_channels WHERE tenant_id = ${tenantId} AND name = ${channelName} LIMIT 1
    `);
    const channel = ((channelResult as any).rows || channelResult)[0];
    if (channel) {
      await db.execute(sql`
        INSERT INTO channel_messages (tenant_id, channel_id, persona_id, message_type, content, created_at)
        VALUES (${tenantId}, ${channel.id}, 5, 'system', ${message}, NOW())
      `);
    }
  } catch (err: any) {
    console.log(`[quarterly-intel] Failed to post to ${channelName}: ${err.message}`);
  }
}

export async function runGovernanceResearchScan(tenantId: number = 1): Promise<{
  frameworksDiscovered: number;
  frameworksAdded: number;
  existingUpdated: number;
  summary: string;
  details: string[];
}> {
  console.log("[quarterly-intel] Starting governance research scan...");
  const details: string[] = [];
  let frameworksDiscovered = 0;
  let frameworksAdded = 0;
  let existingUpdated = 0;

  const existingResult = await db.execute(sql`
    SELECT name, organization, version FROM governance_frameworks WHERE tenant_id = ${tenantId} AND status = 'active'
  `);
  const existing = ((existingResult as any).rows || existingResult) as any[];
  const existingNames = existing.map((f: any) => f.name.toLowerCase());

  const { perplexitySearch, isPerplexityAvailable } = await import("./perplexity-search");

  let searchAvailable = isPerplexityAvailable();
  let usePerplexity = searchAvailable;

  const searchQueries = [
    "new AI agent governance frameworks standards regulations 2025 2026 agentic AI autonomous agents",
    "NIST OWASP ISO IEEE agentic AI standards updates 2026 autonomous AI agents governance",
    "government regulations agentic AI autonomous AI agents safety governance framework new publications 2026",
    "open source AI agent governance best practices enterprise autonomous AI management standards",
  ];

  const allDiscoveries: any[] = [];

  for (const query of searchQueries) {
    try {
      let answer = "";
      let citations: string[] = [];

      if (usePerplexity) {
        const result = await perplexitySearch(query);
        if (result.success && result.answer) {
          answer = result.answer;
          citations = result.citations || [];
        } else {
          usePerplexity = false;
        }
      }

      if (!usePerplexity) {
        const { getClientForModel, getModelForTierAsync } = await import("./providers");
        const modelId = await getModelForTierAsync("balanced", tenantId);
        const { client, actualModelId } = await getClientForModel(modelId, tenantId);

        const response = await client.chat.completions.create({
          model: actualModelId,
          messages: [
            { role: "system", content: "You are a research analyst specializing in AI governance, AI safety standards, and regulatory frameworks for autonomous AI agents (agentic AI). Provide factual, well-sourced information." },
            { role: "user", content: query + "\n\nList any specific frameworks, standards, regulations, or published guidelines. For each, provide: name, publishing organization, publication date, and a brief description of what it covers. Focus on items published or significantly updated in the last 12 months." },
          ],
          max_tokens: 2000,
          temperature: 0.2,
        });
        answer = response.choices?.[0]?.message?.content?.trim() || "";
      }

      if (!answer) continue;

      const { getClientForModel, getModelForTierAsync } = await import("./providers");
      const modelId = await getModelForTierAsync("balanced", tenantId);
      const { client, actualModelId } = await getClientForModel(modelId, tenantId);

      const extractPrompt = `Given this research about AI agent governance frameworks:

${answer}

${citations.length > 0 ? `Sources: ${citations.join(", ")}` : ""}

We already track these frameworks:
${existing.map((f: any) => `- ${f.name} (${f.organization}, ${f.version})`).join("\n")}

Extract any NEW frameworks/standards/regulations NOT in our list above. Also note any significant updates to our existing frameworks.

Respond in this exact JSON format (no markdown, raw JSON only):
{
  "new_frameworks": [
    {
      "name": "Full framework name",
      "organization": "Publishing organization",
      "version": "Version or publication date",
      "source_url": "URL if found, or null",
      "category": "government_standard or industry_framework",
      "description": "2-3 sentence description",
      "key_principles": ["principle 1", "principle 2"],
      "relevance_score": 1-10
    }
  ],
  "existing_updates": [
    {
      "framework_name": "Name matching our existing framework",
      "update_summary": "What changed",
      "new_version": "New version if applicable"
    }
  ]
}`;

      const extractResponse = await client.chat.completions.create({
        model: actualModelId,
        messages: [{ role: "user", content: extractPrompt }],
        max_tokens: 2000,
        temperature: 0.1,
      });

      const extractContent = extractResponse.choices?.[0]?.message?.content?.trim() || "";
      try {
        const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.new_frameworks) allDiscoveries.push(...parsed.new_frameworks);
          if (parsed.existing_updates) {
            for (const upd of parsed.existing_updates) {
              const match = existing.find((e: any) =>
                e.name.toLowerCase().includes(upd.framework_name?.toLowerCase()?.substring(0, 20))
              );
              if (match) {
                await db.execute(sql`
                  UPDATE governance_frameworks SET
                    review_notes = ${`Quarterly scan ${new Date().toISOString().split("T")[0]}: ${upd.update_summary}${upd.new_version ? ` New version: ${upd.new_version}` : ""}`},
                    updated_at = NOW()
                  WHERE tenant_id = ${tenantId} AND name = ${match.name}
                `);
                existingUpdated++;
                details.push(`Updated notes for "${match.name}": ${upd.update_summary}`);
              }
            }
          }
        }
      } catch {}
    } catch (err: any) {
      details.push(`Search query failed: ${err.message}`);
    }
  }

  const seen = new Set<string>();
  const uniqueDiscoveries = allDiscoveries.filter((d: any) => {
    if (!d.name || !d.organization) return false;
    const key = d.name.toLowerCase();
    if (seen.has(key)) return false;
    if (existingNames.some((n: string) => key.includes(n.substring(0, 20)) || n.includes(key.substring(0, 20)))) return false;
    seen.add(key);
    return true;
  });

  frameworksDiscovered = uniqueDiscoveries.length;

  const highRelevance = uniqueDiscoveries.filter((d: any) => (d.relevance_score || 0) >= 6);

  for (const fw of highRelevance) {
    try {
      await db.execute(sql`
        INSERT INTO governance_frameworks (tenant_id, name, organization, version, source_url, category, description, key_principles, rules_informed, next_review_date, review_notes, status)
        VALUES (${tenantId}, ${fw.name}, ${fw.organization}, ${fw.version || "Unknown"},
                ${fw.source_url || null}, ${fw.category || "industry_framework"}, ${fw.description || "Discovered by quarterly governance scan."},
                ${JSON.stringify(fw.key_principles || [])}::jsonb, '[]'::jsonb,
                NOW() + INTERVAL '6 months',
                ${`Auto-discovered ${new Date().toISOString().split("T")[0]} by quarterly governance research scan. Relevance: ${fw.relevance_score}/10. Needs human review to map to governance rules.`},
                'active')
      `);
      frameworksAdded++;
      details.push(`Added new framework: "${fw.name}" by ${fw.organization} (relevance ${fw.relevance_score}/10)`);
    } catch (err: any) {
      details.push(`Failed to add "${fw.name}": ${err.message}`);
    }
  }

  if (uniqueDiscoveries.length > highRelevance.length) {
    const lowRelevance = uniqueDiscoveries.filter((d: any) => (d.relevance_score || 0) < 6);
    details.push(`${lowRelevance.length} lower-relevance framework(s) found but not added: ${lowRelevance.map((d: any) => `${d.name} (${d.relevance_score}/10)`).join(", ")}`);
  }

  const summary = `Governance research scan complete: ${frameworksDiscovered} new framework(s) discovered, ${frameworksAdded} added to system, ${existingUpdated} existing framework(s) updated with new notes.`;
  console.log(`[quarterly-intel] ${summary}`);

  if (frameworksAdded > 0 || existingUpdated > 0) {
    await postToChannel(tenantId, "#system-alerts",
      `[Quarterly Governance Research Scan]\n${frameworksDiscovered} framework(s) discovered, ${frameworksAdded} added, ${existingUpdated} existing updated.\n\nDetails:\n${details.slice(0, 10).map(d => "• " + d).join("\n")}\n\nNew frameworks need human review to map governance rules.`);
  }

  return { frameworksDiscovered, frameworksAdded, existingUpdated, summary, details };
}

export async function runModelRegistryRefresh(tenantId: number = 1): Promise<{
  modelsChecked: number;
  modelsAdded: number;
  modelsUpdated: number;
  modelsDeprecated: number;
  summary: string;
  details: string[];
}> {
  console.log("[quarterly-intel] Starting model registry refresh...");
  const details: string[] = [];
  let modelsAdded = 0;
  let modelsUpdated = 0;
  let modelsDeprecated = 0;

  const { MODEL_REGISTRY } = await import("./providers");
  const currentModels = MODEL_REGISTRY.map(m => ({
    id: m.id, label: m.label, provider: m.provider, tier: m.tier, description: m.description,
  }));

  const { perplexitySearch, isPerplexityAvailable } = await import("./perplexity-search");
  const { getClientForModel, getModelForTierAsync } = await import("./providers");

  let searchAvailable = isPerplexityAvailable();

  const modelQueries = [
    "latest AI language models released 2026 with API access pricing OpenRouter open source LLM",
    "new open source LLM models 2026 low cost high capability API available Qwen DeepSeek Mistral Llama",
    "OpenRouter new models added 2026 cheapest best performance per dollar AI models",
    "deprecated discontinued AI models 2026 model name changes API ID updates GPT Claude Gemini",
  ];

  let rawResearch = "";
  for (const query of modelQueries) {
    try {
      if (searchAvailable) {
        const result = await perplexitySearch(query);
        if (result.success && result.answer) {
          rawResearch += "\n\n--- SEARCH RESULT ---\n" + result.answer;
          if (result.citations?.length) rawResearch += "\nSources: " + result.citations.join(", ");
          continue;
        }
      }

      const modelId = await getModelForTierAsync("balanced", tenantId);
      const { client, actualModelId } = await getClientForModel(modelId, tenantId);
      const response = await client.chat.completions.create({
        model: actualModelId,
        messages: [
          { role: "system", content: "You are an AI industry analyst tracking all major LLM releases, API changes, and pricing updates." },
          { role: "user", content: query },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      });
      rawResearch += "\n\n--- RESEARCH ---\n" + (response.choices?.[0]?.message?.content || "");
    } catch (err: any) {
      details.push(`Model research query failed: ${err.message}`);
    }
  }

  if (!rawResearch.trim()) {
    const summary = "Model registry refresh failed: no research data obtained.";
    return { modelsChecked: currentModels.length, modelsAdded: 0, modelsUpdated: 0, modelsDeprecated: 0, summary, details };
  }

  const modelId = await getModelForTierAsync("balanced", tenantId);
  const { client, actualModelId } = await getClientForModel(modelId, tenantId);

  const analysisPrompt = `You are analyzing the AI model landscape to update our model registry.

CURRENT MODEL REGISTRY (${currentModels.length} models):
${currentModels.map(m => `- ${m.id} | ${m.label} | ${m.provider} | ${m.tier} | ${m.description}`).join("\n")}

RESEARCH DATA:
${rawResearch.substring(0, 6000)}

Analyze and respond in this exact JSON format (no markdown, raw JSON only):
{
  "new_models": [
    {
      "id": "provider/model-id for OpenRouter, or direct ID",
      "label": "Display name",
      "provider": "openrouter|openai|anthropic|google|xai",
      "tier": "fast|balanced|powerful|reasoning",
      "description": "Brief description with pricing if known",
      "capabilities": ["code", "tools", "vision"],
      "priority": 1-10,
      "rationale": "Why this model is worth adding"
    }
  ],
  "id_updates": [
    {
      "old_id": "current model ID in our registry",
      "new_id": "updated model ID",
      "reason": "Why the ID changed"
    }
  ],
  "deprecated": [
    {
      "id": "model ID to mark as deprecated",
      "reason": "Why it should be removed",
      "replacement": "suggested replacement model ID or null"
    }
  ],
  "market_summary": "2-3 sentence summary of the current LLM market state and trends"
}

IMPORTANT GUIDELINES:
- Focus on models available via OpenRouter (prefix with provider/model-id format) for open source models
- Prioritize models with excellent cost-to-performance ratio
- Only suggest models with confirmed API availability
- For open source models, prefer those with $0.50/M input tokens or less
- Mark models as deprecated ONLY if they have been officially discontinued by their provider`;

  try {
    const analysisResponse = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "user", content: analysisPrompt }],
      max_tokens: 3000,
      temperature: 0.2,
    });

    const content = analysisResponse.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      details.push("AI analysis returned unparseable response");
      return { modelsChecked: currentModels.length, modelsAdded: 0, modelsUpdated: 0, modelsDeprecated: 0, summary: "Model refresh completed but analysis was unparseable.", details };
    }

    const analysis = JSON.parse(jsonMatch[0]);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS model_registry_updates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        update_type TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_data JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    if (analysis.new_models?.length > 0) {
      const highPriority = analysis.new_models.filter((m: any) => (m.priority || 0) >= 6);
      for (const m of highPriority) {
        const existsAlready = currentModels.some(cm => cm.id === m.id);
        if (existsAlready) continue;
        await db.execute(sql`
          INSERT INTO model_registry_updates (tenant_id, update_type, model_id, model_data, status)
          VALUES (${tenantId}, 'add', ${m.id}, ${JSON.stringify(m)}::jsonb, 'pending')
        `);
        modelsAdded++;
        details.push(`Queued new model: ${m.label} (${m.id}) — ${m.rationale}`);
      }

      if (analysis.new_models.length > highPriority.length) {
        const lowPriority = analysis.new_models.filter((m: any) => (m.priority || 0) < 6);
        details.push(`${lowPriority.length} lower-priority model(s) noted but not queued: ${lowPriority.map((m: any) => m.label).join(", ")}`);
      }
    }

    if (analysis.id_updates?.length > 0) {
      for (const upd of analysis.id_updates) {
        const exists = currentModels.some(cm => cm.id === upd.old_id);
        if (!exists) continue;
        await db.execute(sql`
          INSERT INTO model_registry_updates (tenant_id, update_type, model_id, model_data, status)
          VALUES (${tenantId}, 'id_change', ${upd.old_id}, ${JSON.stringify(upd)}::jsonb, 'pending')
        `);
        modelsUpdated++;
        details.push(`Model ID change: ${upd.old_id} -> ${upd.new_id} (${upd.reason})`);
      }
    }

    if (analysis.deprecated?.length > 0) {
      for (const dep of analysis.deprecated) {
        const exists = currentModels.some(cm => cm.id === dep.id);
        if (!exists) continue;
        await db.execute(sql`
          INSERT INTO model_registry_updates (tenant_id, update_type, model_id, model_data, status)
          VALUES (${tenantId}, 'deprecate', ${dep.id}, ${JSON.stringify(dep)}::jsonb, 'pending')
        `);
        modelsDeprecated++;
        details.push(`Model deprecated: ${dep.id} — ${dep.reason}${dep.replacement ? ` (replacement: ${dep.replacement})` : ""}`);
      }
    }

    if (analysis.market_summary) {
      details.push(`Market summary: ${analysis.market_summary}`);
    }

    if (modelsAdded > 0 || modelsUpdated > 0 || modelsDeprecated > 0) {
      await postToChannel(tenantId, "#system-alerts",
        `[Quarterly Model Registry Refresh]\n${modelsAdded} new model(s) queued for review\n${modelsUpdated} model ID change(s) detected\n${modelsDeprecated} model(s) flagged as deprecated\n\nDetails:\n${details.slice(0, 10).map(d => "• " + d).join("\n")}\n\nPending updates require human approval in Settings > Model Registry.`);
    }

  } catch (err: any) {
    details.push(`Analysis failed: ${err.message}`);
  }

  const summary = `Model registry refresh: ${currentModels.length} models checked, ${modelsAdded} new model(s) queued, ${modelsUpdated} ID update(s), ${modelsDeprecated} deprecation(s). All changes pending human approval.`;
  console.log(`[quarterly-intel] ${summary}`);

  return { modelsChecked: currentModels.length, modelsAdded, modelsUpdated, modelsDeprecated, summary, details };
}
