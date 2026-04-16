import OpenAI from "openai";

interface AdversarialFinding {
  type: "factual_accuracy" | "logical_consistency" | "completeness_gap" | "hallucination" | "task_alignment";
  description: string;
  severity: "critical" | "major" | "minor";
}

interface QAResult {
  verdict: "approved" | "approved-with-notes" | "needs-revision" | "flagged";
  score: number;
  issues: string[];
  strengths: string[];
  summary: string;
  adversarialFindings: AdversarialFinding[];
}

const replit = new OpenAI();

async function runAutoQA(
  agentName: string,
  taskName: string,
  output: string,
  tenantId: number,
  conversationId?: number
): Promise<QAResult | null> {
  const truncatedOutput = output.slice(0, 3000);

  try {
    const resp = await replit.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are Proof, the adversarial verification specialist. Your job is to FIND PROBLEMS, not confirm quality. You are reviewing output from agent "${agentName}" for task "${taskName}".

## Adversarial Verification Mindset
You must actively try to break the output. Do not rationalize away problems. Apply these anti-rationalization rules:
- "Reading is not verification" — seeing a claim does not make it true
- "Probably is not verified" — if you cannot confirm something, flag it
- "Absence of evidence is evidence of absence" — if the output should address something but doesn't, that's a gap
- "Confidence is not correctness" — authoritative tone does not equal accuracy

## Evaluation Criteria
1. **Completeness** — Does the output address the FULL task? Are there gaps, missing sections, or partially answered requirements?
2. **Accuracy** — Are facts, data, and claims correct? Could any statement be a hallucination?
3. **Clarity** — Is it well-structured and easy to understand?
4. **Professionalism** — Tone, formatting, and presentation quality

## Adversarial Probes (run ALL of these)
1. **Factual Accuracy** — Are cited facts verifiable? Are numbers/dates/names plausible? Flag anything that smells like a hallucination.
2. **Logical Consistency** — Does the output contradict itself? Are conclusions supported by the reasoning given?
3. **Completeness Gaps** — Does the output actually address the full task, or does it skip hard parts and pad easy ones?
4. **Hallucination Detection** — Are there made-up citations, invented statistics, or fabricated details?
5. **Task Alignment** — Does the output solve what was actually asked, or does it answer a subtly different question?

## Response Format
Respond with ONLY valid JSON:
{
  "verdict": "approved" | "approved-with-notes" | "needs-revision" | "flagged",
  "score": 1-10,
  "issues": ["issue1", "issue2"],
  "strengths": ["strength1"],
  "summary": "One sentence review",
  "adversarialFindings": [
    {
      "type": "factual_accuracy" | "logical_consistency" | "completeness_gap" | "hallucination" | "task_alignment",
      "description": "Specific finding",
      "severity": "critical" | "major" | "minor"
    }
  ]
}

## Verdict Rules
- "approved" — No adversarial findings at all. Output is clean.
- "approved-with-notes" — Only minor findings that don't block delivery.
- "needs-revision" — One or more major findings that require fixing before delivery.
- "flagged" — Any critical finding, or multiple major findings. Output should not be delivered as-is.`,
        },
        {
          role: "user",
          content: `Task: ${taskName}\nAgent: ${agentName}\n\nOutput to review:\n${truncatedOutput}`,
        },
      ],
      max_completion_tokens: 600,
    });

    const raw = resp.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as QAResult;

    if (!Array.isArray(parsed.adversarialFindings)) {
      parsed.adversarialFindings = [];
    }

    for (const f of parsed.adversarialFindings) {
      if (!["factual_accuracy", "logical_consistency", "completeness_gap", "hallucination", "task_alignment"].includes(f.type)) {
        f.type = "task_alignment";
      }
      if (!["critical", "major", "minor"].includes(f.severity)) {
        f.severity = "minor";
      }
    }

    const hasCritical = parsed.adversarialFindings.some(f => f.severity === "critical");
    const majorCount = parsed.adversarialFindings.filter(f => f.severity === "major").length;
    const minorOnly = parsed.adversarialFindings.length > 0 && !hasCritical && majorCount === 0;

    if (!["approved", "approved-with-notes", "needs-revision", "flagged"].includes(parsed.verdict)) {
      if (hasCritical || majorCount >= 2) {
        parsed.verdict = "flagged";
      } else if (majorCount === 1) {
        parsed.verdict = "needs-revision";
      } else if (minorOnly) {
        parsed.verdict = "approved-with-notes";
      } else {
        parsed.verdict = parsed.score >= 7 ? "approved" : parsed.score >= 4 ? "needs-revision" : "flagged";
      }
    } else {
      if (hasCritical && parsed.verdict !== "flagged") {
        parsed.verdict = "flagged";
      } else if (majorCount >= 1 && parsed.verdict === "approved") {
        parsed.verdict = "needs-revision";
      } else if (minorOnly && parsed.verdict === "approved") {
        parsed.verdict = "approved-with-notes";
      }
    }

    try {
      const { emitDelegationEvent } = await import("./delegation-events");
      const verdictLabels: Record<string, string> = {
        "approved": "approved",
        "approved-with-notes": "approved with notes",
        "needs-revision": "needs revision",
        "flagged": "flagged for review",
      };
      const verdictLabel = verdictLabels[parsed.verdict] || parsed.verdict;
      const findingSummary = parsed.adversarialFindings.length > 0
        ? ` | ${parsed.adversarialFindings.length} adversarial finding(s): ${parsed.adversarialFindings.filter(f => f.severity === "critical").length} critical, ${parsed.adversarialFindings.filter(f => f.severity === "major").length} major, ${parsed.adversarialFindings.filter(f => f.severity === "minor").length} minor`
        : "";
      emitDelegationEvent({
        conversationId: conversationId ?? 0,
        tenantId,
        type: "progress",
        agentName: "Proof",
        agentRole: "Adversarial Verification",
        depth: 0,
        message: `Auto-QA review of ${agentName}'s output: ${verdictLabel} (${parsed.score}/10). ${parsed.summary}${findingSummary}`,
        metadata: {
          qaResult: parsed,
          reviewedAgent: agentName,
          taskName,
          adversarialFindings: parsed.adversarialFindings,
        },
      });
    } catch {}

    return parsed;
  } catch (err: any) {
    console.warn(`[auto-qa] Review failed: ${err.message}`);
    return null;
  }
}

function runAutoQAAsync(
  agentName: string,
  taskName: string,
  output: string,
  tenantId: number,
  conversationId?: number
): void {
  runAutoQA(agentName, taskName, output, tenantId, conversationId)
    .then(result => {
      if (result) {
        const findingCount = result.adversarialFindings?.length || 0;
        console.log(`[auto-qa] ${agentName} output reviewed: ${result.verdict} (${result.score}/10), ${findingCount} adversarial finding(s)`);
      }
    })
    .catch(err => console.warn(`[auto-qa] Async review failed: ${err.message}`));
}

export { runAutoQA, runAutoQAAsync, QAResult, AdversarialFinding };
