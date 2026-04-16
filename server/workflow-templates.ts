import { executeTool } from "./tools";
import * as fs from "fs";
import * as path from "path";

export interface WorkflowResult {
  matched: boolean;
  response?: string;
  toolsUsed?: { name: string; input: any; output: any }[];
}

interface WorkflowTemplate {
  name: string;
  detect: (message: string) => boolean;
  execute: (message: string, context: { tenantId: number; personaId?: number; conversationId: number; email?: string }) => Promise<WorkflowResult>;
}

const VIDEO_PATTERNS = /\b(create|make|produce|generate|build)\b.*\b(video|youtube|mp4)\b|\b(video|youtube)\b.*\b(create|make|produce|generate)\b|\bproduce.video\b/i;

const SCRIPT_FILE = "project-assets/the_meta_launch_script.txt";

const templates: WorkflowTemplate[] = [
  {
    name: "video_production",
    detect: (message: string) => VIDEO_PATTERNS.test(message),
    execute: async (message, context) => {
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
        const scriptFiles = findScriptFiles();
        if (scriptFiles.length > 0) {
          const bestFile = scriptFiles[0];
          scriptContent = fs.readFileSync(bestFile, "utf-8").trim();
          steps.push({ name: "read_file", input: { path: bestFile }, output: { success: true, lines: scriptContent.split("\n").length } });
          console.log(`[workflow-template] video_production: Found alt script: ${bestFile} (${scriptContent.length} chars)`);
        }
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

      const videoParams: any = {
        script: scriptContent,
        title,
        project_id: 14,
      };

      if (context.email) {
        videoParams.email_to = context.email;
      }

      const videoResult = await executeTool("produce_video", videoParams);
      steps.push({ name: "produce_video", input: { title, script_length: scriptContent.length }, output: videoResult });

      if (videoResult?.error) {
        console.log(`[workflow-template] video_production: produce_video failed: ${videoResult.error}`);
        return {
          matched: true,
          response: `I attempted to create the video but encountered an issue: ${videoResult.error}. The script was loaded successfully (${scriptContent.length} characters). Would you like me to try again or adjust the approach?`,
          toolsUsed: steps,
        };
      }

      const driveLink = videoResult?.driveUrl || videoResult?.drive_url || videoResult?.link || "";
      const filePath = videoResult?.filePath || videoResult?.file_path || "";
      
      let response = `Video created successfully!\n\n`;
      response += `**Title:** ${title}\n`;
      response += `**Script:** ${scriptContent.split("\n").length} lines, ${scriptContent.length} characters\n`;
      if (driveLink) response += `**Google Drive:** ${driveLink}\n`;
      if (filePath) response += `**Local file:** ${filePath}\n`;
      if (context.email) response += `**Emailed to:** ${context.email}\n`;
      response += `\nThe video includes auto-generated text slides with ElevenLabs narration.`;

      console.log(`[workflow-template] video_production: Success! ${driveLink || filePath}`);

      return {
        matched: true,
        response,
        toolsUsed: steps,
      };
    },
  },
];

function findScriptFiles(): string[] {
  const assetsDir = path.resolve("/home/runner/workspace/project-assets");
  if (!fs.existsSync(assetsDir)) return [];
  const files = fs.readdirSync(assetsDir)
    .filter(f => f.endsWith(".txt") && /script/i.test(f))
    .map(f => path.join(assetsDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files;
}

export async function tryWorkflowTemplate(
  message: string,
  context: { tenantId: number; personaId?: number; conversationId: number; email?: string }
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
