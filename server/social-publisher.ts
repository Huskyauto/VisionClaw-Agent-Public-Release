import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";
import crypto from "crypto";

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function generateOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  tokenKey: string,
  tokenSecret: string,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: tokenKey,
    oauth_version: "1.0",
  };

  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams["oauth_signature"] = signature;
  const header = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

function getXEnvKeys(): { apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string } | null {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

const X_OWNER_TENANT_ID = 1;

export function getXOwnerTenantId(): number {
  return X_OWNER_TENANT_ID;
}

async function xApiRequest(method: string, url: string, body?: any, queryParams?: Record<string, string>): Promise<any> {
  const keys = getXEnvKeys();
  if (!keys) throw new Error("X/Twitter API keys not configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.");

  const urlObj = new URL(url);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) urlObj.searchParams.set(k, v);
  }
  const baseUrl = urlObj.origin + urlObj.pathname;

  const signPairs: [string, string][] = [];
  urlObj.searchParams.forEach((v, k) => { signPairs.push([k, v]); });

  const signParams: Record<string, string> = {};
  for (const [k, v] of signPairs) signParams[k] = v;

  const authHeader = generateOAuth1Header(method, baseUrl, signParams, keys.apiKey, keys.apiSecret, keys.accessToken, keys.accessTokenSecret);

  const headers: Record<string, string> = { Authorization: authHeader };
  const fetchOpts: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
    headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(urlObj.toString(), fetchOpts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.detail || data?.title || data?.errors?.[0]?.message || JSON.stringify(data);
    throw new Error(`X API ${res.status}: ${errMsg}`);
  }
  return data;
}

export interface SocialConnection {
  id: number;
  tenantId: number;
  platform: string;
  accountName: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  scopes: string;
  enabled: boolean;
  connectedAt: string;
}

export interface PublishResult {
  success: boolean;
  platform: string;
  postId?: string;
  postUrl?: string;
  error?: string;
  metadata?: Record<string, any>;
}

const PLATFORM_CONFIGS: Record<string, {
  name: string;
  apiBase: string;
  oauthUrl: string;
  tokenUrl: string;
  requiredScopes: string[];
  maxImageSize: number;
  supportedImageTypes: string[];
  characterLimit: number;
}> = {
  x: {
    name: "X (Twitter)",
    apiBase: "https://api.twitter.com/2",
    oauthUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    requiredScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    maxImageSize: 5 * 1024 * 1024,
    supportedImageTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    characterLimit: 280,
  },
  linkedin: {
    name: "LinkedIn",
    apiBase: "https://api.linkedin.com/v2",
    oauthUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    requiredScopes: ["w_member_social", "r_liteprofile"],
    maxImageSize: 10 * 1024 * 1024,
    supportedImageTypes: ["image/png", "image/jpeg", "image/gif"],
    characterLimit: 3000,
  },
  instagram: {
    name: "Instagram",
    apiBase: "https://graph.instagram.com/v18.0",
    oauthUrl: "https://api.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    requiredScopes: ["instagram_basic", "instagram_content_publish"],
    maxImageSize: 8 * 1024 * 1024,
    supportedImageTypes: ["image/jpeg", "image/png"],
    characterLimit: 2200,
  },
  facebook: {
    name: "Facebook",
    apiBase: "https://graph.facebook.com/v18.0",
    oauthUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    requiredScopes: ["pages_manage_posts", "pages_read_engagement"],
    maxImageSize: 10 * 1024 * 1024,
    supportedImageTypes: ["image/png", "image/jpeg", "image/gif"],
    characterLimit: 63206,
  },
};

async function ensureSocialTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS social_connections (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      account_name TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at BIGINT,
      scopes TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT true,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, platform)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS social_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      image_drive_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_for TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      platform_post_id TEXT,
      platform_post_url TEXT,
      engagement_data JSONB DEFAULT '{}',
      campaign TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

let tablesReady = false;
async function getTablesReady() {
  if (!tablesReady) {
    await ensureSocialTables();
    tablesReady = true;
  }
}

export async function getSocialConnections(tenantId: number): Promise<SocialConnection[]> {
  await getTablesReady();
  const result = await db.execute(sql`
    SELECT id, tenant_id, platform, account_name, access_token, refresh_token, 
           token_expires_at, scopes, enabled, connected_at
    FROM social_connections WHERE tenant_id = ${tenantId}
  `);
  return ((result as any).rows || []).map((r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
    platform: r.platform,
    accountName: r.account_name,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: r.token_expires_at ? Number(r.token_expires_at) : null,
    scopes: r.scopes,
    enabled: r.enabled,
    connectedAt: r.connected_at,
  }));
}

