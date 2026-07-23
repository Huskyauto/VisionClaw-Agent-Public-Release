import { db } from "./db";
import { messages, conversations, personas } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { getClientForModel } from "./providers";
import { storage } from "./storage";

import { logSilentCatch } from "./lib/silent-catch";
import { sanitizeUntrusted } from "./lib/sanitize-untrusted";
interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
}

interface DelegationStep {
  targetAgent: string;
  taskName: string;
}

interface ConversationAnalysis {
  toolSequence: ToolCall[];
  delegations: DelegationStep[];
  userCorrections: string[];
  totalMessages: number;
  personaName: string;
  conversationTitle: string;
}

interface SkillDefinition {
  name: string;
  description: string;
  steps: string[];
  requiredTools: string[];
  requiredPersonas: string[];
  successCriteria: string[];
  promptContent: string;
  appliesWhen?: string;
  activationProbes?: { related?: string[]; unrelated?: string[] };
}

interface FailureSkillDefinition {
  name: string;
  description: string;
  failurePoint: string;
  flawedReasoning: string;
  whatShouldHaveBeenDone: string;
  preventionPrinciple: string;
  appliesWhen: string;
  promptContent: string;
}

export type SkillifyMode = "success" | "failure";

export interface DistillResult {
  worthSkillifying: boolean;
  reason: string;
  intent?: string;
  scopeHint?: string;
}

const DISTILL_PROMPT = `You are the FIRST stage of a two-stage skill-learning pipeline. Your only job is to decide whether the conversation below contains a reusable lesson worth distilling into a full skill.

Be strict. Most conversations are NOT worth skillifying — they are routine, one-off, or so trivial that the lesson is "just do the obvious thing." Saying NO is the correct answer most of the time. Saying YES creates work for the expensive stage-2 LLM and clutters the skill library with noise.

Say YES only when:
- The conversation contains a non-obvious approach, sequence, or workaround a future agent would not figure out from scratch.
- OR a clear failure with a specific lesson that prevents repeating it.
- AND the lesson is scoped to a specific website / API / tool / environment (not a generic "be careful").

Say NO when:
- The work is routine and any agent would do it the same way.
- The "lesson" is too generic to be useful ("validate inputs", "handle errors").
- The conversation is mostly chitchat or status updates.
- A near-duplicate skill almost certainly already exists.

Respond with ONLY valid JSON:
{
  "worthSkillifying": true | false,
  "reason": "one-sentence justification",
  "intent": "(only if worthSkillifying) what the conversation was trying to accomplish",
  "scopeHint": "(only if worthSkillifying) the specific website / API / tool / environment the lesson applies to"
}`;

