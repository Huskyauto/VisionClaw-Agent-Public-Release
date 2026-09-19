/**
 * Tools-layer-split S15 — x-twitter-domain tool definitions.
 *
 * Selection: the 9 `x_*` X/Twitter API tools — `x_post_tweet`,
 * `x_delete_tweet`, `x_get_tweet`, `x_get_mentions`, `x_get_timeline`,
 * `x_search`, `x_like_tweet`, `x_retweet`, `x_get_me`. They are contiguous in
 * the legacy facade, share the single external dependency `./social-publisher`,
 * carry no module-scope helpers, and read only the `_tenantId` trust seam (three
 * read-only lookups read no trust signal at all) — the smallest safe cohesive
 * batch. Adjacent social tools stay legacy per smallest-safe-batch: the scattered
 * marketing social-post tools (`draft_social_post`, `generate_social_image`,
 * `compose_social_post`, `publish_social_post`, `manage_social_accounts`) and the
 * cross-platform scheduler cluster (`repurpose_content`,
 * `schedule_cross_platform_post` [destructive, requireApproval, reads
 * `_personaName`/`_userId` — trust channels outside ToolContext],
 * `cancel_scheduled_post`, `list_scheduled_posts`) are scattered / network /
 * destructive and migrate in a later pass.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const xPostTweetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_post_tweet",
    description: "Post a tweet to X/Twitter. Can also reply to a tweet or quote tweet. Uses OAuth 1.0a with the configured API keys.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Tweet text (max 280 characters)" },
        reply_to_id: { type: "string", description: "Tweet ID to reply to (optional)" },
        quote_tweet_id: { type: "string", description: "Tweet ID to quote (optional)" },
      },
      required: ["text"],
    },
  },
};

export const xDeleteTweetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_delete_tweet",
    description: "Use ONLY when removing a tweet posted in error, with stale info, or after Bob explicitly approves takedown. Permanent and unrecoverable. Returns success/failure. Do NOT use to \"edit\" a tweet — X has no edit; delete + repost is the pattern, but require explicit human approval first.",
    parameters: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to delete" },
      },
      required: ["tweet_id"],
    },
  },
};

export const xGetTweetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_get_tweet",
    description: "Use when you need the full content of one specific tweet by its ID — typically after x_search returns hits, or when a user references a tweet URL/ID, or when investigating engagement. Returns the tweet text, author, created_at, and public metrics (likes, retweets, replies, quotes).",
    parameters: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to retrieve" },
      },
      required: ["tweet_id"],
    },
  },
};

export const xGetMentionsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_get_mentions",
    description: "Use when triaging incoming social-media engagement — at the start of a session, before drafting public replies, or when Bob asks \"what is X saying about us\". Returns the most recent @mentions of the authenticated account with author, text, and tweet ID for follow-up via x_search/x_get_tweet.",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of mentions to retrieve (5-100, default 10)" },
      },
    },
  },
};

export const xGetTimelineDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_get_timeline",
    description: "Use when monitoring a specific X/Twitter account (competitor, partner, prospect, public figure) — before crafting outreach, during competitive intel, or when researching a person before a meeting. Returns up to N most recent tweets from the named user with full text and metrics. For OWN account use x_get_me.",
    parameters: {
      type: "object",
      properties: {
        username: { type: "string", description: "X/Twitter username (without @)" },
        count: { type: "number", description: "Number of tweets to retrieve (5-100, default 10)" },
      },
      required: ["username"],
    },
  },
};

export const xSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_search",
    description: "Use BEFORE responding to public commentary about a topic, brand, or product — also for monitoring an event, hashtag, or breaking news in real time. Returns recent tweets matching the query with author, text, and metrics. Best for time-sensitive surface scans; pair with x_get_tweet to drill into specific hits.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
        count: { type: "number", description: "Number of results (10-100, default 10)" },
      },
      required: ["query"],
    },
  },
};

export const xLikeTweetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_like_tweet",
    description: "Use when amplifying a partner/customer/community member through a low-effort signal of acknowledgement — also after their reply to one of our threads. Returns success/failure. Do NOT auto-like everything — bot-like patterns get accounts flagged.",
    parameters: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to like" },
      },
      required: ["tweet_id"],
    },
  },
};

export const xRetweetDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_retweet",
    description: "Use when amplifying content that aligns with our brand voice and wellness/agentic-AI mission — partner launches, customer wins, relevant news. Returns success/failure. Higher-stakes than a like; run cross_critique on borderline content before retweeting from the brand account.",
    parameters: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to retweet" },
      },
      required: ["tweet_id"],
    },
  },
};

export const xGetMeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "x_get_me",
    description: "Use at session start when working on social media to confirm WHICH account is authenticated — also when reporting follower-count progress to Bob. Returns the authenticated user profile (id, name, username, bio, followers/following/tweet counts).",
    parameters: { type: "object", properties: {} },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const xTwitterDomainDefinitions: ToolDefinition[] = [
  xPostTweetDefinition,
  xDeleteTweetDefinition,
  xGetTweetDefinition,
  xGetMentionsDefinition,
  xGetTimelineDefinition,
  xSearchDefinition,
  xLikeTweetDefinition,
  xRetweetDefinition,
  xGetMeDefinition,
];
