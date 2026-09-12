export type Deliverable = {
  toolName: string;
  kind: "video" | "audio" | "pdf" | "image" | "file";
  title: string;
  watchUrl?: string;
  downloadUrl?: string;
  driveUrl?: string;
  emailedTo?: string;
};

type DeliverableToolCall = {
  name: string;
  input: Record<string, any>;
  output?: any;
  done: boolean;
};

function isSafeDeliverableUrl(url?: string): url is string {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  const m = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!m) return false;
  const proto = m[1].toLowerCase();
  return proto === "http" || proto === "https" || proto === "mailto" || proto === "tel" || proto === "blob";
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function extractDeliverablesFromTools(tools: DeliverableToolCall[]): Deliverable[] {
  const out: Deliverable[] = [];
  for (const tool of tools) {
    if (!tool.output) continue;
    const o = typeof tool.output === "string" ? (() => { try { return JSON.parse(tool.output); } catch { return null; } })() : tool.output;
    if (!o || typeof o !== "object") continue;
    const rawWatch = typeof o.watch_url === "string" ? o.watch_url
      : ((tool.name === "bwb_weekly_build" || tool.name === "build_video_from_brief" || tool.name === "produce_video") && typeof o.watch_progress_url === "string") ? o.watch_progress_url
      : undefined;
    const rawDownload = typeof o.download_url === "string" ? o.download_url
      : (typeof o.url === "string" && (o.url.startsWith("/v/") || o.url.startsWith("/uploads/") || /\.(mp4|mp3|wav|m4a|pdf|zip|docx|pptx)$/i.test(o.url))) ? (o.url.includes("?") ? o.url : `${o.url}${o.url.startsWith("/v/") ? "?dl=1" : ""}`)
      : undefined;
    const rawDrive = typeof o.drive_url === "string" ? o.drive_url : (typeof o.driveUrl === "string" ? o.driveUrl : undefined);
    const watchUrl = isSafeDeliverableUrl(rawWatch) ? rawWatch : undefined;
    const downloadUrl = isSafeDeliverableUrl(rawDownload) ? rawDownload : undefined;
    const driveUrl = isSafeDeliverableUrl(rawDrive) ? rawDrive : undefined;
    if (!watchUrl && !downloadUrl && !driveUrl) continue;
    const probe = (watchUrl || downloadUrl || driveUrl || "").toLowerCase();
    let kind: Deliverable["kind"] = "file";
    if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(probe) || /\/v\/.*\.mp4/.test(probe) || tool.name === "bwb_weekly_build" || tool.name === "produce_video" || tool.name === "create_slideshow_video" || tool.name === "build_video_from_brief") kind = "video";
    else if (/\.(mp3|wav|m4a|ogg)(\?|$)/.test(probe) || tool.name === "generate_audio") kind = "audio";
    else if (/\.pdf(\?|$)/.test(probe) || tool.name === "create_pdf") kind = "pdf";
    else if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(probe) || tool.name === "generate_image" || tool.name === "generate_social_image") kind = "image";
    const title = (typeof o.title === "string" && o.title) || (typeof o.filename === "string" && o.filename)
      || (downloadUrl ? safeDecode(downloadUrl.split("?")[0].split("/").pop() || "") : "")
      || (watchUrl ? safeDecode(watchUrl.split("?")[0].split("/").pop() || "") : "")
      || `${kind.charAt(0).toUpperCase() + kind.slice(1)} ready`;
    const emailedTo = typeof o.emailed_to === "string" ? o.emailed_to : (typeof o.email_to === "string" ? o.email_to : undefined);
    out.push({ toolName: tool.name, kind, title, watchUrl, downloadUrl, driveUrl, emailedTo });
  }
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = d.downloadUrl || d.watchUrl || d.driveUrl;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();
}