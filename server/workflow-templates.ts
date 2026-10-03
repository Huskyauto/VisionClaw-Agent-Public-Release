import * as fs from "fs";
import * as path from "path";
import { isExplicitSavedVideoRequest } from "./workflow-template-intent";

export interface WorkflowResult {
  matched: boolean;
  response?: string;
  toolsUsed?: { name: string; input: any; output: any }[];
}

interface WorkflowTemplate {
  name: string;
  detect: (message: string) => boolean;
  execute: (message: string, context: WorkflowContext) => Promise<WorkflowResult>;
}

interface WorkflowContext {
  tenantId: number;
  personaId?: number;
  personaRole?: string;
  personaName?: string;
  conversationId: number;
  email?: string;
  canUseVideoTool: boolean;
}

const SCRIPT_FILE = "project-assets/the_meta_launch_script.txt";

const templates: WorkflowTemplate[] = [
  {
    name: "video_production",
    detect: isExplicitSavedVideoRequest,
    execute: async (message, context) => {
      if (!context.canUseVideoTool) {
        return { matched: true, response: "The saved-script video tool is not available in this conversation." };
      }
      const steps: { name: string; input: any; output: any }[] = [];
      let scriptContent = "";
      const scriptPath = path.resolve("/home/runner/workspace", SCRIPT_FILE);

      console.log(`[workflow-template] video_production: Starting deterministic workflow`);

      if (fs.existsSync(scriptPath)) {
        scriptContent = fs.readFileSync(scriptPath, "utf-8").trim();
        steps.push({ name: "read_file", input: { path: SCRIPT_FILE }, output: { success: true, lines: scriptContent.split("\n").length } });
        console.log(`[workflow-template] video_production: Read script (${scriptContent.length} chars)`);
      }

      if (!scriptContent) {
        return {
          matched: true,
          response: "I found a video production request, but I couldn't locate a script file. Could you provide the narration text you'd like me to use for the video?",
          toolsUsed: steps,
        };
      }

      const titleMatch = scriptContent.match(/^#?\s*(.+)/);
      const title = titleMatch ? titleMatch[1].replace(/^[#\s]+/, "").trim().slice(0, 60) : "VisionClaw Video";

      console.log(`[workflow-template] video_production: Calling produce_video with title="${title}"`);

      // R74.13d M1: tenant context required by tools that mutate DB rows.
      // workflow-templates already receives context.tenantId from the caller.
      // Tenant-isolation fix (2026-07-25): project 14 is the ADMIN tenant's
      // video project. Only attach it when the caller IS the admin tenant —
      // any other tenant's video otherwise writes files/notes into the
      // owner's project via the tenant-less project_files FK path.
      const { ADMIN_TENANT_ID } = await import("./tenant-constants");
      const videoParams: any = {
        script: scriptContent,
        title,
        _tenantId: context.tenantId,
      };
      if (context.tenantId === ADMIN_TENANT_ID) {
        videoParams.project_id = 14;
      }

      if (context.email) {
        videoParams.email_to = context.email;
      }

      const { executeGuardedTool } = await import("./guarded-tool-executor");
      const videoResult = await executeGuardedTool("produce_video", videoParams, {
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        personaRole: context.personaRole,
        personaName: context.personaName,
        invokedVia: "chat_engine",
      });
      steps.push({ name: "produce_video", input: { title, script_length: scriptContent.length }, output: videoResult });

      if (videoResult?.success !== true || !videoResult?.job_id || !videoResult?.status) {
        const reason = videoResult?.error || videoResult?.message || "The video job was not started";
        console.log(`[workflow-template] video_production: produce_video failed: ${reason}`);
        return {
          matched: true,
          response: `The saved-script video job did not start: ${reason}`,
          toolsUsed: steps,
        };
      }

      const response = `Saved-script video job started.\n\n**Title:** ${title}\n**Job:** ${videoResult.job_id}\n**Status:** ${videoResult.status}${videoResult.watch_progress_url ? `\n**Progress:** ${videoResult.watch_progress_url}` : ""}\n\nRendering and delivery are not yet complete.`;
      console.log(`[workflow-template] video_production: job started ${videoResult.job_id}`);

      return {
        matched: true,
        response,
        toolsUsed: steps,
      };
    },
  },
];

export async function tryWorkflowTemplate(
  message: string,
  context: WorkflowContext
): Promise<WorkflowResult> {
  for (const template of templates) {
    if (template.detect(message)) {
      console.log(`[workflow-template] Matched: "${template.name}" for message: ${message.slice(0, 80)}`);
      try {
        return await template.execute(message, context);
      } catch (err: any) {
        console.error(`[workflow-template] "${template.name}" failed:`, err.message);
        return { matched: false };
      }
    }
  }
  return { matched: false };
}
