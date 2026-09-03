/**
 * ceo-plan-synthesis.ts — extracted from ceo-orchestrator.ts (Task 104 girth
 * split, 2026-07-31; mechanical move, zero behavior change). The final-answer
 * synthesis step: collapses a completed OrchestrationPlan's war room into the
 * user-facing deliverable summary (links, per-step results, lean-step stats).
 * ceo-orchestrator.ts re-exports synthesizeResults so importers are unchanged.
 */

import type { OrchestrationPlan } from "./ceo-orchestrator";

export function synthesizeResults(plan: OrchestrationPlan): string {
  const parts: string[] = [];
  parts.push(`## Execution Complete\n**Objective:** ${plan.objective}\n`);

  const totalTime = plan.completedAt ? ((plan.completedAt - plan.createdAt) / 1000).toFixed(1) : "?";
  const leanSteps = plan.steps.filter(s => s.leanMode).length;
  const efficiency = leanSteps > 0 ? ` | **Lean steps:** ${leanSteps}/${plan.steps.length} (reduced token usage)` : "";
  parts.push(`**Status:** ${plan.status} | **Steps:** ${plan.steps.length} | **Time:** ${totalTime}s${efficiency}\n`);

  const seenFileIds = new Set<string>();
  const deliverableLinks: string[] = [];
  const fileIdExtractor = /\/d\/([a-zA-Z0-9_-]+)/;
  const linkPatterns = [
    /https:\/\/docs\.google\.com\/(?:presentation|document|spreadsheets)\/d\/[^\s)]+/g,
    /https:\/\/drive\.google\.com\/file\/d\/[^\s)]+/g,
    /https:\/\/(?:www\.)?youtube\.com\/watch\?v=[^\s)]+/g,
    /https:\/\/1drv\.ms\/[^\s)]+/g,
    /https?:\/\/[^\s)]+\/present\/[a-f0-9]{20,}/g,
  ];

  for (const step of plan.steps) {
    const icon = step.status === "complete" ? "✅" : step.status === "failed" ? "❌" : "⏳";
    const persona = step.assignedPersona;
    const time = step.startedAt && step.completedAt ? `${((step.completedAt - step.startedAt) / 1000).toFixed(1)}s` : "";
    parts.push(`### ${icon} Step ${step.taskId}: ${step.description}`);
    parts.push(`*Assigned to: ${persona} | ${time}*\n`);

    if (step.result) {
      parts.push(step.result);
      for (const pattern of linkPatterns) {
        const matches = step.result.match(pattern);
        if (matches) {
          for (const url of matches) {
            const idMatch = url.match(fileIdExtractor);
            const key = idMatch ? idMatch[1] : url;
            if (!seenFileIds.has(key)) {
              seenFileIds.add(key);
              deliverableLinks.push(url);
            }
          }
        }
      }
    }
    if (step.error) {
      parts.push(`**Error:** ${step.error}`);
    }
    parts.push("");
  }

  const failedSteps = plan.steps.filter(s => s.status === "failed");
  if (failedSteps.length > 0) {
    const bottleneckLines: string[] = [`## ⚠️ Bottleneck Analysis\n`];
    const totalTimeMs = plan.completedAt ? plan.completedAt - plan.createdAt : 0;

    for (const step of failedSteps) {
      const errorMsg = step.error || "Unknown error";
      const stepTimeMs = step.startedAt && step.completedAt ? step.completedAt - step.startedAt : 0;
      const stepTimeSec = (stepTimeMs / 1000).toFixed(1);

      let rootCause = "Unknown";
      let workaround = "Retry the request or try a different approach.";

      if (/timed?\s*out|timeout|ETIMEDOUT/i.test(errorMsg)) {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) timed out after ${stepTimeSec}s — the task was too complex for the time limit.`;
        workaround = `Try breaking this into smaller sub-tasks, or ask Felix to focus on just this part. The model may have been overloaded.`;
      } else if (/401|403|auth|token|credential/i.test(errorMsg)) {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) hit an authentication error — a service token may have expired.`;
        workaround = `Ask Felix to retry — tokens auto-refresh. If it persists, the Google/API connection may need reconnection.`;
      } else if (/429|rate.?limit|quota/i.test(errorMsg)) {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) hit a rate limit — too many API calls in a short period.`;
        workaround = `Wait 30-60 seconds and retry. Felix will automatically use a different AI model if available.`;
      } else if (/500|502|503|504|server.?error|internal/i.test(errorMsg)) {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) encountered a server error from an external service.`;
        workaround = `This is usually temporary. Retry the request — Felix will use backup providers if available.`;
      } else if (/tool.*fail|no.*tool|not.*found/i.test(errorMsg)) {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) could not execute the required tool.`;
        workaround = `Felix should try an alternative tool or approach. If a specific tool is broken, report it so it can be fixed.`;
      } else {
        rootCause = `Step ${step.taskId} (${step.assignedPersona}) failed: ${errorMsg.slice(0, 200)}`;
        workaround = `Felix attempted to self-correct but could not resolve the issue. Try rephrasing the request or breaking it into smaller parts.`;
      }

      bottleneckLines.push(`**${step.assignedPersona} (Step ${step.taskId}):** ${step.description.slice(0, 100)}`);
      bottleneckLines.push(`- **Root cause:** ${rootCause}`);
      bottleneckLines.push(`- **Time spent:** ${stepTimeSec}s before failure`);
      bottleneckLines.push(`- **Suggested fix:** ${workaround}`);
      bottleneckLines.push(``);
    }

    const completedSteps = plan.steps.filter(s => s.status === "complete");
    if (completedSteps.length > 0 && failedSteps.length < plan.steps.length) {
      bottleneckLines.push(`**${completedSteps.length}/${plan.steps.length} steps succeeded.** The failed steps did NOT block completed deliverables — check the results above for partial output you can use now.`);
    }

    bottleneckLines.push(``);
    parts.push(bottleneckLines.join("\n"));
  }

  if (deliverableLinks.length > 0) {
    const unique = [...new Set(deliverableLinks)];
    const linkSection: string[] = [`## 📎 Deliverables (MUST INCLUDE IN RESPONSE)\n`];
    for (const link of unique) {
      if (link.includes("presentation")) linkSection.push(`- **Google Slides:** ${link}`);
      else if (link.includes("document")) linkSection.push(`- **Google Doc:** ${link}`);
      else if (link.includes("spreadsheets")) linkSection.push(`- **Google Sheet:** ${link}`);
      else if (link.includes("drive.google.com")) linkSection.push(`- **Google Drive File:** ${link}`);
      else if (link.includes("youtube.com")) linkSection.push(`- **YouTube Video:** ${link}`);
      else if (link.includes("1drv.ms")) linkSection.push(`- **OneDrive File:** ${link}`);
      else if (link.includes("/present/")) linkSection.push(`- 🎤 **Auto-Presenter with Narration:** ${link}`);
      else linkSection.push(`- ${link}`);
    }
    linkSection.push("");
    parts.splice(2, 0, ...linkSection);
  }

  const fullText = parts.join("\n");
  const objectiveLower = (plan.objective || "").toLowerCase();
  const isPresentation = /present|slide|deck|keynote|pitch/i.test(objectiveLower);
  const isNarrated = /narrat|auto.?present|voice|spoken|tts/i.test(objectiveLower) || isPresentation;

  if (isNarrated) {
    const hasPresenterLink = /\/present\/[a-f0-9]{20,}/.test(fullText);
    const hasSlidesLink = /docs\.google\.com\/presentation/.test(fullText);

    if (hasSlidesLink && !hasPresenterLink) {
      console.warn(`[ceo] DELIVERY SELF-CHECK FAILED: Presentation created but narration link missing from synthesized results`);
      const presenterLinkFromSteps = plan.steps
        .filter(s => s.result)
        .map(s => {
          const m = s.result!.match(/https?:\/\/[^\s)]+\/present\/[a-f0-9]{20,}/);
          return m ? m[0] : null;
        })
        .find(Boolean);

      if (presenterLinkFromSteps) {
        parts.push(`\n## 🎤 Narrated Auto-Presenter\n**Click to play the full presentation with AI voice narration:**\n${presenterLinkFromSteps}\n`);
        console.log(`[ceo] SELF-REPAIR: Recovered narration link from step results: ${presenterLinkFromSteps}`);
      } else {
        parts.push(`\n*Note: A narrated presenter link should have been generated but was not found. The presentation is available via Google Slides links above.*\n`);
        console.warn(`[ceo] SELF-REPAIR FAILED: Could not find narration link anywhere in step results`);
      }
      return parts.join("\n");
    }
  }

  return fullText;
}