export async function connectSocialAccount(params: {
  tenantId: number;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  accountName?: string;
  scopes?: string;
}): Promise<any> {
  await getTablesReady();
  const config = PLATFORM_CONFIGS[params.platform];
  if (!config) return { error: `Unsupported platform: ${params.platform}. Supported: ${Object.keys(PLATFORM_CONFIGS).join(", ")}` };

  const result = await db.execute(sql`
    INSERT INTO social_connections (tenant_id, platform, access_token, refresh_token, token_expires_at, account_name, scopes)
    VALUES (${params.tenantId}, ${params.platform}, ${params.accessToken}, ${params.refreshToken || null}, 
            ${params.tokenExpiresAt || null}, ${params.accountName || ""}, ${params.scopes || config.requiredScopes.join(",")})
    ON CONFLICT (tenant_id, platform) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, social_connections.refresh_token),
      token_expires_at = EXCLUDED.token_expires_at,
      account_name = EXCLUDED.account_name,
      scopes = EXCLUDED.scopes,
      enabled = true,
      updated_at = NOW()
    RETURNING id, platform, account_name, enabled
  `);
  const row = (result as any).rows?.[0] || result;
  return { success: true, connection: row };
}

export async function disconnectSocialAccount(tenantId: number, platform: string): Promise<any> {
  await getTablesReady();
  await db.execute(sql`
    UPDATE social_connections SET enabled = false, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND platform = ${platform}
  `);
  return { success: true, platform, status: "disconnected" };
}

export async function publishToX(_connection: SocialConnection | null, content: string, _imageBase64?: string): Promise<PublishResult> {
  try {
    const tweetBody: any = { text: content };
    const data = await xApiRequest("POST", "https://api.twitter.com/2/tweets", tweetBody);
    return {
      success: true,
      platform: "x",
      postId: data.data?.id,
      postUrl: `https://x.com/i/status/${data.data?.id}`,
    };
  } catch (err: any) {
    return { success: false, platform: "x", error: err.message };
  }
}

export async function xPostTweet(text: string, replyToId?: string, quoteId?: string): Promise<any> {
  const body: any = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  if (quoteId) body.quote_tweet_id = quoteId;
  const data = await xApiRequest("POST", "https://api.twitter.com/2/tweets", body);
  return { success: true, tweetId: data.data?.id, tweetUrl: `https://x.com/i/status/${data.data?.id}`, text: data.data?.text };
}

export async function xDeleteTweet(tweetId: string): Promise<any> {
  const data = await xApiRequest("DELETE", `https://api.twitter.com/2/tweets/${tweetId}`);
  return { success: true, deleted: data.data?.deleted };
}

export async function xGetTweet(tweetId: string): Promise<any> {
  const data = await xApiRequest("GET", `https://api.twitter.com/2/tweets/${tweetId}`, undefined, {
    "tweet.fields": "created_at,public_metrics,author_id,conversation_id",
  });
  return data.data || data;
}

export async function xGetMentions(count: number = 10): Promise<any> {
  const keys = getXEnvKeys();
  if (!keys) throw new Error("X API keys not configured");
  const userId = process.env.X_USER_ID;
  if (!userId) {
    const me = await xApiRequest("GET", "https://api.twitter.com/2/users/me");
    process.env.X_USER_ID = me.data?.id;
    return xGetMentions(count);
  }
  const data = await xApiRequest("GET", `https://api.twitter.com/2/users/${userId}/mentions`, undefined, {
    max_results: String(Math.min(Math.max(count, 5), 100)),
    "tweet.fields": "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id",
    expansions: "author_id",
    "user.fields": "name,username",
  });
  const users = (data.includes?.users || []).reduce((m: any, u: any) => { m[u.id] = u; return m; }, {});
  const tweets = (data.data || []).map((t: any) => ({
    id: t.id,
    text: t.text,
    createdAt: t.created_at,
    authorId: t.author_id,
    authorName: users[t.author_id]?.name,
    authorUsername: users[t.author_id]?.username,
    metrics: t.public_metrics,
  }));
  return { mentions: tweets, count: tweets.length };
}

