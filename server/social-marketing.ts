import { db } from "./db";
import { sql } from "drizzle-orm";
import { getClientForModel } from "./providers";

const BRAND_VOICE = `You are the social media voice for an AI-powered platform.

Brand Rules:
- Professional but approachable, data-driven, confident without being pushy
- Speak with authority but stay humble
- Use data and specifics when possible
- No corporate buzzword salad — write like a real person
- Short punchy lines for X/Twitter, longer form for LinkedIn
- 2-3 hashtags max per post
- Never post sensitive data, API keys, or user information

Content Pillars:
1. AI + productivity insights
2. Build in public
3. User success stories
4. Industry commentary
5. Educational content`;

const PLATFORM_RULES: Record<string, string> = {
  x: `X/Twitter rules:
- Max 280 characters
- Aim for 200-240 chars for engagement
- Short, punchy, personality-driven
- Threads OK for deep content (separate with |||)`,
  linkedin: `LinkedIn rules:
- 500-1500 chars for feed posts
- Use line breaks for readability
- Emoji sparingly
- End with a question or CTA
- More professional tone, still authentic`,
  tiktok: `TikTok rules:
- Script format (15-60 seconds)
- Hook must grab in first 3 seconds
- Conversational, energetic tone
- Include visual directions in brackets [show screen]`,
  instagram: `Instagram rules:
- Caption up to 2200 chars but keep under 300 for feed
- Story-driven, visual-first thinking
- End with engagement question
- Hashtags in comment or at end (5-10)`,
};

const STYLE_PROMPTS: Record<string, string> = {
  announcement: "Write an exciting announcement post. Lead with the news, explain the value in 2-3 sentences, end with a CTA.",
  insight: "Share a professional insight or data-driven observation. Be thought-provoking.",
  question: "Ask an engaging question that invites discussion. Make it relevant to your audience.",
  thread: "Write a thread (separate posts with |||). Start with a hook, each post should be self-contained but connected.",
  "hot-take": "Share a bold, potentially controversial opinion. Back it up with reasoning.",
  "build-in-public": "Share an honest update about what's being built. Include wins, challenges, and what's next.",
  educational: "Teach something useful. Make it practical and actionable.",
  "user-success": "Highlight a user success story. Focus on the transformation, not the product.",
};

export async function draftSocialPost(params: {
  platform: string;
  topic: string;
  style?: string;
  include_cta?: boolean;
  include_hashtags?: boolean;
  _tenantId?: number;
}): Promise<any> {
  const platform = params.platform || "x";
  const style = params.style || "insight";
  const includeCta = params.include_cta !== false;
  const includeHashtags = params.include_hashtags !== false;

  const platformRules = PLATFORM_RULES[platform] || PLATFORM_RULES.x;
  const stylePrompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.insight;

  const prompt = `${BRAND_VOICE}

${platformRules}

Style: ${stylePrompt}

Topic: ${params.topic}
${includeCta ? "Include a clear call-to-action." : "No explicit CTA needed."}
${includeHashtags ? "Include 2-3 relevant hashtags." : "No hashtags."}

Generate the post now. Return ONLY the post text, no explanations or metadata.`;

  try {
    const result = await getClientForModel("gemini-2.5-flash");
    if (!result) throw new Error("No AI client available for drafting");
    const { client, actualModelId } = result;

    const response = await client.chat.completions.create({
      model: actualModelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.8,
    });

    const draft = response.choices[0]?.message?.content?.trim() || "";

    return {
      status: "drafted",
      platform,
      style,
      draft,
      char_count: draft.length,
      ...(platform === "x" && draft.length > 280 ? { warning: `Draft is ${draft.length} chars — over X's 280 char limit. Consider trimming.` } : {}),
      instructions: "Review this draft. When ready to post, use your platform's posting tool/API or copy-paste manually.",
    };
  } catch (err: any) {
    return { error: `Failed to generate draft: ${err.message}` };
  }
}

