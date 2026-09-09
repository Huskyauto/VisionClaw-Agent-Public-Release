/**
 * Built With Bob — weekly Shorts discovery.
 *
 * Enumerates the connected `@built-with-bob` channel's uploads inside a trailing
 * date window and returns the SHORT-FORM dailies only — the ~5-min weekly
 * recap production is excluded by a duration ceiling (and a title guard) so the
 * weekly synthesizer never feeds on its own output (no feedback loop).
 *
 * Uses the canonical YouTube OAuth refresh flow (getYouTubeAccessToken →
 * YOUTUBE_REFRESH_TOKEN), so it works headless from a script with no re-auth.
 */
import { getYouTubeAccessToken } from "../../server/oauth-subscriptions";

const YT_BASE = "https://www.googleapis.com/youtube/v3";

export interface DiscoveredShort {
  videoId: string;
  url: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
}

export interface DiscoverOptions {
  tenantId?: number;
  /** Trailing window in days (default 7). */
  days?: number;
  /** Duration ceiling in seconds — clips longer than this are treated as the weekly long-form and excluded (default 120). */
  maxDurationSec?: number;
  /** Regex that, when it matches a title, excludes the video (default: weekly-recap titles). */
  excludeTitlePattern?: RegExp;
  /** Hard cap on how many uploads to inspect (default 50). */
  scanLimit?: number;
}

const DEFAULT_EXCLUDE = /\b(weekly|week of|recap|the week)\b/i;

/** Parse an ISO-8601 duration (PT#H#M#S) into whole seconds. */
export function parseIso8601Duration(iso: string | undefined | null): number {
  if (!iso || typeof iso !== "string") return 0;
  const m = iso.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

async function ytGet(url: string, token: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    throw new Error(`YouTube API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * Discover this week's short-form dailies. Returns newest-first.
 * Throws if YouTube is not connected (no token).
 */
export async function discoverWeeklyShorts(opts: DiscoverOptions = {}): Promise<DiscoveredShort[]> {
  const tenantId = (opts.tenantId ?? Number(process.env.ADMIN_TENANT_ID)) || 1;
  const days = (opts.days ?? Number(process.env.BWB_DISCOVER_DAYS)) || 7;
  const maxDurationSec = (opts.maxDurationSec ?? Number(process.env.BWB_MAX_SHORT_SEC)) || 120;
  const excludeTitlePattern = opts.excludeTitlePattern ?? DEFAULT_EXCLUDE;
  const scanLimit = Math.min(opts.scanLimit ?? 50, 50);

  const token = await getYouTubeAccessToken(tenantId);
  if (!token) {
    throw new Error("YouTube is not connected (no access token). Set YOUTUBE_REFRESH_TOKEN or connect via /api/youtube/connect.");
  }

  // 1. Resolve the uploads playlist for the connected channel.
  const chD = await ytGet(`${YT_BASE}/channels?part=contentDetails&mine=true`, token);
  const uploadsId = chD.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("No uploads playlist found for the connected channel.");

  // 2. List the most recent uploads (uploads playlist is newest-first).
  const plD = await ytGet(
    `${YT_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=${scanLimit}`,
    token,
  );
  const items: any[] = plD.items || [];
  const cutoff = Date.now() - days * 24 * 3600 * 1000;

  // 3. Keep only those published inside the trailing window.
  const inWindow = items
    .map((v) => ({
      videoId: v.contentDetails?.videoId as string | undefined,
      title: (v.snippet?.title as string) || "",
      publishedAt: (v.contentDetails?.videoPublishedAt || v.snippet?.publishedAt) as string,
    }))
    .filter((v) => v.videoId && v.publishedAt && new Date(v.publishedAt).getTime() >= cutoff);

  if (inWindow.length === 0) return [];

  // 4. Fetch durations in one batched videos call (≤50 ids).
  const ids = inWindow.map((v) => v.videoId).join(",");
  const vD = await ytGet(`${YT_BASE}/videos?part=contentDetails,snippet&id=${ids}`, token);
  const durById = new Map<string, number>();
  for (const v of vD.items || []) {
    durById.set(v.id, parseIso8601Duration(v.contentDetails?.duration));
  }

  // 5. Shorts-only filter: duration ceiling + title guard against the weekly recap.
  const shorts: DiscoveredShort[] = [];
  for (const v of inWindow) {
    const dur = durById.get(v.videoId!) ?? 0;
    if (dur <= 0 || dur > maxDurationSec) continue; // long-form weekly / unknown → skip
    if (excludeTitlePattern.test(v.title)) continue; // belt-and-suspenders title guard
    shorts.push({
      videoId: v.videoId!,
      url: `https://www.youtube.com/shorts/${v.videoId}`,
      title: v.title,
      publishedAt: v.publishedAt,
      durationSeconds: dur,
    });
  }

  shorts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return shorts;
}