export async function xGetTimeline(username: string, count: number = 10): Promise<any> {
  const userLookup = await xApiRequest("GET", `https://api.twitter.com/2/users/by/username/${username}`, undefined, {
    "user.fields": "id,name,username,public_metrics",
  });
  const userId = userLookup.data?.id;
  if (!userId) throw new Error(`User @${username} not found`);
  const data = await xApiRequest("GET", `https://api.twitter.com/2/users/${userId}/tweets`, undefined, {
    max_results: String(Math.min(Math.max(count, 5), 100)),
    "tweet.fields": "created_at,public_metrics",
  });
  return {
    user: { id: userId, name: userLookup.data.name, username: userLookup.data.username, metrics: userLookup.data.public_metrics },
    tweets: (data.data || []).map((t: any) => ({ id: t.id, text: t.text, createdAt: t.created_at, metrics: t.public_metrics })),
  };
}

export async function xSearchRecent(query: string, count: number = 10): Promise<any> {
  const data = await xApiRequest("GET", "https://api.twitter.com/2/tweets/search/recent", undefined, {
    query,
    max_results: String(Math.min(Math.max(count, 10), 100)),
    "tweet.fields": "created_at,public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "name,username",
  });
  const users = (data.includes?.users || []).reduce((m: any, u: any) => { m[u.id] = u; return m; }, {});
  return {
    query,
    tweets: (data.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      authorUsername: users[t.author_id]?.username,
      metrics: t.public_metrics,
    })),
    count: data.meta?.result_count || 0,
  };
}

export async function xLikeTweet(tweetId: string): Promise<any> {
  const keys = getXEnvKeys();
  if (!keys) throw new Error("X API keys not configured");
  let userId = process.env.X_USER_ID;
  if (!userId) {
    const me = await xApiRequest("GET", "https://api.twitter.com/2/users/me");
    userId = me.data?.id;
    process.env.X_USER_ID = userId!;
  }
  const data = await xApiRequest("POST", `https://api.twitter.com/2/users/${userId}/likes`, { tweet_id: tweetId });
  return { success: true, liked: data.data?.liked };
}

export async function xRetweet(tweetId: string): Promise<any> {
  const keys = getXEnvKeys();
  if (!keys) throw new Error("X API keys not configured");
  let userId = process.env.X_USER_ID;
  if (!userId) {
    const me = await xApiRequest("GET", "https://api.twitter.com/2/users/me");
    userId = me.data?.id;
    process.env.X_USER_ID = userId!;
  }
  const data = await xApiRequest("POST", `https://api.twitter.com/2/users/${userId}/retweets`, { tweet_id: tweetId });
  return { success: true, retweeted: data.data?.retweeted };
}

export async function xGetMe(): Promise<any> {
  const data = await xApiRequest("GET", "https://api.twitter.com/2/users/me", undefined, {
    "user.fields": "name,username,public_metrics,description,profile_image_url,created_at",
  });
  return data.data || data;
}

export function isXConfigured(): boolean {
  return getXEnvKeys() !== null;
}

export async function publishToLinkedIn(connection: SocialConnection, content: string, imageBase64?: string): Promise<PublishResult> {
  try {
    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { "Authorization": `Bearer ${connection.accessToken}` },
    });
    if (!profileRes.ok) {
      return { success: false, platform: "linkedin", error: `LinkedIn profile fetch failed: ${profileRes.status}` };
    }
    const profile = await profileRes.json();
    const authorUrn = `urn:li:person:${profile.sub}`;

    let imageUrn: string | undefined;
    if (imageBase64) {
      const registerRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: authorUrn,
            serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
          },
        }),
      });
      
      if (registerRes.ok) {
        const registerData = await registerRes.json();
        const uploadUrl = registerData.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
        imageUrn = registerData.value?.asset;

        if (uploadUrl && imageUrn) {
          const imgBuffer = Buffer.from(imageBase64, "base64");
          await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${connection.accessToken}`,
              "Content-Type": "image/png",
            },
            body: imgBuffer,
          });
        }
      }
    }

    const postBody: any = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: imageUrn ? "IMAGE" : "NONE",
          ...(imageUrn ? {
            media: [{
              status: "READY",
              media: imageUrn,
            }],
          } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${connection.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(postBody),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, platform: "linkedin", error: `LinkedIn API error ${res.status}: ${JSON.stringify(err)}` };
    }

    const data = await res.json();
    return {
      success: true,
      platform: "linkedin",
      postId: data.id,
      postUrl: `https://www.linkedin.com/feed/update/${data.id}`,
    };
  } catch (err: any) {
    return { success: false, platform: "linkedin", error: err.message };
  }
}