export async function manageContentCalendar(params: {
  action: string;
  platform?: string;
  content?: string;
  scheduled_date?: string;
  post_id?: string;
  style?: string;
  campaign?: string;
  _tenantId?: number;
}): Promise<any> {
  const tenantId = params._tenantId;
  if (!tenantId) return { error: "tenant_id is required" };

  switch (params.action) {
    case "add": {
      if (!params.content || !params.scheduled_date) {
        return { error: "Content and scheduled_date are required for adding posts" };
      }
      const result = await db.execute(sql`
        INSERT INTO marketing_calendar (tenant_id, platform, content, scheduled_date, style, campaign, status)
        VALUES (${tenantId}, ${params.platform || "x"}, ${params.content}, ${params.scheduled_date}, ${params.style || null}, ${params.campaign || null}, 'scheduled')
        RETURNING id, platform, content, scheduled_date, style, campaign, status
      `);
      const entry = (result as any).rows?.[0] || result;
      const countResult = await db.execute(sql`SELECT count(*)::int as total FROM marketing_calendar WHERE tenant_id = ${tenantId} AND status = 'scheduled'`);
      const total = (countResult as any).rows?.[0]?.total || 0;
      return { status: "added", entry, total_scheduled: total };
    }

    case "list": {
      const platform = params.platform || "all";
      let result;
      if (platform === "all") {
        result = await db.execute(sql`
          SELECT * FROM marketing_calendar WHERE tenant_id = ${tenantId} AND status = 'scheduled'
          ORDER BY scheduled_date ASC
        `);
      } else {
        result = await db.execute(sql`
          SELECT * FROM marketing_calendar WHERE tenant_id = ${tenantId} AND status = 'scheduled' AND platform = ${platform}
          ORDER BY scheduled_date ASC
        `);
      }
      const posts = (result as any).rows || [];
      return { total: posts.length, posts };
    }

    case "remove": {
      if (!params.post_id) return { error: "post_id is required for remove action" };
      await db.execute(sql`
        UPDATE marketing_calendar SET status = 'cancelled' WHERE id = ${parseInt(params.post_id)} AND tenant_id = ${tenantId}
      `);
      return { status: "removed", post_id: params.post_id };
    }

    case "clear_past": {
      const result = await db.execute(sql`
        UPDATE marketing_calendar SET status = 'cancelled'
        WHERE tenant_id = ${tenantId} AND status = 'scheduled' AND scheduled_date < NOW()
        RETURNING id
      `);
      const count = (result as any).rows?.length || 0;
      return { status: "cleared", removed_count: count };
    }

    default:
      return { error: `Unknown action: ${params.action}` };
  }
}

export async function marketingAnalytics(params: {
  action: string;
  platform?: string;
  post_content?: string;
  metrics?: any;
  date_range?: string;
  campaign?: string;
  _tenantId?: number;
}): Promise<any> {
  const tenantId = params._tenantId;
  if (!tenantId) return { error: "tenant_id is required" };

  switch (params.action) {
    case "log_result": {
      if (!params.post_content) return { error: "post_content is required" };
      const m = params.metrics || {};
      const result = await db.execute(sql`
        INSERT INTO marketing_results (tenant_id, platform, content, campaign, views, likes, replies, reposts, clicks, bookmarks)
        VALUES (${tenantId}, ${params.platform || "x"}, ${params.post_content}, ${params.campaign || null},
                ${m.views || 0}, ${m.likes || 0}, ${m.replies || 0}, ${m.reposts || 0}, ${m.clicks || 0}, ${m.bookmarks || 0})
        RETURNING *
      `);
      const entry = (result as any).rows?.[0] || result;
      return { status: "logged", result: entry };
    }

    case "view_analytics": {
      let dateFilter = sql`TRUE`;
      if (params.date_range === "today") dateFilter = sql`posted_at >= CURRENT_DATE`;
      else if (params.date_range === "week") dateFilter = sql`posted_at >= NOW() - INTERVAL '7 days'`;
      else if (params.date_range === "month") dateFilter = sql`posted_at >= NOW() - INTERVAL '30 days'`;

      const result = await db.execute(sql`
        SELECT
          count(*)::int as total_posts,
          COALESCE(sum(views), 0)::int as total_views,
          COALESCE(sum(likes), 0)::int as total_likes,
          COALESCE(sum(replies), 0)::int as total_replies,
          CASE WHEN count(*) > 0 THEN ROUND((sum(likes) + sum(replies))::numeric / count(*), 1) ELSE 0 END as avg_engagement
        FROM marketing_results
        WHERE tenant_id = ${tenantId} AND ${dateFilter}
        ${params.platform ? sql`AND platform = ${params.platform}` : sql``}
        ${params.campaign ? sql`AND campaign = ${params.campaign}` : sql``}
      `);
      const stats = (result as any).rows?.[0] || {};

      const postsResult = await db.execute(sql`
        SELECT * FROM marketing_results
        WHERE tenant_id = ${tenantId} AND ${dateFilter}
        ${params.platform ? sql`AND platform = ${params.platform}` : sql``}
        ORDER BY posted_at DESC LIMIT 20
      `);
      const posts = (postsResult as any).rows || [];

      return { ...stats, posts };
    }

    case "top_performers": {
      const result = await db.execute(sql`
        SELECT *, (COALESCE(views, 0) + COALESCE(likes, 0) * 10 + COALESCE(replies, 0) * 20) as score
        FROM marketing_results WHERE tenant_id = ${tenantId}
        ORDER BY score DESC LIMIT 10
      `);
      return { top_posts: (result as any).rows || [] };
    }

    case "recommendations": {
      const countResult = await db.execute(sql`SELECT count(*)::int as total FROM marketing_results WHERE tenant_id = ${tenantId}`);
      const total = (countResult as any).rows?.[0]?.total || 0;
      if (total < 3) {
        return { recommendation: "Not enough data yet. Log at least 3 post results to get optimization recommendations." };
      }

      const platformResult = await db.execute(sql`
        SELECT platform, count(*)::int as count,
          ROUND(avg(views)::numeric) as avg_views,
          ROUND(avg(likes)::numeric) as avg_likes,
          ROUND(avg(likes + replies)::numeric, 1) as avg_engagement
        FROM marketing_results WHERE tenant_id = ${tenantId}
        GROUP BY platform
      `);

      return {
        platform_breakdown: (platformResult as any).rows || [],
        total_posts_tracked: total,
        recommendation: "Focus on the platform with highest avg_engagement. Double down on content styles that match your top performers.",
      };
    }

    default:
      return { error: `Unknown action: ${params.action}` };
  }
}

