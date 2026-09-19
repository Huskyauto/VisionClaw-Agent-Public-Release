import { storage } from "./storage";

import { logSilentCatch } from "./lib/silent-catch";
interface TokenEstimate {
  component: string;
  label: string;
  count: number;
  estimatedTokens: number;
  details?: string[];
}

interface BudgetReport {
  totalTokens: number;
  contextWindow: number;
  usedPercent: number;
  availableTokens: number;
  components: TokenEstimate[];
  warnings: string[];
  optimizations: { action: string; savings: number }[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export async function runContextBudgetAudit(tenantId: number, personaId?: number): Promise<BudgetReport> {
  // R74.13f fail-closed: removed `tenantId: number = 1` default. Sole
  // caller (server/tools.ts:7155 context_budget_audit tool) passes
  // params._tenantId explicitly. The default was dead code that would
  // have silently audited tenant 1's context if a future caller forgot
  // to pass — better to surface the missing-context bug at runtime.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`runContextBudgetAudit requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  const components: TokenEstimate[] = [];
  const warnings: string[] = [];
  const optimizations: { action: string; savings: number }[] = [];
  const CONTEXT_WINDOW = 200_000;

  const personas = await storage.getPersonas();
  const activePersonas = personas.filter(p => p.isActive);
  let personaTokens = 0;
  const personaDetails: string[] = [];
  for (const p of activePersonas) {
    const promptLen = estimateTokens((p as any).systemPrompt || "");
    const toolsLen = estimateTokens(p.toolsDoc || "");
    const total = promptLen + toolsLen;
    personaTokens += total;
    personaDetails.push(`${p.name}: ${total} tokens (prompt: ${promptLen}, tools: ${toolsLen})`);
    if (total > 3000) {
      warnings.push(`Persona "${p.name}" has heavy system prompt (${total} tokens)`);
      optimizations.push({
        action: `Trim "${p.name}" system prompt (currently ${total} tokens)`,
        savings: Math.floor(total * 0.3),
      });
    }
  }
  components.push({
    component: "personas",
    label: "Persona System Prompts",
    count: activePersonas.length,
    estimatedTokens: personaTokens,
    details: personaDetails,
  });

  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");

    const toolsResult = await db.execute(sql`
      SELECT count(*) as cnt FROM (
        SELECT unnest(ARRAY[
          'recall_context','write_file','send_email','delegate_task','generate_audio',
          'create_slides','browser','firecrawl_scrape','google_drive','create_pdf'
        ]) as name
      ) t
    `);

    const toolDefs = (await import("./tools")).TOOL_DEFINITIONS || [];
    let toolTokens = 0;
    const heavyTools: string[] = [];
    for (const t of toolDefs) {
      const defStr = JSON.stringify(t);
      const tokens = estimateTokens(defStr);
      toolTokens += tokens;
      if (tokens > 500) {
        heavyTools.push(`${t.function?.name}: ${tokens} tokens`);
      }
    }
    components.push({
      component: "tools",
      label: "Tool Definitions",
      count: toolDefs.length,
      estimatedTokens: toolTokens,
      details: heavyTools.length > 0 ? [`Heavy tools (>500 tokens): ${heavyTools.length}`, ...heavyTools.slice(0, 10)] : undefined,
    });
    if (toolTokens > 15000) {
      warnings.push(`Tool definitions consume ${toolTokens} tokens — consider pruning rarely-used tools`);
      optimizations.push({
        action: "Remove or consolidate heavy tool definitions",
        savings: Math.floor(toolTokens * 0.2),
      });
    }

    const skillsResult = await db.execute(sql`
      SELECT name, LENGTH(COALESCE(prompt_content, '')) as len FROM skills WHERE enabled = true
    `);
    const skillRows = (skillsResult as any).rows || skillsResult;
    let skillTokens = 0;
    const skillDetails: string[] = [];
    for (const s of skillRows || []) {
      const tokens = estimateTokens(String(s.len || 0).padStart(1));
      const actualTokens = Math.ceil((Number(s.len) || 0) / 3.5);
      skillTokens += actualTokens;
      if (actualTokens > 2000) {
        skillDetails.push(`${s.name}: ${actualTokens} tokens`);
      }
    }
    components.push({
      component: "skills",
      label: "Active Skills",
      count: (skillRows || []).length,
      estimatedTokens: skillTokens,
      details: skillDetails.length > 0 ? skillDetails : undefined,
    });

    const memResult = await db.execute(sql`
      SELECT count(*) as cnt, SUM(LENGTH(COALESCE(fact,''))) as total_len 
      FROM memory_entries WHERE tenant_id = ${tenantId}
    `);
    const memRows = (memResult as any).rows || memResult;
    const memCount = Number(memRows?.[0]?.cnt || 0);
    const memLen = Number(memRows?.[0]?.total_len || 0);
    const memTokens = Math.ceil(memLen / 3.5);
    components.push({
      component: "memories",
      label: "Memory Entries (potential injection)",
      count: memCount,
      estimatedTokens: Math.min(memTokens, 5000),
      details: [`Total memory text: ${Math.round(memLen / 1024)}KB`, `Per-query injection cap: ~5000 tokens (7 memories)`],
    });

    const rulesResult = await db.execute(sql`SELECT count(*) as cnt FROM governance_rules`);
    const rulesRows = (rulesResult as any).rows || rulesResult;
    const ruleCount = Number(rulesRows?.[0]?.cnt || 0);
    const ruleTokens = ruleCount * 50;
    components.push({
      component: "governance",
      label: "Governance Rules",
      count: ruleCount,
      estimatedTokens: ruleTokens,
    });

    const expansionModules = [
      { name: "Trust Engine", est: 400 },
      { name: "Express Lanes", est: 200 },
      { name: "Proactive Engine", est: 300 },
      { name: "Environmental Awareness", est: 250 },
      { name: "Collective Intelligence", est: 350 },
      { name: "Instinct Learning", est: 400 },
      { name: "Project Context", est: 500 },
      { name: "User Context", est: 150 },
    ];
    const expansionTotal = expansionModules.reduce((s, m) => s + m.est, 0);
    components.push({
      component: "agency_expansion",
      label: "Agency Expansion Context Blocks",
      count: expansionModules.length,
      estimatedTokens: expansionTotal,
      details: expansionModules.map(m => `${m.name}: ~${m.est} tokens`),
    });

  } catch (err: any) {
    warnings.push(`DB query error: ${err.message}`);
  }

  const totalTokens = components.reduce((s, c) => s + c.estimatedTokens, 0);
  const usedPercent = Math.round((totalTokens / CONTEXT_WINDOW) * 100);
  const availableTokens = CONTEXT_WINDOW - totalTokens;

  if (usedPercent > 40) {
    warnings.push(`System overhead uses ${usedPercent}% of context window — leaves less room for conversation history`);
  }

  optimizations.sort((a, b) => b.savings - a.savings);

  return {
    totalTokens,
    contextWindow: CONTEXT_WINDOW,
    usedPercent,
    availableTokens,
    components,
    warnings,
    optimizations: optimizations.slice(0, 5),
  };
}

export function formatBudgetReport(report: BudgetReport): string {
  let out = `\n═══ Context Budget Report ═══\n`;
  out += `Total estimated overhead: ~${report.totalTokens.toLocaleString()} tokens\n`;
  out += `Context window: ${(report.contextWindow / 1000)}K tokens\n`;
  out += `Used: ${report.usedPercent}% | Available: ~${report.availableTokens.toLocaleString()} tokens\n\n`;

  out += `Component Breakdown:\n`;
  out += `${"Component".padEnd(30)} ${"Count".padStart(6)} ${"Tokens".padStart(8)}\n`;
  out += `${"─".repeat(46)}\n`;
  for (const c of report.components) {
    out += `${c.label.padEnd(30)} ${String(c.count).padStart(6)} ${("~" + c.estimatedTokens.toLocaleString()).padStart(8)}\n`;
  }

  if (report.warnings.length > 0) {
    out += `\nWarnings (${report.warnings.length}):\n`;
    report.warnings.forEach(w => out += `  ⚠ ${w}\n`);
  }

  if (report.optimizations.length > 0) {
    out += `\nTop Optimizations:\n`;
    report.optimizations.forEach((o, i) => {
      out += `  ${i + 1}. ${o.action} → save ~${o.savings.toLocaleString()} tokens\n`;
    });
    const totalSavings = report.optimizations.reduce((s, o) => s + o.savings, 0);
    out += `  Potential savings: ~${totalSavings.toLocaleString()} tokens (${Math.round((totalSavings / report.totalTokens) * 100)}% of overhead)\n`;
  }

  return out;
}

export async function runHarnessOptimizer(tenantId: number): Promise<string> {
  // R74.13f fail-closed: removed `= 1` default. Same shape as
  // runContextBudgetAudit above — required so any caller is forced
  // to pass explicitly.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`runHarnessOptimizer requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
  const report = await runContextBudgetAudit(tenantId);
  const suggestions: string[] = [];

  if (report.usedPercent > 30) {
    suggestions.push(`System overhead is ${report.usedPercent}% of context window — trim heavy prompts to free conversation space`);
  }

  for (const c of report.components) {
    if (c.component === "tools" && c.estimatedTokens > 12000) {
      suggestions.push(`Tool definitions use ~${c.estimatedTokens.toLocaleString()} tokens — consider lazy-loading tools based on persona role`);
    }
    if (c.component === "personas" && c.estimatedTokens > 8000) {
      suggestions.push(`Persona prompts use ~${c.estimatedTokens.toLocaleString()} tokens total — audit and compress verbose prompts`);
    }
  }

  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");

    const recentEvals = await db.execute(sql`
      SELECT persona_name, 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE passed = true) as passed,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_ms
      FROM agent_evals 
      WHERE tenant_id = ${tenantId} AND status = 'completed'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY persona_name
    `);
    const evalRows = (recentEvals as any).rows || recentEvals;
    for (const r of evalRows || []) {
      const passRate = Number(r.passed) / Number(r.total);
      if (passRate < 0.6) {
        suggestions.push(`"${r.persona_name}" has low eval pass rate (${Math.round(passRate * 100)}%) — review system prompt or model assignment`);
      }
      if (Number(r.avg_ms) > 30000) {
        suggestions.push(`"${r.persona_name}" averaging ${Math.round(Number(r.avg_ms) / 1000)}s per eval — consider faster model or simpler prompt`);
      }
    }

    const recentErrors = await db.execute(sql`
      SELECT persona_name, COUNT(*) as error_count
      FROM agent_evals
      WHERE tenant_id = ${tenantId} AND error IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY persona_name
      HAVING COUNT(*) >= 3
    `);
    const errorRows = (recentErrors as any).rows || recentErrors;
    for (const r of errorRows || []) {
      suggestions.push(`"${r.persona_name}" had ${r.error_count} eval errors this week — investigate reliability`);
    }
  } catch (_silentErr) { logSilentCatch("server/context-budget.ts", _silentErr); }

  if (suggestions.length === 0) {
    return "Harness optimizer: all metrics nominal. No changes recommended.";
  }

  let output = `═══ Harness Optimizer Report ═══\n`;
  output += `Found ${suggestions.length} optimization${suggestions.length > 1 ? "s" : ""}:\n\n`;
  suggestions.forEach((s, i) => output += `${i + 1}. ${s}\n`);
  output += `\nContext budget: ${report.usedPercent}% overhead (${report.totalTokens.toLocaleString()} tokens)`;

  return output;
}