export async function distillIntent(
  conversationId: number,
  tenantId: number,
  mode: SkillifyMode = "success",
): Promise<DistillResult> {
  try {
    const analysis = await analyzeConversation(conversationId, tenantId);

    const recentMsgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(12);

    const excerpt = recentMsgs.reverse().map(m => {
      const clean = m.content.replace(/^<!-- tools:[\s\S]*? -->\n?/, "").trim();
      // R125+13.17+sec — untrusted message content (user input + scraped/email/
      // webhook bodies) flows into the distillation LLM call. Without sanitize
      // a `<|endoftext|>` / `### IGNORE PREVIOUS` payload could hijack the
      // skill-distillation prompt. Architect HIGH finding.
      const safe = sanitizeUntrusted(clean, { maxBytes: 200 });
      return `[${m.role}]: ${safe}`;
    }).join("\n");

    const orderedToolNames = analysis.toolSequence.map(t => t.name);
    const uniqueTools = [...new Set(orderedToolNames)];

    const summary = `Mode: ${mode}
Persona: ${analysis.personaName}
Title: ${analysis.conversationTitle}
Tools (${uniqueTools.length} unique): ${uniqueTools.join(", ") || "none"}
Tool sequence: ${orderedToolNames.join(" → ") || "none"}
User corrections (${analysis.userCorrections.length}): ${analysis.userCorrections.slice(0, 3).join(" | ") || "none"}

Recent messages:
${excerpt}`;

    const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId, {});

    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: DISTILL_PROMPT },
        { role: "user", content: summary },
      ],
      max_completion_tokens: 300,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { worthSkillifying: false, reason: "distill-stage returned no parseable JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as DistillResult;
    return {
      worthSkillifying: !!parsed.worthSkillifying,
      reason: parsed.reason || "(no reason given)",
      intent: parsed.intent,
      scopeHint: parsed.scopeHint,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[skillify:distill] Failed:`, message);
    return { worthSkillifying: false, reason: `distill error: ${message}` };
  }
}

function parseToolMetadata(content: string): ToolCall[] {
  const match = content.match(/^\s*<!-- tools:([\s\S]*?) -->/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t: { name?: string }) => t.name && typeof t.name === "string")
      .map((t: { name: string; input?: Record<string, unknown> }) => ({
        name: t.name,
        input: t.input,
      }));
  } catch {
    return [];
  }
}

function extractDelegationsFromTools(tools: ToolCall[]): DelegationStep[] {
  const delegations: DelegationStep[] = [];
  for (const t of tools) {
    if (t.name === "delegate_task" && t.input) {
      const targetAgent = String(t.input.targetAgent || "");
      const taskName = String(t.input.taskName || t.input.description || "");
      if (targetAgent) {
        delegations.push({ targetAgent, taskName });
      }
    }
  }
  return delegations;
}

function extractUserCorrections(msgs: { role: string; content: string }[]): string[] {
  const corrections: string[] = [];
  const correctionPattern = /\b(no|wrong|incorrect|fix|change|instead|actually|not what|redo|try again|different)\b/i;

  for (const m of msgs) {
    if (m.role === "user" && correctionPattern.test(m.content)) {
      corrections.push(m.content.slice(0, 200));
    }
  }

  return corrections;
}

async function analyzeConversation(conversationId: number, tenantId: number): Promise<ConversationAnalysis> {
  const conv = await db.select().from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
    .limit(1);
  if (!conv.length) throw new Error(`Conversation ${conversationId} not found`);

  const msgs = await db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  const orderedTools: ToolCall[] = [];
  const allDelegations: DelegationStep[] = [];

  for (const m of msgs) {
    if (m.role === "assistant") {
      const tools = parseToolMetadata(m.content);
      orderedTools.push(...tools);
      allDelegations.push(...extractDelegationsFromTools(tools));
    }
  }

  const userCorrections = extractUserCorrections(msgs.map(m => ({ role: m.role, content: m.content })));

  let personaName = "VisionClaw";
  if (conv[0].personaId) {
    try {
      const personaRows = await db.select({ name: personas.name })
        .from(personas)
        .where(eq(personas.id, conv[0].personaId))
        .limit(1);
      if (personaRows[0]?.name) {
        personaName = personaRows[0].name;
      }
    } catch (_silentErr) { logSilentCatch("server/skillify.ts", _silentErr); }
  }

  return {
    toolSequence: orderedTools,
    delegations: allDelegations,
    userCorrections,
    totalMessages: msgs.length,
    personaName,
    conversationTitle: conv[0].title,
  };
}

const SKILLIFY_PROMPT = `You are a skill extraction engine for an AI agent platform. Analyze the conversation summary below and produce a reusable skill definition.

A skill is a set of instructions that teaches an AI agent how to reliably complete a specific type of task. It includes:
- A clear name and description
- Step-by-step instructions
- Which tools to use and when
- Which specialist agents to delegate to
- Success criteria
- The specific conditions under which this approach applies (\`appliesWhen\`)

Rules:
- Steps should be concrete and actionable, not vague
- Include error handling guidance ("if X fails, try Y")
- Reference specific tool names the agent should use
- If user corrections were made, incorporate the corrected approach
- Success criteria should be measurable or verifiable
- The promptContent should be the full instruction set, written as if speaking to the agent
- **appliesWhen MUST scope the skill to its real context.** Include the website, API, tool, service, domain, or environment that the lesson actually came from. Do NOT over-generalize — if the task was about agenticcorporation.net, say so. If it was about Stripe checkout webhooks, say so. A skill that claims to apply "everywhere" is rarely useful anywhere.
- **activationProbes is a trigger-precision test set.** Provide ~5 \`related\` queries a user might phrase that SHOULD make this skill surface, and ~3 \`unrelated\` queries from clearly different domains that should NOT surface it. These are used to verify the skill's description discriminates its real scope from noise — so make the related ones realistically varied, and the unrelated ones genuinely off-topic (not near-misses).

Respond with ONLY valid JSON:
{
  "name": "skill_name_here",
  "description": "One-line description",
  "steps": ["Step 1: ...", "Step 2: ..."],
  "requiredTools": ["tool_name_1", "tool_name_2"],
  "requiredPersonas": ["Persona Name"],
  "successCriteria": ["Criterion 1", "Criterion 2"],
  "appliesWhen": "Specific website / API / tool / environment this skill applies to",
  "promptContent": "Full instruction text for the agent...",
  "activationProbes": { "related": ["query that should trigger it", "..."], "unrelated": ["off-topic query that should not", "..."] }
}`;

const FAILURE_SKILLIFY_PROMPT = `You are a failure-analysis engine for an AI agent platform. The conversation below represents a task that FAILED. Your job is to distill the failure into a reusable lesson that prevents the same mistake next time.

Focus on actionable lessons, not blame. The most valuable field is \`whatShouldHaveBeenDone\` — that is what future agents will read and apply.

Rules:
- failurePoint: where the approach went wrong; cite specific actions / tools / decisions (2-3 sentences)
- flawedReasoning: the incorrect assumption or bad action that caused the failure (2-3 sentences)
- whatShouldHaveBeenDone: the correct approach — most valuable field, be concrete and tool-specific (2-3 sentences)
- preventionPrinciple: general rule that would prevent this class of failure (1-2 sentences)
- **appliesWhen MUST scope the lesson to its real context.** Include the website, API, tool, service, or environment where this failure happened. Do NOT over-generalize — if it failed on agenticcorporation.net specifically, say so. A failure-lesson that claims to apply "everywhere" is noise.
- promptContent: a self-contained instruction block future agents will read; lead with the prevention principle, then the corrected approach.

Respond with ONLY valid JSON:
{
  "name": "Auto: Avoid: <short failure-class name>",
  "description": "One-line description of the failure to avoid",
  "failurePoint": "Where it went wrong",
  "flawedReasoning": "Why the agent did the wrong thing",
  "whatShouldHaveBeenDone": "The correct approach next time",
  "preventionPrinciple": "Generalizable rule",
  "appliesWhen": "Specific website / API / tool / environment this lesson scopes to",
  "promptContent": "Full instruction text for the agent..."
}`;

export async function skillifyConversation(
  conversationId: number,
  tenantId: number,
  suggestedName?: string,
  personaId?: number | null,
  mode: SkillifyMode = "success",
): Promise<{ skill?: { id: number; name: string; description: string }; error?: string }> {
  try {
    const analysis = await analyzeConversation(conversationId, tenantId);

    const minMessages = mode === "failure" ? 3 : 4;
    if (analysis.totalMessages < minMessages) {
      return { error: `Conversation is too short to extract a meaningful ${mode} skill. Need at least ${minMessages} messages.` };
    }

    const uniqueTools = [...new Set(analysis.toolSequence.map(t => t.name))];
    const orderedToolNames = analysis.toolSequence.map(t => t.name);
    const uniquePersonas = [...new Set(analysis.delegations.map(d => d.targetAgent))];

    const summaryForLLM = `Conversation: "${analysis.conversationTitle}"
Lead Agent: ${analysis.personaName}
Total messages: ${analysis.totalMessages}
Tool execution sequence (${orderedToolNames.length} calls): ${orderedToolNames.join(" → ") || "none detected"}
Unique tools (${uniqueTools.length}): ${uniqueTools.join(", ") || "none"}
Delegations (${analysis.delegations.length}): ${analysis.delegations.map(d => `${d.targetAgent}: ${d.taskName}`).join("; ") || "none"}
Agents involved: ${[analysis.personaName, ...uniquePersonas].join(", ")}
User corrections (${analysis.userCorrections.length}): ${analysis.userCorrections.join(" | ") || "none"}
${suggestedName ? `Suggested skill name: "${suggestedName}"` : ""}

Recent conversation excerpt (last messages):`;

    const recentMsgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);

    const excerpt = recentMsgs.reverse().map(m => {
      const clean = m.content.replace(/^<!-- tools:[\s\S]*? -->\n?/, "").trim();
      // Untrusted conversation content (user/scraped/email) feeds an LLM that
      // extracts platform-wide skills/lessons — sanitize against prompt
      // injection, mirroring distillIntent's Stage-1 handling.
      const safe = sanitizeUntrusted(clean, { maxBytes: 300 });
      return `[${m.role}]: ${safe}`;
    }).join("\n");

    const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId, {});

    const systemPrompt = mode === "failure" ? FAILURE_SKILLIFY_PROMPT : SKILLIFY_PROMPT;
    const userHeader = mode === "failure"
      ? `The following task FAILED. Distill the failure into a reusable lesson.\n\n${summaryForLLM}`
      : summaryForLLM;

    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userHeader}\n${excerpt}` },
      ],
      max_completion_tokens: 2000,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "Could not parse skill definition from LLM response" };
    }

    let skillName: string;
    let description: string;
    let fullPromptContent: string;
    let category: string;
    let appliesWhen: string | undefined;
    let activationProbes: { related: string[]; unrelated: string[] } | null = null;

    if (mode === "failure") {
      const failDef: FailureSkillDefinition = JSON.parse(jsonMatch[0]);
      if (!failDef.name || !failDef.description || !failDef.whatShouldHaveBeenDone || !failDef.appliesWhen) {
        return { error: "LLM produced incomplete failure-skill definition (missing name, description, whatShouldHaveBeenDone, or appliesWhen)" };
      }
      skillName = suggestedName || failDef.name;
      description = failDef.description;
      appliesWhen = failDef.appliesWhen;
      category = "learned-failure";

      const sections = [
        `APPLIES WHEN: ${failDef.appliesWhen}`,
        `PREVENTION PRINCIPLE: ${failDef.preventionPrinciple}`,
        ``,
        failDef.promptContent,
        ``,
        `WHAT SHOULD HAVE BEEN DONE:`,
        failDef.whatShouldHaveBeenDone,
        ``,
        `FAILURE POINT (what went wrong):`,
        failDef.failurePoint,
        ``,
        `FLAWED REASONING (why):`,
        failDef.flawedReasoning,
      ];
      fullPromptContent = sections.join("\n");
    } else {
      const skillDef: SkillDefinition = JSON.parse(jsonMatch[0]);
      if (!skillDef.name || !skillDef.description || !skillDef.promptContent) {
        return { error: "LLM produced incomplete skill definition (missing name, description, or promptContent)" };
      }
      const concreteSteps = Array.isArray(skillDef.steps)
        ? skillDef.steps.filter(s => typeof s === "string" && s.trim().length > 0)
        : [];
      if (concreteSteps.length < 2) {
        return { error: "Skill rejected: fewer than 2 concrete steps — too thin to auto-enable." };
      }
      const scope = (skillDef.appliesWhen || "").trim();
      const genericScope = /^(every(where|thing)?|any(thing|where)?|all|general|generic|n\/?a|none)\.?$/i;
      if (scope.length < 8 || genericScope.test(scope)) {
        return { error: "Skill rejected: appliesWhen is missing or too generic to auto-enable (must scope to a specific site / API / tool / environment)." };
      }
      skillName = suggestedName || skillDef.name;
      description = skillDef.description;
      appliesWhen = skillDef.appliesWhen;
      category = "learned";

      const ap = skillDef.activationProbes;
      if (ap && typeof ap === "object") {
        const clean = (arr: unknown): string[] =>
          (Array.isArray(arr) ? arr : [])
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, 8)
            .map(s => s.trim().slice(0, 300));
        activationProbes = { related: clean(ap.related), unrelated: clean(ap.unrelated) };
      }

      const appliesSection = skillDef.appliesWhen
        ? `APPLIES WHEN: ${skillDef.appliesWhen}\n\n`
        : "";
      const stepsSection = skillDef.steps?.length
        ? `\n\nSTEPS:\n${skillDef.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        : "";
      const toolsSection = skillDef.requiredTools?.length
        ? `\n\nREQUIRED TOOLS: ${skillDef.requiredTools.join(", ")}`
        : "";
      const personasSection = skillDef.requiredPersonas?.length
        ? `\n\nDELEGATE TO: ${skillDef.requiredPersonas.join(", ")}`
        : "";
      const criteriaSection = skillDef.successCriteria?.length
        ? `\n\nSUCCESS CRITERIA:\n${skillDef.successCriteria.map(c => `- ${c}`).join("\n")}`
        : "";

      fullPromptContent = `${appliesSection}${skillDef.promptContent}${stepsSection}${toolsSection}${personasSection}${criteriaSection}`;
    }

    // Defang the LLM-distilled artifact BEFORE the jury sees it AND before it
    // is stored, and hard-cap the body — parity with the propose_skill boundary
    // (R98.23+sec). Without this, an injection payload riding in the source
    // conversation could be copied verbatim into a LIVE global skill prompt
    // (the jury internally reviews a separately-defanged copy, not the stored
    // one, so the stored artifact must be sanitized at THIS boundary too).
    const { sanitizeUntrusted } = await import("./lib/sanitize-untrusted");
    const MAX_SKILL_BODY_CHARS = 8000;
    skillName = sanitizeUntrusted(skillName, { maxBytes: 200 });
    description = sanitizeUntrusted(description, { maxBytes: 1000 });
    fullPromptContent = sanitizeUntrusted(fullPromptContent, { maxBytes: 100000 });
    if (fullPromptContent.length > MAX_SKILL_BODY_CHARS) {
      return { error: `Skill body is ${fullPromptContent.length} chars; max ${MAX_SKILL_BODY_CHARS}. Not auto-created — tighten the distilled skill.` };
    }

    // Jury gate (Bob 2026-06-03): NO skill — auto-distilled OR manually
    // skillified — is enabled without a 3-frontier-model jury reaching a 2-of-3
    // BUILD majority. NO carve-out (Bob's explicit call: gate everything).
    // `skillBuildApproved()` is the single literal guard above
    // storage.createSkill(): majority BUILD ⇒ insert live; majority REJECT ⇒
    // dropped; no clear majority / jury infra error / <3 jurors ⇒ fail-CLOSED
    // ESCALATE (skill NOT created; owner pinged non-blocking — the only case a
    // human is involved). Consistent with R125+3.6 jury-decides-and-ships.
    // Activation / trigger-precision test (advisory, fail-OPEN). Concept from the
    // "Test First: 5 related, 3 unrelated" skill-building step: prove the skill's
    // text discriminates queries it should handle from off-topic noise BEFORE it
    // goes live, since selection is pure semantic similarity. This is a QUALITY
    // signal fed to the jury (it already weighs reusability) — NOT a safety gate,
    // so embedding hiccups or missing probes never block the build.
    let activationSummary = "";
    if (activationProbes && (activationProbes.related.length || activationProbes.unrelated.length)) {
      try {
        const { evaluateActivationPrecision } = await import("./lib/skill-activation-test");
        const { generateEmbedding } = await import("./embeddings");
        const report = await evaluateActivationPrecision({
          skillText: `${skillName}\n${description}\n${fullPromptContent}`.slice(0, 6000),
          relatedProbes: activationProbes.related,
          unrelatedProbes: activationProbes.unrelated,
          embed: generateEmbedding,
        });
        if (report.ran) {
          activationSummary = report.summary;
          console.log(`[skillify] Activation precision "${skillName}": ${report.summary}`);
        }
      } catch (e: any) {
        console.warn(`[skillify] activation precision test skipped (non-fatal): ${e?.message || e}`);
      }
    }

    const { jurySkillBuild, skillBuildApproved } = await import("./lib/jury-skill-build");
    const jury = await jurySkillBuild({
      name: skillName,
      description,
      body: fullPromptContent,
      sourceContext: `${mode} skill distilled from conversation ${conversationId} (appliesWhen: ${appliesWhen || "n/a"})${activationSummary ? ` | activation-precision: ${activationSummary}` : ""}`,
      tenantId,
    });
    const juryLine = jury.votes.map(v => `${v.model}:${v.verdict}`).join(", ") || "(no votes)";

    if (!skillBuildApproved(jury.decision)) {
      if (jury.decision === "escalate") {
        console.log(`[skillify] Jury SPLIT on "${skillName}" — not created, escalating (${juryLine})`);
        void (async () => {
          try {
            const { sendEmail, isEmailConfigured } = await import("./email");
            if (!isEmailConfigured?.()) return;
            const { resolveOwnerEmail } = await import("./lib/owner-email");
            const OWNER_EMAIL = resolveOwnerEmail();
            if (!OWNER_EMAIL) return;
            await sendEmail({
              inboxId: "",
              to: OWNER_EMAIL,
              subject: `[VisionClaw] Skill jury split — '${skillName}' not built`,
              text: `A ${mode} skill distilled from conversation ${conversationId} could NOT get a 2-of-3 jury majority, so it was NOT created.\n\nSkill: ${skillName}\nVotes: ${juryLine}\n\nThis is the only case a skill build needs your eyes — majority BUILD/REJECT verdicts auto-apply with no human in the loop.`,
            });
          } catch (e: any) {
            console.warn(`[skillify] escalate owner-ping failed (non-fatal): ${e?.message || e}`);
          }
        })();
        return { error: `Jury split — no 2/3 majority (${juryLine}). Skill not created; owner notified if email is configured.` };
      }
      console.log(`[skillify] Jury REJECTED "${skillName}" (${jury.majority}/3 REJECT): ${juryLine}`);
      return { error: `Jury declined to build the skill (${jury.majority}/3 REJECT). Not added.` };
    }
    console.log(`[skillify] Jury approved "${skillName}" (${jury.majority}/3 BUILD): ${juryLine}`);

    const created = await storage.createSkill({
      name: skillName,
      description,
      promptContent: fullPromptContent,
      category,
      icon: mode === "failure" ? "AlertTriangle" : "GraduationCap",
      enabled: true,
      personaId: personaId ?? null,
    });

    import("./persona-sync").then(m => m.syncPersonaDocs()).catch(e =>
      console.error("[skillify] Persona sync after skill creation failed:", e.message)
    );

    console.log(`[skillify] Created skill "${skillName}" (ID ${created.id}) from conversation ${conversationId} — ${orderedToolNames.length} tool calls, ${uniquePersonas.length} delegations`);

    return {
      skill: {
        id: created.id,
        name: created.name,
        description: created.description,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[skillify] Failed:`, message);
    return { error: `Skill extraction failed: ${message}` };
  }
}

export function parseToolsFromMessage(content: string): ToolCall[] {
  return parseToolMetadata(content);
}
