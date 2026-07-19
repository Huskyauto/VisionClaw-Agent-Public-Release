import { db } from "./db";
import { sql } from "drizzle-orm";
import { executeWithFailover } from "./model-failover";
import { getAvailableModels } from "./providers";

export interface InterviewDimension {
  id: string;
  name: string;
  weight: number;
  question: string;
  clarityScore: number;
  answer: string;
}

export interface InterviewState {
  id: string;
  tenantId: number;
  conversationId: number;
  topic: string;
  dimensions: InterviewDimension[];
  pendingDimensionId: string | null;
  currentRound: number;
  maxRounds: number;
  overallClarity: number;
  clarityThreshold: number;
  status: "interviewing" | "complete" | "abandoned";
  strategicBrief: string | null;
  createdAt: number;
}

const activeInterviews = new Map<string, InterviewState>();

const MAX_INTERVIEWS = 100;
const INTERVIEW_TTL_MS = 30 * 60 * 1000;

function cleanupStaleInterviews() {
  const now = Date.now();
  for (const [key, state] of activeInterviews) {
    if (now - state.createdAt > INTERVIEW_TTL_MS) {
      activeInterviews.delete(key);
    }
  }
  if (activeInterviews.size > MAX_INTERVIEWS) {
    const sorted = [...activeInterviews.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < sorted.length - MAX_INTERVIEWS; i++) {
      activeInterviews.delete(sorted[i][0]);
    }
  }
}

const BUSINESS_DIMENSIONS: Omit<InterviewDimension, "clarityScore" | "answer">[] = [
  { id: "goal", name: "Core Goal", weight: 0.25, question: "What specific outcome are you trying to achieve? What does success look like?" },
  { id: "audience", name: "Target Audience", weight: 0.15, question: "Who is this for? Describe the people who will use or benefit from this." },
  { id: "constraints", name: "Constraints & Resources", weight: 0.15, question: "What are your budget, timeline, and resource constraints? Any technical or legal limitations?" },
  { id: "differentiation", name: "Differentiation", weight: 0.15, question: "What makes this different from what already exists? Why would someone choose this over alternatives?" },
  { id: "risks", name: "Risks & Unknowns", weight: 0.10, question: "What could go wrong? What are you most uncertain about?" },
  { id: "metrics", name: "Success Metrics", weight: 0.10, question: "How will you measure whether this worked? What numbers matter?" },
  { id: "scope", name: "Scope & Priorities", weight: 0.10, question: "If you had to ship the smallest useful version first, what would it include? What can wait?" },
];