export async function marketingExperiment(params: {
  action: string;
  experiment_name?: string;
  hypothesis?: string;
  variant_a?: string;
  variant_b?: string;
  variant_a_metrics?: any;
  variant_b_metrics?: any;
  learning?: string;
  next_action?: string;
  _tenantId?: number;
}): Promise<any> {
  const tenantId = params._tenantId;
  if (!tenantId) return { error: "tenant_id is required" };

  switch (params.action) {
    case "create": {
      if (!params.experiment_name || !params.hypothesis) {
        return { error: "experiment_name and hypothesis are required" };
      }
      const result = await db.execute(sql`
        INSERT INTO marketing_experiments (tenant_id, name, hypothesis, variant_a, variant_b, status)
        VALUES (${tenantId}, ${params.experiment_name}, ${params.hypothesis}, ${params.variant_a || null}, ${params.variant_b || null}, 'running')
        RETURNING *
      `);
      const experiment = (result as any).rows?.[0] || result;
      return { status: "created", experiment };
    }

    case "log_result": {
      if (!params.experiment_name) return { error: "experiment_name is required" };

      const result = await db.execute(sql`
        UPDATE marketing_experiments SET
          variant_a_metrics = COALESCE(${params.variant_a_metrics ? JSON.stringify(params.variant_a_metrics) : null}::jsonb, variant_a_metrics),
          variant_b_metrics = COALESCE(${params.variant_b_metrics ? JSON.stringify(params.variant_b_metrics) : null}::jsonb, variant_b_metrics),
          learning = COALESCE(${params.learning || null}, learning),
          next_action = COALESCE(${params.next_action || null}, next_action)
        WHERE tenant_id = ${tenantId} AND name = ${params.experiment_name} AND status = 'running'
        RETURNING *
      `);
      const experiment = (result as any).rows?.[0];
      if (!experiment) return { error: `No running experiment found: ${params.experiment_name}` };
      return { status: "updated", experiment };
    }

    case "get_winner": {
      if (!params.experiment_name) return { error: "experiment_name is required" };
      const result = await db.execute(sql`
        SELECT * FROM marketing_experiments
        WHERE tenant_id = ${tenantId} AND name = ${params.experiment_name}
        ORDER BY created_at DESC LIMIT 1
      `);
      const exp = (result as any).rows?.[0];
      if (!exp) return { error: `Experiment not found: ${params.experiment_name}` };
      if (!exp.variant_a_metrics || !exp.variant_b_metrics) {
        return { status: "incomplete", message: "Both variant metrics needed to determine winner", experiment: exp };
      }

      const metricsA = typeof exp.variant_a_metrics === "string" ? JSON.parse(exp.variant_a_metrics) : exp.variant_a_metrics;
      const metricsB = typeof exp.variant_b_metrics === "string" ? JSON.parse(exp.variant_b_metrics) : exp.variant_b_metrics;
      const scoreA = (metricsA.views || 0) + (metricsA.likes || 0) * 10 + (metricsA.replies || 0) * 20;
      const scoreB = (metricsB.views || 0) + (metricsB.likes || 0) * 10 + (metricsB.replies || 0) * 20;

      const diff = Math.abs(scoreA - scoreB) / Math.max(scoreA, scoreB, 1);
      const winner = diff < 0.1 ? "tie" : scoreA > scoreB ? "a" : "b";

      await db.execute(sql`
        UPDATE marketing_experiments
        SET winner = ${winner}, status = 'completed', completed_at = NOW(),
            learning = COALESCE(${params.learning || null}, learning),
            next_action = COALESCE(${params.next_action || null}, next_action)
        WHERE id = ${exp.id} AND tenant_id = ${tenantId}
      `);

      return { status: "completed", winner, experiment: { ...exp, winner, status: "completed" } };
    }

    case "list": {
      const runningResult = await db.execute(sql`
        SELECT * FROM marketing_experiments WHERE tenant_id = ${tenantId} AND status = 'running' ORDER BY created_at DESC
      `);
      const completedResult = await db.execute(sql`
        SELECT * FROM marketing_experiments WHERE tenant_id = ${tenantId} AND status = 'completed' ORDER BY completed_at DESC LIMIT 10
      `);
      return {
        total: ((runningResult as any).rows?.length || 0) + ((completedResult as any).rows?.length || 0),
        running: (runningResult as any).rows || [],
        completed: (completedResult as any).rows || [],
      };
    }

    default:
      return { error: `Unknown action: ${params.action}` };
  }
}
