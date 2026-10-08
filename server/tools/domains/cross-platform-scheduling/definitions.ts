import type { ToolDefinition } from "../../types";

export const scheduleCrossPlatformPostDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "schedule_cross_platform_post",
    description: "Schedule the SAME piece of content to fan out to one or more social platforms at a chosen future time. Supported platforms: x (Twitter), linkedin, instagram, facebook, threads, pinterest, youtube. YouTube is video-only (the public Data API has no text-post endpoint) — if youtube is in the platform list you MUST also pass `videoUrl` (https). Pinterest and Instagram are image-first — both require an `imageUrl`. Threads accepts text-only or text+image. The heartbeat runner picks due rows every minute, fans out per-platform via the native publish handlers (no third-party relay), and retries failed platforms with exponential backoff (max 3 attempts). Returns {ok, id, scheduledFor}. Destructive — every call publishes public content from Bob's connected accounts. ALWAYS confirm the time window + platform list + draft copy with the user BEFORE calling; never auto-schedule from an inferred intent.",
    parameters: {
      type: "object",
      properties: {
        platforms: { type: "array", items: { type: "string", enum: ["x", "linkedin", "instagram", "facebook", "threads", "pinterest", "youtube"] }, description: "Lowercase platform identifiers. Allowlist: x | linkedin | instagram | facebook | threads | pinterest | youtube. Must be a non-empty array. YouTube also requires a videoUrl. Pinterest + Instagram require imageUrl." },
        content: { type: "string", description: "Post body. Each platform's native limits apply downstream (X 280, LinkedIn 3000, IG 2200). For YouTube this becomes the video description (first line is auto-used as the title)." },
        scheduledFor: { type: "string", description: "ISO-8601 timestamp for when the post should fire. Must be in the future." },
        imageUrl: { type: "string", description: "Optional public image URL (Instagram + Facebook accept it; ignored by X/LinkedIn which use base64; ignored by YouTube)." },
        videoUrl: { type: "string", description: "REQUIRED if platforms includes 'youtube'. Public https URL of the video file (≤256MB). Ignored by all other platforms." },
        campaign: { type: "string", description: "Optional campaign tag for analytics rollups." },
      },
      required: ["platforms", "content", "scheduledFor"],
    },
  },
};