export async function publishToInstagram(connection: SocialConnection, content: string, imageUrl?: string): Promise<PublishResult> {
  try {
    if (!imageUrl) {
      return { success: false, platform: "instagram", error: "Instagram requires an image URL (must be publicly accessible HTTPS)" };
    }

    const createRes = await fetch(`https://graph.instagram.com/v18.0/me/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: content,
        access_token: connection.accessToken,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return { success: false, platform: "instagram", error: `Instagram container error ${createRes.status}: ${JSON.stringify(err)}` };
    }

    const container = await createRes.json();

    const publishRes = await fetch(`https://graph.instagram.com/v18.0/me/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: connection.accessToken,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.json().catch(() => ({}));
      return { success: false, platform: "instagram", error: `Instagram publish error ${publishRes.status}: ${JSON.stringify(err)}` };
    }

    const published = await publishRes.json();
    return {
      success: true,
      platform: "instagram",
      postId: published.id,
      postUrl: `https://www.instagram.com/p/${published.id}`,
    };
  } catch (err: any) {
    return { success: false, platform: "instagram", error: err.message };
  }
}

// R115.4 — Threads publisher (Meta Graph API, mirrors the Instagram 2-step pattern).
// Endpoint: graph.threads.net/v1.0/me/threads → /me/threads_publish
// Requires the connection's accessToken to have scopes: threads_basic, threads_content_publish.
// Text-only or text+image. Image must be a public https URL.
export async function publishToThreads(
  connection: SocialConnection,
  content: string,
  imageUrl?: string,
): Promise<PublishResult> {
  try {
    const createBody: Record<string, any> = {
      media_type: imageUrl ? "IMAGE" : "TEXT",
      text: content,
      access_token: connection.accessToken,
    };
    if (imageUrl) createBody.image_url = imageUrl;

    const createRes = await fetch(`https://graph.threads.net/v1.0/me/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
      signal: AbortSignal.timeout(20000),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return { success: false, platform: "threads", error: `Threads container error ${createRes.status}: ${JSON.stringify(err).slice(0, 300)}` };
    }
    const container = await createRes.json();

    const publishRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: connection.accessToken }),
      signal: AbortSignal.timeout(20000),
    });
    if (!publishRes.ok) {
      const err = await publishRes.json().catch(() => ({}));
      return { success: false, platform: "threads", error: `Threads publish error ${publishRes.status}: ${JSON.stringify(err).slice(0, 300)}` };
    }
    const published = await publishRes.json();
    return {
      success: true,
      platform: "threads",
      postId: published.id,
      postUrl: published.permalink || `https://www.threads.net/@${encodeURIComponent(connection.accountName)}/post/${published.id}`,
    };
  } catch (err: any) {
    return { success: false, platform: "threads", error: err.message };
  }
}

