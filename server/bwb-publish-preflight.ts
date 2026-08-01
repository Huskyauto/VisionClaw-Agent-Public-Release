/**
 * Built With Bob — weekly publish readiness preflight.
 *
 * Answers ONE question before we ask Bob to approve a recap: will an approve
 * click actually deliver to YouTube AND Facebook, or will it silently half-fail?
 *
 * - YouTube ready  ⇢ getYouTubeAccessToken() resolves a live token (refresh
 *   token valid + oauth_subscriptions row active). A revoked refresh token
 *   (invalid_grant) or an inactive row returns null ⇒ NOT ready.
 * - Facebook ready ⇢ an ENABLED social_connections row exists for the tenant.
 *
 * Never throws — always returns a per-platform verdict the caller can surface.
 */
import { getYouTubeAccessToken } from "./oauth-subscriptions";
import { getSocialConnections } from "./social-publisher";

export interface PlatformReadiness {
  ready: boolean;
  reason: string;
}

export interface WeeklyPublishReadiness {
  youtube: PlatformReadiness;
  facebook: PlatformReadiness;
  allReady: boolean;
  anyReady: boolean;
}

export async function checkWeeklyPublishReadiness(tenantId: number): Promise<WeeklyPublishReadiness> {
  let youtube: PlatformReadiness;
  try {
    const token = await getYouTubeAccessToken(tenantId);
    youtube = token
      ? { ready: true, reason: "connected" }
      : {
          ready: false,
          reason:
            "YouTube not authorized — no live access token (refresh token revoked/expired or the channel is not connected). Re-authorize the channel to mint a fresh YOUTUBE_REFRESH_TOKEN.",
        };
  } catch (e: any) {
    youtube = { ready: false, reason: `YouTube readiness check errored: ${e?.message || e}` };
  }

  let facebook: PlatformReadiness;
  try {
    const conns = await getSocialConnections(tenantId);
    const fb = conns.find((c) => c.platform === "facebook" && c.enabled);
    facebook = fb
      ? { ready: true, reason: `connected${fb.accountName ? ` (${fb.accountName})` : ""}` }
      : {
          ready: false,
          reason:
            "Facebook Page not connected — no enabled connection. Connect a Page with the pages_manage_posts scope so native video can post.",
        };
  } catch (e: any) {
    facebook = { ready: false, reason: `Facebook readiness check errored: ${e?.message || e}` };
  }

  return {
    youtube,
    facebook,
    allReady: youtube.ready && facebook.ready,
    anyReady: youtube.ready || facebook.ready,
  };
}

/** Compact one-line-per-platform summary for emails/logs. */
export function readinessLines(r: WeeklyPublishReadiness): string {
  const mark = (p: PlatformReadiness) => (p.ready ? `✅ ${p.reason}` : `⚠️ ${p.reason}`);
  return `YouTube: ${mark(r.youtube)}\nFacebook: ${mark(r.facebook)}`;
}
