import { getClientForModel } from "./providers";

export interface IdeationFramework {
  name: string;
  key: string;
  description: string;
  prompts: string[];
}

export const FRAMEWORKS: IdeationFramework[] = [
  {
    name: "SCAMPER",
    key: "scamper",
    description: "Transform an existing idea by applying seven operations: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse.",
    prompts: [
      "Substitute: What component, material, process, or technology could you swap out?",
      "Combine: What if you merged this with another product, service, or idea?",
      "Adapt: What ideas from other industries or domains could you borrow?",
      "Modify: What if you made it 10x bigger or 10x smaller? Exaggerated one feature?",
      "Put to other uses: Who else could use this? What other problems could it solve?",
      "Eliminate: What happens if you remove a feature entirely? Zero configuration version?",
      "Reverse: What if you did the steps in the opposite order? Reversed the value chain?",
    ],
  },
  {
    name: "First Principles",
    key: "first_principles",
    description: "Break the idea down to fundamental truths, challenge every assumption, and rebuild from scratch.",
    prompts: [
      "What do we know is actually true — not assumed, not conventional?",
      "What are we assuming? List every assumption, even obvious ones.",
      "Which assumptions can we challenge? Is this a law of physics or just how it has been done?",
      "If we only had the fundamental truths, what would we build?",
    ],
  },
  {
    name: "Jobs to Be Done",
    key: "jtbd",
    description: "Focus on what the user is trying to accomplish: functional job, emotional job, and social job.",
    prompts: [
      "Functional job: What task are they trying to complete?",
      "Emotional job: How do they want to feel?",
      "Social job: How do they want to be perceived?",
      "What is the competing product — and is it even in the same category?",
      "Format: When I [situation], I want to [motivation], so I can [expected outcome].",
    ],
  },
  {
    name: "Pre-mortem",
    key: "premortem",
    description: "Imagine the idea has already failed 12 months from now. Work backwards to identify failure modes.",
    prompts: [
      "It is 12 months from now and this project shipped and flopped. What went wrong?",
      "List every plausible failure reason: technical, market, team, timing.",
      "For each failure mode: Is this preventable? Does the idea need to change?",
      "Which failure modes are acceptable? Which would kill the project?",
    ],
  },
  {
    name: "How Might We",
    key: "hmw",
    description: "Reframe problems as opportunities using the 'How Might We...' format to unlock creative solutions.",
    prompts: [
      "Reframe the problem as: How might we [desired outcome] for [specific user] without [key constraint]?",
      "Generate 3-5 alternative HMW framings of the same problem.",
      "Which framing opens the most creative solution space?",
    ],
  },
  {
    name: "Constraint-Based Ideation",
    key: "constraints",
    description: "Impose artificial constraints to force creative solutions.",
    prompts: [
      "Time constraint: What if you only had 1 day to build this?",
      "Feature constraint: What if it could only have one feature?",
      "Tech constraint: What if you could not use the obvious technology?",
      "Cost constraint: What if it had to be free forever?",
      "Scale constraint: What if it needed to work for 1 billion users? What about just 10?",
    ],
  },
];

export interface IdeationRequest {
  idea: string;
  phase: "diverge" | "converge" | "ship" | "full";
  frameworks?: string[];
  context?: string;
  tenantId: number;
  personaId?: number;
}

export interface IdeationResult {
  phase: string;
  hmwStatement: string;
  variations: { framework: string; ideas: string[] }[];
  evaluation?: {
    directions: { name: string; userValue: string; feasibility: string; differentiation: string }[];
    assumptions: string[];
    risks: string[];
  };
  onePager?: {
    problemStatement: string;
    recommendedDirection: string;
    assumptions: { assumption: string; howToTest: string }[];
    mvpScope: string;
    notDoing: { item: string; reason: string }[];
    openQuestions: string[];
  };
}