// R115.4 — Pinterest publisher (API v5, /pins).
// Picks a board id from connection.scopes-stored metadata (if present) or
// the optional boardId override. If neither is supplied AND the tenant has
// multiple boards, picks the first board returned by /v5/boards and surfaces
// the chosen board in metadata (mirrors Facebook Page auto-pick pattern).
// Image-first: requires imageUrl (public https).
export async function publishToPinterest(
  connection: SocialConnection,
  content: string,
  imageUrl?: string,
  boardId?: string,
  title?: string,
): Promise<PublishResult> {
  try {
    if (!imageUrl) {
      return { success: false, platform: "pinterest", error: "Pinterest requires an image URL (must be publicly accessible HTTPS)" };
    }
    if (!/^https:\/\//i.test(imageUrl)) {
      return { success: false, platform: "pinterest", error: "Pinterest imageUrl must be an https URL" };
    }

    let targetBoardId = boardId;
    let targetBoardName: string | undefined;
    let totalBoards: number | undefined;
    if (!targetBoardId) {
      const boardsRes = await fetch(`https://api.pinterest.com/v5/boards?page_size=25`, {
        method: "GET",
        headers: { Authorization: `Bearer ${connection.accessToken}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!boardsRes.ok) {
        const errText = await boardsRes.text();
        return { success: false, platform: "pinterest", error: `Failed to list boards: ${boardsRes.status} ${errText.slice(0, 200)}` };
      }
      const boardsJson: any = await boardsRes.json();
      const items = Array.isArray(boardsJson?.items) ? boardsJson.items : [];
      if (items.length === 0) {
        return { success: false, platform: "pinterest", error: "No Pinterest boards found on the connected account. Create a board first or pass boardId explicitly." };
      }
      targetBoardId = items[0].id;
      targetBoardName = items[0].name;
      totalBoards = items.length;
      if (items.length > 1) {
        console.warn(
          `[publishToPinterest] tenant=${connection.tenantId} has ${items.length} boards; auto-selected board id=${targetBoardId} name="${targetBoardName}" (no boardId override supplied). Caller should pass boardId explicitly if a different board is intended.`,
        );
      }
    }

    const pinBody: Record<string, any> = {
      board_id: targetBoardId,
      media_source: { source_type: "image_url", url: imageUrl },
      description: content.slice(0, 500),
    };
    if (title) pinBody.title = title.slice(0, 100);

    const pinRes = await fetch(`https://api.pinterest.com/v5/pins`, {
      method: "POST",
      headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(pinBody),
      signal: AbortSignal.timeout(30000),
    });
    if (!pinRes.ok) {
      const errText = await pinRes.text();
      return { success: false, platform: "pinterest", error: `Pinterest pin error ${pinRes.status}: ${errText.slice(0, 300)}` };
    }
    const pin = await pinRes.json();
    return {
      success: true,
      platform: "pinterest",
      postId: pin.id,
      postUrl: `https://www.pinterest.com/pin/${pin.id}/`,
      metadata: targetBoardName ? { boardId: targetBoardId, boardName: targetBoardName, totalBoards } : { boardId: targetBoardId },
    };
  } catch (err: any) {
    return { success: false, platform: "pinterest", error: err.message };
  }
}

// R113.6 Round B — Facebook Page feed publisher.
// Uses the user's Graph API token to enumerate /me/accounts, picks the first
// managed Page (or a Page whose id matches `params.pageId` if supplied), then
// posts to /{pageId}/feed (text) or /{pageId}/photos (image+caption) using
// that page's access_token. Image is passed as a public URL — we do NOT
// re-upload base64 because the Graph API photos endpoint takes a URL only.
async function publishToFacebook(
  connection: SocialConnection,
  content: string,
  imageUrl?: string,
  pageId?: string,
  videoUrl?: string,
  driveFileId?: string,
  title?: string,
): Promise<PublishResult> {
  try {
    // 1. Resolve Page id + page access token.
    const pagesResp = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${encodeURIComponent(connection.accessToken)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!pagesResp.ok) {
      const errText = await pagesResp.text();
      return { success: false, platform: "facebook", error: `Failed to fetch managed Pages: ${pagesResp.status} ${errText.slice(0, 200)}` };
    }
    const pagesData = await pagesResp.json();
    const pages: any[] = pagesData?.data || [];
    if (pages.length === 0) {
      return { success: false, platform: "facebook", error: "No managed Facebook Pages found on this account. The pages_manage_posts scope is required and at least one Page must be linked." };
    }
    const chosen = pageId
      ? pages.find((p) => String(p.id) === String(pageId))
      : pages[0];
    if (!chosen) {
      return { success: false, platform: "facebook", error: `Page id ${pageId} not found among managed Pages.` };
    }
    const pageAccessToken: string = chosen.access_token;
    const targetPageId: string = chosen.id;
    const targetPageName: string = chosen.name || "(unnamed)";
    if (!pageAccessToken) {
      return { success: false, platform: "facebook", error: "Page did not return an access_token (missing pages_manage_posts scope?)." };
    }
    // Architect MEDIUM-1 (R113.6): when pageId isn't supplied and Bob manages
    // multiple Pages, log which one we auto-selected so a wrong-page post is
    // visible in the heartbeat logs (and the chosen page is also surfaced on
    // the return value so the runner records it in per_platform_results).
    if (!pageId && pages.length > 1) {
      console.warn(
        `[publishToFacebook] tenant=${connection.tenantId} manages ${pages.length} Pages; auto-selected page id=${targetPageId} name="${targetPageName}" (no pageId override supplied). Caller should pass pageId explicitly if a different Page is intended.`,
      );
    }

    // 2a. NATIVE VIDEO — when a video is supplied, upload the bytes to the Page's
    // /videos endpoint (multipart) so it plays as a native Facebook video rather
    // than a link card. Same download discipline as the YouTube bridge: Drive
    // file id goes through the Drive helper; an external https URL goes through
    // the SSRF jail with a 256MB cap.
    if (videoUrl || driveFileId) {
      let videoBuffer: Buffer;
      if (driveFileId) {
        const { downloadFromDrive } = await import("./google-drive");
        const dl = await downloadFromDrive({ fileId: driveFileId });
        if (!dl.success || !dl.path) {
          return { success: false, platform: "facebook", error: `Drive download failed: ${dl.error || driveFileId}` };
        }
        const fsMod = await import("fs");
        videoBuffer = fsMod.readFileSync(dl.path);
      } else {
        if (!/^https:\/\//i.test(videoUrl!)) {
          return { success: false, platform: "facebook", error: "videoUrl must be an https URL." };
        }
        const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
        const { ssrfSafeFetchBytes } = await import("./lib/ssrf-jail");
        const jailed = await ssrfSafeFetchBytes(videoUrl!, {
          timeoutMs: 120_000,
          maxBytes: MAX_VIDEO_BYTES,
          userAgent: "VisionClaw-Scheduler/1.0 (+https://visionclaw.ai)",
        });
        if (!jailed.ok) {
          return {
            success: false,
            platform: "facebook",
            error: `videoUrl rejected by SSRF jail: ${jailed.reason}. Use a Drive file id for internal sources.`,
          };
        }
        videoBuffer = jailed.bytes;
      }

      const form = new FormData();
      form.set("access_token", pageAccessToken);
      form.set("description", content);
      if (title) form.set("title", title.slice(0, 255));
      form.set("source", new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" }), "video.mp4");

      const vidResp = await fetch(`https://graph-video.facebook.com/v18.0/${targetPageId}/videos`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(300000),
      });
      if (!vidResp.ok) {
        const errText = await vidResp.text();
        return { success: false, platform: "facebook", error: `Facebook video publish failed: ${vidResp.status} ${errText.slice(0, 300)}` };
      }
      const vidData = await vidResp.json();
      const vidId: string | undefined = vidData?.id;
      return {
        success: true,
        platform: "facebook",
        postId: vidId,
        postUrl: vidId ? `https://www.facebook.com/${targetPageId}/videos/${vidId}` : undefined,
        metadata: { pageId: targetPageId, pageName: targetPageName, totalManagedPages: pages.length, kind: "video" },
      };
    }

    // 2. Post — photos endpoint if imageUrl, else feed endpoint.
    let url: string;
    const body = new URLSearchParams();
    if (imageUrl) {
      url = `https://graph.facebook.com/v18.0/${targetPageId}/photos`;
      body.set("url", imageUrl);
      body.set("caption", content);
    } else {
      url = `https://graph.facebook.com/v18.0/${targetPageId}/feed`;
      body.set("message", content);
    }
    body.set("access_token", pageAccessToken);

    const postResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!postResp.ok) {
      const errText = await postResp.text();
      return { success: false, platform: "facebook", error: `Facebook publish failed: ${postResp.status} ${errText.slice(0, 300)}` };
    }
    const published = await postResp.json();
    // photos returns {id, post_id}; feed returns {id} where id is "{page}_{post}".
    const postId: string | undefined = published?.post_id || published?.id;
    return {
      success: true,
      platform: "facebook",
      postId,
      postUrl: postId ? `https://www.facebook.com/${postId.replace(/_/g, "/posts/")}` : undefined,
      metadata: { pageId: targetPageId, pageName: targetPageName, totalManagedPages: pages.length },
    };
  } catch (err: any) {
    return { success: false, platform: "facebook", error: err?.message || "facebook publish exception" };
  }
}

// R113.6 Round B — YouTube video-bridge.
// The cross-platform scheduler is text+image first, but YouTube is video-only,
// so we require `videoUrl` (or `driveFileId`) — the runner enforces this at
// schedule time. Here we download to a Buffer, then dispatch through the
// proven resumable-upload path adapted from server/tools.ts:11459-11543.
// We deliberately treat YouTube videos as PRIVATE by default — public
// scheduling of YT uploads from a cross-platform tool would be too easy a
// foot-gun for Bob's brand. Operator can flip to "public" via metadata.
async function publishToYouTube(
  connection: SocialConnection,
  content: string,
  videoUrl?: string,
  driveFileId?: string,
  title?: string,
  privacyStatus?: string,
  tags?: string[],
): Promise<PublishResult> {
  if (!videoUrl && !driveFileId) {
    return { success: false, platform: "youtube", error: "videoUrl or driveFileId is required for YouTube — text-only posts are not supported by the YouTube Data API." };
  }
  try {
    // Resolve a fresh YouTube access token via the canonical refresh flow.
    const { getYouTubeAccessToken } = await import("./oauth-subscriptions");
    let ytToken = await getYouTubeAccessToken(connection.tenantId);
    if (!ytToken) {
      return { success: false, platform: "youtube", error: "YouTube is not connected. Connect via Settings → Social Media or /api/youtube/connect." };
    }

    // 1. Download the video to a buffer (URL OR Drive).
    let videoBuffer: Buffer;
    if (driveFileId) {
      const { downloadFromDrive } = await import("./google-drive");
      const dl = await downloadFromDrive({ fileId: driveFileId });
      if (!dl.success || !dl.path) {
        return { success: false, platform: "youtube", error: `Drive download failed: ${dl.error || driveFileId}` };
      }
      const fsMod = await import("fs");
      videoBuffer = fsMod.readFileSync(dl.path);
    } else {
      // Guard against SSRF + non-https + giant downloads. Architect HIGH-1
      // (R113.6): arrayBuffer() before the size check let a malicious server
      // stream gigabytes into memory before we even saw the byteLength. Now:
      //   1. https-only.
      //   2. Reject upfront if Content-Length advertises >256MB.
      //   3. Stream-read with a running byte counter; abort the request if
      //      the cap is exceeded mid-stream.
      // R113.6 +sec v2 (architect HIGH-2 closed) — full SSRF jail on videoUrl.
      // Previously the only guard was an https-only regex, so a caller could
      // point videoUrl at http://169.254.169.254 (cloud metadata), an RFC1918
      // host, *.railway.internal, an IPv6 link-local, or a public URL that
      // 30x-redirects into one. ssrfSafeFetchBytes resolves the hostname,
      // rejects private / link-local / metadata IPs and internal suffixes
      // BEFORE opening the socket, follows redirects with each hop re-jailed,
      // and enforces the 256MB cap as a streaming byte counter (same UX as
      // before, but every check happens behind the jail). https-only + the
      // 120s deadline are preserved by passing them into the jail helper.
      if (!/^https:\/\//i.test(videoUrl!)) {
        return { success: false, platform: "youtube", error: "videoUrl must be an https URL." };
      }
      const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
      const { ssrfSafeFetchBytes } = await import("./lib/ssrf-jail");
      const jailed = await ssrfSafeFetchBytes(videoUrl!, {
        timeoutMs: 120_000,
        maxBytes: MAX_VIDEO_BYTES,
        userAgent: "VisionClaw-Scheduler/1.0 (+https://visionclaw.ai)",
      });
      if (!jailed.ok) {
        return {
          success: false,
          platform: "youtube",
          error: `videoUrl rejected by SSRF jail: ${jailed.reason}. Use the dedicated youtube tool with a Drive file id for internal sources.`,
        };
      }
      videoBuffer = jailed.bytes;
    }

    // 2. Init the resumable upload.
    const safePrivacy = ["public", "unlisted", "private"].includes(String(privacyStatus))
      ? String(privacyStatus)
      : "private";
    const metadata = {
      snippet: {
        title: (title || content.split("\n")[0] || "Untitled").slice(0, 100),
        description: content.slice(0, 5000),
        tags: Array.isArray(tags) ? tags.slice(0, 30) : ([] as string[]),
        categoryId: "22",
      },
      status: {
        privacyStatus: safePrivacy,
        selfDeclaredMadeForKids: false,
      },
    };

    let initResp = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ytToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(videoBuffer.length),
          "X-Upload-Content-Type": "video/*",
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (initResp.status === 401) {
      // One forced-refresh retry.
      const newToken = await getYouTubeAccessToken(connection.tenantId, true);
      if (newToken) {
        ytToken = newToken;
        initResp = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ytToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(videoBuffer.length),
              "X-Upload-Content-Type": "video/*",
            },
            body: JSON.stringify(metadata),
            signal: AbortSignal.timeout(30000),
          },
        );
      }
    }
    if (!initResp.ok) {
      const errText = await initResp.text();
      return { success: false, platform: "youtube", error: `YouTube upload init failed: ${initResp.status} ${errText.slice(0, 300)}` };
    }
    const uploadUrl = initResp.headers.get("location");
    if (!uploadUrl) {
      return { success: false, platform: "youtube", error: "YouTube did not return a resumable upload URL" };
    }

    // 3. PUT the bytes.
    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/*", "Content-Length": String(videoBuffer.length) },
      body: videoBuffer,
    });
    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      return { success: false, platform: "youtube", error: `YouTube video upload failed: ${uploadResp.status} ${errText.slice(0, 300)}` };
    }
    const uploadData = await uploadResp.json();
    return {
      success: true,
      platform: "youtube",
      postId: uploadData.id,
      postUrl: uploadData.id ? `https://www.youtube.com/watch?v=${uploadData.id}` : undefined,
    };
  } catch (err: any) {
    return { success: false, platform: "youtube", error: err?.message || "youtube publish exception" };
  }
}

export async function publishPost(params: {
  tenantId: number;
  platform: string;
  content: string;
  imageBase64?: string;
  imageUrl?: string;
  videoUrl?: string;
  driveFileId?: string;
  title?: string;
  campaign?: string;
  privacyStatus?: string;
  tags?: string[];
}): Promise<PublishResult> {
  await getTablesReady();
  
  const connections = await getSocialConnections(params.tenantId);
  const connection = connections.find(c => c.platform === params.platform && c.enabled);

  if (!connection) {
    return {
      success: false,
      platform: params.platform,
      error: `No connected ${PLATFORM_CONFIGS[params.platform]?.name || params.platform} account found. Connect your account first via Settings → Social Media.`,
    };
  }

  let result: PublishResult;

  switch (params.platform) {
    case "x":
      result = await publishToX(connection, params.content, params.imageBase64);
      break;
    case "linkedin":
      result = await publishToLinkedIn(connection, params.content, params.imageBase64);
      break;
    case "instagram":
      result = await publishToInstagram(connection, params.content, params.imageUrl);
      break;
    case "facebook":
      result = await publishToFacebook(connection, params.content, params.imageUrl, undefined, params.videoUrl, params.driveFileId, params.title);
      break;
    case "threads":
      result = await publishToThreads(connection, params.content, params.imageUrl);
      break;
    case "pinterest":
      result = await publishToPinterest(connection, params.content, params.imageUrl, undefined, params.title);
      break;
    case "youtube":
      result = await publishToYouTube(connection, params.content, params.videoUrl, params.driveFileId, params.title, params.privacyStatus, params.tags);
      break;
    default:
      result = { success: false, platform: params.platform, error: `Publishing not yet supported for ${params.platform}` };
  }

  await db.execute(sql`
    INSERT INTO social_posts (tenant_id, platform, content, image_url, image_drive_url, status, 
                              platform_post_id, platform_post_url, campaign, published_at)
    VALUES (${params.tenantId}, ${params.platform}, ${params.content}, ${params.imageBase64 ? "base64_image" : null},
            ${params.imageUrl || null}, ${result.success ? "published" : "failed"},
            ${result.postId || null}, ${result.postUrl || null}, ${params.campaign || null},
            ${result.success ? sql`NOW()` : null})
  `);

  return result;
}

export async function saveDraftPost(params: {
  tenantId: number;
  platform: string;
  content: string;
  imageDriveUrl?: string;
  campaign?: string;
  scheduledFor?: string;
}): Promise<any> {
  await getTablesReady();
  const result = await db.execute(sql`
    INSERT INTO social_posts (tenant_id, platform, content, image_drive_url, status, scheduled_for, campaign)
    VALUES (${params.tenantId}, ${params.platform}, ${params.content}, ${params.imageDriveUrl || null},
            ${params.scheduledFor ? "scheduled" : "draft"}, ${params.scheduledFor || null}, ${params.campaign || null})
    RETURNING id, platform, content, status, scheduled_for, campaign
  `);
  return { success: true, post: (result as any).rows?.[0] || result };
}

export async function listPosts(params: {
  tenantId: number;
  status?: string;
  platform?: string;
  limit?: number;
}): Promise<any> {
  await getTablesReady();
  const limit = params.limit || 20;
  let result;
  if (params.status && params.platform) {
    result = await db.execute(sql`
      SELECT * FROM social_posts WHERE tenant_id = ${params.tenantId} AND status = ${params.status} AND platform = ${params.platform}
      ORDER BY created_at DESC LIMIT ${limit}
    `);
  } else if (params.status) {
    result = await db.execute(sql`
      SELECT * FROM social_posts WHERE tenant_id = ${params.tenantId} AND status = ${params.status}
      ORDER BY created_at DESC LIMIT ${limit}
    `);
  } else if (params.platform) {
    result = await db.execute(sql`
      SELECT * FROM social_posts WHERE tenant_id = ${params.tenantId} AND platform = ${params.platform}
      ORDER BY created_at DESC LIMIT ${limit}
    `);
  } else {
    result = await db.execute(sql`
      SELECT * FROM social_posts WHERE tenant_id = ${params.tenantId}
      ORDER BY created_at DESC LIMIT ${limit}
    `);
  }
  return { posts: (result as any).rows || [] };
}

export function getPlatformConfigs() {
  return Object.entries(PLATFORM_CONFIGS).map(([key, config]) => ({
    platform: key,
    name: config.name,
    characterLimit: config.characterLimit,
    requiredScopes: config.requiredScopes,
    maxImageSize: config.maxImageSize,
  }));
}