export function startInterview(params: {
  tenantId: number;
  conversationId: number;
  topic: string;
}): { interviewId: string; firstQuestion: string } {
  cleanupStaleInterviews();

  const id = `interview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const dimensions: InterviewDimension[] = BUSINESS_DIMENSIONS.map(d => ({
    ...d,
    clarityScore: 0,
    answer: "",
  }));

  const firstDimId = dimensions[0].id;

  const state: InterviewState = {
    id,
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    topic: params.topic,
    dimensions,
    pendingDimensionId: firstDimId,
    currentRound: 0,
    maxRounds: 7,
    overallClarity: 0,
    clarityThreshold: 70,
    status: "interviewing",
    strategicBrief: null,
    createdAt: Date.now(),
  };

  activeInterviews.set(id, state);

  const firstDimension = dimensions[0];
  const firstQuestion = `I want to make sure we build exactly the right thing. Let me ask a few focused questions before we dive in.\n\n**${firstDimension.name}:** ${firstDimension.question}`;

  return { interviewId: id, firstQuestion };
}

export async function processInterviewAnswer(params: {
  interviewId: string;
  answer: string;
  tenantId: number;
  model?: string;
}): Promise<{
  complete: boolean;
  nextQuestion?: string;
  strategicBrief?: string;
  clarityScores?: Record<string, number>;
  overallClarity?: number;
}> {
  const state = activeInterviews.get(params.interviewId);
  if (!state) return { complete: true, strategicBrief: "Interview not found — proceeding with available context." };

  if (state.tenantId !== params.tenantId) {
    return { complete: true, strategicBrief: "Interview not found — proceeding with available context." };
  }

  state.currentRound++;

  if (state.pendingDimensionId) {
    const targetDim = state.dimensions.find(d => d.id === state.pendingDimensionId);
    if (targetDim) {
      if (targetDim.answer) {
        targetDim.answer += "\n\n[Follow-up]: " + params.answer;
      } else {
        targetDim.answer = params.answer;
      }
    }
    state.pendingDimensionId = null;
  } else {
    const unanswered = state.dimensions.find(d => !d.answer);
    if (unanswered) {
      unanswered.answer = params.answer;
    }
  }

  const availableModels = await getAvailableModels();
  const scoringModel = params.model || "gemini-2.5-flash";

  try {
    const { result: resp } = await executeWithFailover(
      scoringModel, availableModels,
      async (client: any, modelId: string) => {
        return client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: "system",
              content: `You are an expert business analyst evaluating interview answers for clarity and completeness. Score each answered dimension 0-100 on how clear and actionable the answer is. Also identify the weakest dimension that needs a follow-up question.

Respond in this exact JSON format:
{"scores":{"goal":85,"audience":70,...},"weakest_id":"risks","follow_up":"specific follow-up question","ready":false}

Set "ready":true only when ALL dimensions score >= 65 and overall weighted average >= 70. Be generous but honest.`
            },
            {
              role: "user",
              content: `Topic: ${state.topic}\n\nAnswers so far:\n${state.dimensions.filter(d => d.answer).map(d => `**${d.name}**: ${d.answer}`).join("\n\n")}`
            }
          ],
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
        });
      },
      state.tenantId
    );

    const content = resp.choices[0]?.message?.content || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { scores: {}, weakest_id: null, follow_up: null, ready: false };
    }

    if (parsed.scores) {
      for (const dim of state.dimensions) {
        if (parsed.scores[dim.id] !== undefined) {
          dim.clarityScore = Math.min(100, Math.max(0, Number(parsed.scores[dim.id]) || 0));
        }
      }
    }

    const totalWeight = state.dimensions.reduce((s, d) => s + d.weight, 0);
    state.overallClarity = Math.round(
      state.dimensions.reduce((s, d) => s + (d.clarityScore * d.weight), 0) / totalWeight
    );

    const clarityScores: Record<string, number> = {};
    state.dimensions.forEach(d => { clarityScores[d.name] = d.clarityScore; });

    const unanswered = state.dimensions.find(d => !d.answer);
    if (unanswered) {
      state.pendingDimensionId = unanswered.id;
      return {
        complete: false,
        nextQuestion: `**${unanswered.name}:** ${unanswered.question}`,
        clarityScores,
        overallClarity: state.overallClarity,
      };
    }

    if ((parsed.ready || state.overallClarity >= state.clarityThreshold) || state.currentRound >= state.maxRounds) {
      return await completeInterview(state, params.interviewId, availableModels, scoringModel, clarityScores);
    }

    const weakDim = parsed.weakest_id ? state.dimensions.find(d => d.id === parsed.weakest_id) : null;
    const followUp = parsed.follow_up || (weakDim ? `Can you elaborate on ${weakDim.name.toLowerCase()}?` : null);

    if (followUp && weakDim) {
      state.pendingDimensionId = weakDim.id;
      return {
        complete: false,
        nextQuestion: `Your clarity is at **${state.overallClarity}%** (need 70%). Let me dig deeper on one area.\n\n**${weakDim.name}:** ${followUp}`,
        clarityScores,
        overallClarity: state.overallClarity,
      };
    }

    return await completeInterview(state, params.interviewId, availableModels, scoringModel, clarityScores);

  } catch (err: any) {
    console.error(`[deep-interview] Scoring failed:`, err.message);
    const unanswered = state.dimensions.find(d => !d.answer);
    if (unanswered) {
      state.pendingDimensionId = unanswered.id;
      return {
        complete: false,
        nextQuestion: `**${unanswered.name}:** ${unanswered.question}`,
      };
    }
    state.status = "complete";
    activeInterviews.delete(params.interviewId);
    return { complete: true, strategicBrief: `Interview complete for: ${state.topic}. Answers collected across ${state.dimensions.filter(d => d.answer).length} dimensions.` };
  }
}

async function completeInterview(
  state: InterviewState,
  interviewId: string,
  availableModels: any[],
  scoringModel: string,
  clarityScores: Record<string, number>
): Promise<{
  complete: boolean;
  strategicBrief: string;
  clarityScores: Record<string, number>;
  overallClarity: number;
}> {
  const brief = await generateStrategicBrief(state, availableModels, scoringModel);
  state.strategicBrief = brief;
  state.status = "complete";

  await saveInterviewToKnowledge(state);
  activeInterviews.delete(interviewId);

  return {
    complete: true,
    strategicBrief: brief,
    clarityScores,
    overallClarity: state.overallClarity,
  };
}

async function generateStrategicBrief(
  state: InterviewState,
  availableModels: any[],
  model: string
): Promise<string> {
  try {
    const { result: resp } = await executeWithFailover(
      model, availableModels,
      async (client: any, modelId: string) => {
        return client.chat.completions.create({
          model: modelId,
          messages: [
            {
              role: "system",
              content: `You are a senior strategy consultant. Based on the interview answers below, produce a concise Strategic Brief in markdown format. Include:

## Strategic Brief: [Project Name]

### Vision
One sentence capturing the core vision.

### Target Audience
Who this serves and their key pain points.

### Core Requirements
Numbered list of must-have features/deliverables.

### Constraints
Budget, timeline, technical, legal limitations.

### Differentiation
What makes this unique vs alternatives.

### Risk Mitigation
Top 3 risks and how to address each.

### Success Metrics
Specific, measurable KPIs.

### Recommended First Step
The smallest viable action to start making progress today.

### Clarity Assessment
Overall clarity score and any areas that still need refinement.

Be specific and actionable. No filler.`
            },
            {
              role: "user",
              content: `Topic: ${state.topic}\n\nInterview Answers:\n${state.dimensions.map(d => `**${d.name}** (clarity: ${d.clarityScore}%): ${d.answer || "Not answered"}`).join("\n\n")}`
            }
          ],
          max_completion_tokens: 2000,
        });
      },
      state.tenantId
    );

    return resp.choices[0]?.message?.content || "Brief generation failed.";
  } catch (err: any) {
    console.error(`[deep-interview] Brief generation failed:`, err.message);
    return `## Strategic Brief: ${state.topic}\n\n${state.dimensions.filter(d => d.answer).map(d => `### ${d.name}\n${d.answer}`).join("\n\n")}`;
  }
}

async function saveInterviewToKnowledge(state: InterviewState): Promise<void> {
  try {
    const briefContent = `## Strategic Interview: ${state.topic}\n\n${state.strategicBrief || state.dimensions.filter(d => d.answer).map(d => `${d.name} (${d.clarityScore}%): ${d.answer}`).join("\n")}`;

    await db.execute(sql`
      INSERT INTO project_notes (project_id, content, created_at)
      SELECT p.id, ${briefContent}, NOW()
      FROM project_conversations pc
      JOIN projects p ON p.id = pc.project_id
      WHERE pc.conversation_id = ${state.conversationId}
        AND p.tenant_id = ${state.tenantId}
      LIMIT 1
    `);
  } catch (err: any) {
    console.error(`[deep-interview] Failed to save interview to knowledge:`, err.message);
  }
}

export function getActiveInterview(interviewId: string): InterviewState | undefined {
  return activeInterviews.get(interviewId);
}

export function abandonInterview(interviewId: string, tenantId: number): void {
  const state = activeInterviews.get(interviewId);
  if (state && state.tenantId === tenantId) {
    state.status = "abandoned";
    activeInterviews.delete(interviewId);
  }
}