const IDEATION_SYSTEM_PROMPT = `You are a world-class ideation partner. Your job is to refine raw ideas into sharp, actionable concepts worth building.

Philosophy:
- Simplicity is the ultimate sophistication. Push toward the simplest version that still solves the real problem.
- Start with the user experience, work backwards to technology.
- Say no to 1,000 things. Focus beats breadth.
- Challenge every assumption. "How it's usually done" is not a reason.
- Be honest, not supportive. If an idea is weak, say so with kindness.

You MUST respond in valid JSON only. No markdown, no explanation outside the JSON.`;

export async function runIdeationSession(request: IdeationRequest): Promise<IdeationResult> {
  const selectedFrameworks = request.frameworks
    ? FRAMEWORKS.filter(f => request.frameworks!.includes(f.key))
    : FRAMEWORKS.slice(0, 4);

  const frameworkBlock = selectedFrameworks.map(f =>
    `### ${f.name}\n${f.description}\nLenses:\n${f.prompts.map(p => `- ${p}`).join("\n")}`
  ).join("\n\n");

  const phaseInstructions = buildPhaseInstructions(request.phase, frameworkBlock);

  try {
    const { client } = await getClientForModel("deepseek/deepseek-v3.2", request.tenantId, {});

    const resp = await client.chat.completions.create({
      model: "deepseek/deepseek-v3.2",
      messages: [
        { role: "system", content: IDEATION_SYSTEM_PROMPT },
        { role: "user", content: `IDEA: ${request.idea}\n\n${request.context ? `CONTEXT: ${request.context}\n\n` : ""}${phaseInstructions}` },
      ],
      max_completion_tokens: 4096,
      temperature: 0.8,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallbackResult(request, text);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeResult(parsed, request.phase);
  } catch (err: any) {
    console.error(`[ideation] Session failed: ${err.message}`);
    return buildFallbackResult(request, err.message);
  }
}

function buildPhaseInstructions(phase: string, frameworkBlock: string): string {
  if (phase === "diverge" || phase === "full") {
    return `PHASE 1 — DIVERGE (Understand & Expand)

Apply these ideation frameworks to the idea:

${frameworkBlock}

Respond with this JSON structure:
{
  "hmwStatement": "How might we [desired outcome] for [specific user]?",
  "variations": [
    { "framework": "SCAMPER", "ideas": ["idea 1", "idea 2", "idea 3"] },
    { "framework": "First Principles", "ideas": ["idea 1", "idea 2"] }
  ]${phase === "full" ? `,
  "evaluation": {
    "directions": [
      { "name": "Direction A", "userValue": "Who benefits and how much — painkiller or vitamin?", "feasibility": "Technical and resource cost", "differentiation": "What makes this genuinely different?" }
    ],
    "assumptions": ["Assumption 1: ...", "Assumption 2: ..."],
    "risks": ["Risk 1: ...", "Risk 2: ..."]
  },
  "onePager": {
    "problemStatement": "One-sentence HMW framing",
    "recommendedDirection": "The chosen direction and why (2-3 paragraphs)",
    "assumptions": [{ "assumption": "...", "howToTest": "..." }],
    "mvpScope": "The minimum version that tests the core assumption",
    "notDoing": [{ "item": "Feature X", "reason": "Adds complexity without validating core assumption" }],
    "openQuestions": ["Question that needs answering before building"]
  }` : ""}
}

Generate 5-8 well-considered variations total, not 20 shallow ones. Each variation should have a reason it exists. Push beyond what was asked for — create products people don't know they need yet.`;
  }

  if (phase === "converge") {
    return `PHASE 2 — CONVERGE (Evaluate & Stress-Test)

Given the idea, cluster into 2-3 distinct directions and stress-test each:

Respond with this JSON:
{
  "hmwStatement": "...",
  "variations": [],
  "evaluation": {
    "directions": [
      { "name": "Direction name", "userValue": "Who benefits, painkiller or vitamin?", "feasibility": "Technical cost, hardest part", "differentiation": "What makes this genuinely different?" }
    ],
    "assumptions": ["What we are betting is true but have not validated"],
    "risks": ["What could kill this idea"]
  }
}

Be honest, not supportive. If a direction is weak, say so.`;
  }

  if (phase === "ship") {
    return `PHASE 3 — SHIP (Sharpen & Deliver)

Produce a concrete one-pager that moves work forward:

Respond with this JSON:
{
  "hmwStatement": "...",
  "variations": [],
  "onePager": {
    "problemStatement": "One-sentence HMW framing",
    "recommendedDirection": "The chosen direction and why — 2-3 paragraphs max",
    "assumptions": [{ "assumption": "...", "howToTest": "..." }],
    "mvpScope": "The minimum version that tests the core assumption. What is in, what is out.",
    "notDoing": [{ "item": "Thing to skip", "reason": "Why skipping it is correct" }],
    "openQuestions": ["Question needing an answer before building"]
  }
}

The "Not Doing" list is the most valuable part. Focus is about saying no to good ideas. Make the trade-offs explicit.`;
  }

  return "";
}

function normalizeResult(parsed: any, phase: string): IdeationResult {
  return {
    phase,
    hmwStatement: parsed.hmwStatement || "How might we solve this problem?",
    variations: Array.isArray(parsed.variations) ? parsed.variations : [],
    evaluation: parsed.evaluation || undefined,
    onePager: parsed.onePager || undefined,
  };
}

function buildFallbackResult(request: IdeationRequest, errorContext: string): IdeationResult {
  return {
    phase: request.phase,
    hmwStatement: `How might we explore: ${request.idea.slice(0, 100)}?`,
    variations: [
      {
        framework: "Fallback",
        ideas: [
          `Core idea: ${request.idea.slice(0, 200)}`,
          `The ideation engine encountered an issue: ${errorContext.slice(0, 200)}`,
          "Try running with a specific framework (scamper, first_principles, jtbd, premortem, hmw, constraints)",
        ],
      },
    ],
  };
}

export function formatIdeationAsMarkdown(result: IdeationResult): string {
  const lines: string[] = [];
  lines.push(`# Ideation Session Results\n`);
  lines.push(`**How Might We:** ${result.hmwStatement}\n`);

  if (result.variations.length > 0) {
    lines.push(`## Variations\n`);
    for (const v of result.variations) {
      lines.push(`### ${v.framework}`);
      for (const idea of v.ideas) {
        lines.push(`- ${idea}`);
      }
      lines.push("");
    }
  }

  if (result.evaluation) {
    lines.push(`## Evaluation\n`);
    for (const d of result.evaluation.directions) {
      lines.push(`### ${d.name}`);
      lines.push(`- **User Value:** ${d.userValue}`);
      lines.push(`- **Feasibility:** ${d.feasibility}`);
      lines.push(`- **Differentiation:** ${d.differentiation}\n`);
    }
    if (result.evaluation.assumptions.length > 0) {
      lines.push(`### Hidden Assumptions`);
      for (const a of result.evaluation.assumptions) lines.push(`- ${a}`);
      lines.push("");
    }
    if (result.evaluation.risks.length > 0) {
      lines.push(`### Risks`);
      for (const r of result.evaluation.risks) lines.push(`- ${r}`);
      lines.push("");
    }
  }

  if (result.onePager) {
    lines.push(`## One-Pager\n`);
    lines.push(`**Problem:** ${result.onePager.problemStatement}\n`);
    lines.push(`**Recommended Direction:**\n${result.onePager.recommendedDirection}\n`);
    if (result.onePager.assumptions.length > 0) {
      lines.push(`### Key Assumptions to Validate`);
      for (const a of result.onePager.assumptions) {
        lines.push(`- [ ] ${a.assumption} — *Test:* ${a.howToTest}`);
      }
      lines.push("");
    }
    lines.push(`**MVP Scope:** ${result.onePager.mvpScope}\n`);
    if (result.onePager.notDoing.length > 0) {
      lines.push(`### Not Doing (and Why)`);
      for (const nd of result.onePager.notDoing) {
        lines.push(`- **${nd.item}** — ${nd.reason}`);
      }
      lines.push("");
    }
    if (result.onePager.openQuestions.length > 0) {
      lines.push(`### Open Questions`);
      for (const q of result.onePager.openQuestions) lines.push(`- ${q}`);
    }
  }

  return lines.join("\n");
}
