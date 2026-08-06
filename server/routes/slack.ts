import type { Express, Request, Response } from "express";
import { logSilentCatch } from "../lib/silent-catch";
import crypto from "crypto";

interface Deps {
  ADMIN_TENANT_ID: number;
}

// R98.26.6 — Workspace/app allowlist. HMAC verifies the request was signed
// with our signing secret, but if that secret ever leaks (env var dump, stale
// .env in a public fork, screen-share), ANY workspace that installed the app
// could pivot into ADMIN_TENANT_ID and execute tools. Pin to known team_id
// (and optionally enterprise_id + api_app_id). Fails CLOSED when configured.
//
// R98.27.4 (architect HIGH finding) — secure-by-default in production. When
// no allowlists are configured AND the process is running in a Replit
// deployment, refuse the request with a clear remediation message. Operators
// who consciously want the previous fail-open behavior (e.g., during migration)
// can set SLACK_ACL_MODE=permissive to opt back in. Dev still permissive by
// default to preserve the local-iteration loop.
let _slackAllowlistWarned = false;
let _slackAllowlistFailClosedLogged = false;
function isProductionDeploy(): boolean {
  return process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
}
function aclPermissiveOptIn(): boolean {
  return (process.env.SLACK_ACL_MODE || '').toLowerCase() === 'permissive';
}
function verifySlackWorkspace(body: any): { ok: boolean; reason?: string } {
  const allowedTeams = (process.env.SLACK_ALLOWED_TEAM_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedEnterprises = (process.env.SLACK_ALLOWED_ENTERPRISE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedApps = (process.env.SLACK_ALLOWED_APP_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowedTeams.length === 0 && allowedEnterprises.length === 0 && allowedApps.length === 0) {
    if (isProductionDeploy() && !aclPermissiveOptIn()) {
      if (!_slackAllowlistFailClosedLogged) {
        console.warn('[slack] PRODUCTION fail-closed: no SLACK_ALLOWED_TEAM_ID/ENTERPRISE_ID/APP_ID configured. Set one to your Slack workspace team_id, OR set SLACK_ACL_MODE=permissive to opt back into the legacy fail-open behavior.');
        _slackAllowlistFailClosedLogged = true;
      }
      return { ok: false, reason: 'workspace allowlist unconfigured in production (set SLACK_ALLOWED_TEAM_ID or SLACK_ACL_MODE=permissive)' };
    }
    if (!_slackAllowlistWarned) {
      console.warn('[slack] SLACK_ALLOWED_TEAM_ID unset — accepting any workspace whose request matches the signing secret. Set it to pin to your workspace.');
      _slackAllowlistWarned = true;
    }
    return { ok: true };
  }
  // Slash payload: top-level team_id, enterprise_id, api_app_id.
  // Events payload: same shape on the outer body (Slack puts these at the root, not inside `event`).
  const teamId = body?.team_id || body?.team?.id || '';
  const enterpriseId = body?.enterprise_id || body?.enterprise?.id || '';
  const appId = body?.api_app_id || '';
  if (allowedTeams.length > 0 && !allowedTeams.includes(teamId)) {
    return { ok: false, reason: `team_id ${teamId || '<empty>'} not in SLACK_ALLOWED_TEAM_ID` };
  }
  if (allowedEnterprises.length > 0 && !allowedEnterprises.includes(enterpriseId)) {
    return { ok: false, reason: `enterprise_id ${enterpriseId || '<empty>'} not in SLACK_ALLOWED_ENTERPRISE_ID` };
  }
  if (allowedApps.length > 0 && !allowedApps.includes(appId)) {
    return { ok: false, reason: `api_app_id ${appId || '<empty>'} not in SLACK_ALLOWED_APP_ID` };
  }
  return { ok: true };
}

function verifySlackSignature(req: Request, signingSecret: string): boolean {
  const ts = req.header('x-slack-request-timestamp');
  const sig = req.header('x-slack-signature');
  if (!ts || !sig) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > 60 * 5) return false;
  const raw = (req as any).rawBody as Buffer | string | undefined;
  if (raw == null) return false;
  const rawBody = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  const base = `v0:${ts}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed));
  } catch {
    return false;
  }
}

async function postSlackMessage(token: string, channel: string, text: string, thread_ts?: string) {
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, ...(thread_ts ? { thread_ts } : {}) }),
  });
  if (!r.ok) {
    console.error('[slack] postMessage HTTP', r.status, await r.text().catch(() => ''));
    return;
  }
  // R98.26 — Slack returns 200 even on logical failures (channel_not_found,
  // not_in_channel, invalid_auth). Inspect JSON `ok` so silent failures land
  // in the server log instead of the void.
  try {
    const j: any = await r.json();
    if (j && j.ok === false) console.error('[slack] postMessage logical error', j.error || JSON.stringify(j));
  } catch (_silentErr) { logSilentCatch("server/routes/slack.ts", _silentErr); }
}

// R98.26.3 — Resolve a first-word token to a persona. DB-driven (no
// hardcoded allowlist) so new personas auto-route the moment they're
// inserted with is_active=true. Returns null if the token doesn't match
// any active persona; caller decides whether to fall back to Felix
// (chat surfaces — bare "do X" is fine) or surface a warning (slash
// commands — explicit "/visionclaw badname …" should tell the user).
//
// R98.27.2 — Now tenant-aware: matches both the global persona name AND
// any tenant-specific display_name override in tenant_persona_names. This
// keeps Slack routing consistent with the in-app persona surface (where
// operators can rename Felix → "CEO" for their tenant) and stops global
// persona enumeration from leaking other tenants' display names back.
async function resolveFirstWordPersona(
  token: string,
  tenantId: number,
): Promise<{ id: number; name: string } | null> {
  if (!token || !/^[a-z][a-z0-9_-]{1,30}$/i.test(token)) return null;
  const { db } = await import('../db');
  const { sql } = await import('drizzle-orm');
  const r: any = await db.execute(sql`
    SELECT p.id, p.name FROM personas p
    LEFT JOIN tenant_persona_names tpn
      ON tpn.persona_id = p.id AND tpn.tenant_id = ${tenantId}
    WHERE p.is_active = true
      AND (LOWER(p.name) = LOWER(${token}) OR LOWER(tpn.display_name) = LOWER(${token}))
    LIMIT 1
  `);
  const rows: any[] = (r as any).rows || r;
  return rows[0] || null;
}

// R98.27.2 — Slack user-level ACL. Workspace allowlist (R98.26.6) confirms
// the request came from our workspace; this confirms the *user* posting it
// is authorized to drive the admin-tenant agent. Without this, anyone in an
// allowed workspace (incl. guests in shared channels) could trigger
// tool-enabled runs against ADMIN_TENANT_ID. Fails CLOSED when configured;
// when unset, logs a one-shot warning and allows (preserves current
// single-operator deploy without forcing config). Set SLACK_ALLOWED_USER_ID
// (comma-separated Slack user IDs, e.g. U0123ABC,U0456DEF) to enable.
let _slackUserAclWarned = false;
let _slackUserAclFailClosedLogged = false;
function verifySlackUser(userId: string): { ok: boolean; reason?: string } {
  const allowed = (process.env.SLACK_ALLOWED_USER_ID || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    // R98.27.4 — secure-by-default in production (architect HIGH finding).
    // SLACK_ACL_MODE=permissive opts back into legacy fail-open if needed.
    if (isProductionDeploy() && !aclPermissiveOptIn()) {
      if (!_slackUserAclFailClosedLogged) {
        console.warn('[slack] PRODUCTION fail-closed: SLACK_ALLOWED_USER_ID unconfigured. Set it (comma-separated U… ids), OR set SLACK_ACL_MODE=permissive to opt back into the legacy fail-open behavior.');
        _slackUserAclFailClosedLogged = true;
      }
      return { ok: false, reason: 'user allowlist unconfigured in production (set SLACK_ALLOWED_USER_ID or SLACK_ACL_MODE=permissive)' };
    }
    if (!_slackUserAclWarned) {
      console.warn('[slack] SLACK_ALLOWED_USER_ID unset — accepting any user in the allowed workspace. Set it (comma-separated U… ids) to lock to specific operators.');
      _slackUserAclWarned = true;
    }
    return { ok: true };
  }
  if (!userId || !allowed.includes(userId)) {
    return { ok: false, reason: `user_id ${userId || '<empty>'} not in SLACK_ALLOWED_USER_ID` };
  }
  return { ok: true };
}

async function dispatchToPersona(opts: {
  personaName: string;
  prompt: string;
  tenantId: number;
  userId: string;
  slackChannel: string;
  slackThreadTs?: string;
  botToken: string;
  warnIfMissing?: boolean;
}) {
  const { personaName, prompt, tenantId, userId, slackChannel, slackThreadTs, botToken, warnIfMissing } = opts;
  void userId;
  try {
    const persona = await resolveFirstWordPersona(personaName, tenantId);
    if (!persona) {
      if (warnIfMissing) {
        const { db } = await import('../db');
        const { sql } = await import('drizzle-orm');
        // R98.27.2 — tenant-scoped enumeration (was leaking global persona
        // catalog incl. other tenants' display-name overrides).
        const allR: any = await db.execute(sql`
          SELECT COALESCE(tpn.display_name, p.name) AS name
          FROM personas p
          LEFT JOIN tenant_persona_names tpn
            ON tpn.persona_id = p.id AND tpn.tenant_id = ${tenantId}
          WHERE p.is_active = true
          ORDER BY name
        `);
        const names: string[] = ((allR as any).rows || allR).map((r: any) => String(r.name).toLowerCase());
        await postSlackMessage(botToken, slackChannel,
          `:warning: I don't have a persona named "${personaName}". Active personas: ${names.join(', ')}.`,
          slackThreadTs);
      }
      return;
    }
    const { storage } = await import('../storage');
    const conv = await storage.createConversation({
      tenantId,
      personaId: persona.id,
      title: `Slack: ${prompt.slice(0, 60)}`,
      // R98.26 fix — schema default is `gpt-5.1` which isn't in MODEL_REGISTRY
      // and chat-engine throws "Unknown model" before reaching the LLM. Pin to
      // gpt-5.6-sol — current OpenAI flagship (powerful tier, vision+audio+
      // code+tools). Slack is Bob's personal interface, so quality > cost.
      model: 'gpt-5.6-sol',
    } as any);
    const { processMessage } = await import('../chat-engine');
    const reply = await processMessage(conv.id, prompt, { source: 'slack', enableTools: true });
    const text = ((reply as any)?.response || (reply as any)?.content || JSON.stringify(reply)).toString().slice(0, 3500);
    await postSlackMessage(botToken, slackChannel, `${persona.name}: ${text}`, slackThreadTs);
  } catch (e: any) {
    // R98.26 — never echo internal exception text to a Slack channel; it can
    // leak provider URLs, stack traces, or query fragments to anyone in the
    // workspace. Log server-side, reply with a generic message.
    console.error('[slack] dispatch error msg=', e?.message || String(e),
      'code=', e?.code,
      'stack=', (e?.stack || '').split('\n').slice(0, 5).join(' | '));
    await postSlackMessage(
      botToken,
      slackChannel,
      `:x: Sorry — that request hit an internal error. The team has been notified.`,
      slackThreadTs,
    );
  }
}

export function registerSlackRoutes(app: Express, deps: Deps) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  const botToken = process.env.SLACK_BOT_TOKEN || '';
  const enabled = Boolean(signingSecret && botToken);

  // R98.26.4 — per-channel sliding-window rate limit. Slack signature
  // verification already gates random callers, but a compromised workspace
  // token, a misconfigured Slack workflow, or a runaway @mention loop could
  // still spam the dispatcher (each invocation = 1 LLM call, potentially
  // tool-using, ~10s wall-clock). Cap to 6/min and 60/hour per Slack channel
  // — comfortably above human conversational pace, well under abuse pace.
  // In-process Map is fine: Slack route is single-tenant ADMIN_TENANT_ID and
  // we run on a single Reserved VM. If we ever multi-tenant Slack, swap for
  // tool-rate-limiter.ts.
  const slackHits = new Map<string, number[]>();
  function slackRateLimitOk(channelId: string): { ok: true } | { ok: false; reason: string } {
    // R98.26.4 — fall back to a shared bucket if channel id is missing
    // (architect: empty channelId would otherwise bypass the limit entirely).
    const key = channelId || '__no_channel__';
    const now = Date.now();
    const hits = (slackHits.get(key) || []).filter(t => now - t < 3_600_000);
    const lastMin = hits.filter(t => now - t < 60_000).length;
    if (lastMin >= 6) return { ok: false, reason: 'rate-limit: 6/min per channel' };
    if (hits.length >= 60) return { ok: false, reason: 'rate-limit: 60/hour per channel' };
    hits.push(now);
    slackHits.set(key, hits);
    // Opportunistic GC — if map gets large, drop empty/stale channels.
    if (slackHits.size > 256) {
      for (const [k, v] of slackHits) {
        if (v.filter(t => now - t < 3_600_000).length === 0) slackHits.delete(k);
      }
    }
    return { ok: true };
  }

  app.get('/api/slack/health', (_req, res) => {
    res.json({
      enabled,
      hasSigningSecret: Boolean(signingSecret),
      hasBotToken: Boolean(botToken),
      endpoints: ['/api/slack/commands', '/api/slack/events'],
    });
  });

  app.post('/api/slack/commands', async (req: Request, res: Response) => {
    if (!enabled) {
      return res.status(503).json({ error: 'Slack integration not configured. Set SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN.' });
    }
    if (!verifySlackSignature(req, signingSecret)) {
      return res.status(401).send('invalid signature');
    }
    const body = req.body as any;
    const wsCheck = verifySlackWorkspace(body);
    if (!wsCheck.ok) {
      console.warn(`[slack] slash rejected — ${wsCheck.reason}`);
      return res.status(403).send('workspace not allowed');
    }
    const text: string = (body.text || '').toString().trim();
    const userId: string = body.user_id || 'unknown';
    const channelId: string = body.channel_id || '';

    const userCheck = verifySlackUser(userId);
    if (!userCheck.ok) {
      console.warn(`[slack] slash rejected user=${userId} channel=${channelId} — ${userCheck.reason}`);
      return res.status(200).send(':no_entry: You are not authorized to use this command.');
    }

    const rl = slackRateLimitOk(channelId);
    if (!rl.ok) {
      console.warn(`[slack] slash dropped channel=${channelId} ${rl.reason}`);
      return res.status(200).send(':no_entry: Slow down — too many requests in this channel. Try again in a minute.');
    }

    res.status(200).send(':robot_face: Got it — working on that now…');

    // Slash commands: explicit persona name expected (e.g. `/visionclaw felix do X`).
    // If first word doesn't resolve, warn the user with the live persona list.
    const m = text.match(/^@?(\w+)\s+([\s\S]+)$/);
    const personaName = (m ? m[1] : 'felix').toLowerCase();
    const prompt = m ? m[2] : text;

    setImmediate(() => {
      dispatchToPersona({
        personaName,
        prompt,
        tenantId: deps.ADMIN_TENANT_ID,
        userId: `slack:${userId}`,
        slackChannel: channelId,
        slackThreadTs: undefined,
        botToken,
        warnIfMissing: true,
      }).catch((e) => console.error('[slack] async dispatch error', e?.message || String(e)));
    });
  });

  app.post('/api/slack/events', async (req: Request, res: Response) => {
    const body = req.body as any;
    if (body?.type === 'url_verification') {
      return res.status(200).json({ challenge: body.challenge });
    }
    if (!enabled) return res.status(503).json({ error: 'Slack integration not configured' });
    if (!verifySlackSignature(req, signingSecret)) {
      return res.status(401).send('invalid signature');
    }
    const wsCheck = verifySlackWorkspace(body);
    if (!wsCheck.ok) {
      console.warn(`[slack] event rejected — ${wsCheck.reason}`);
      return res.status(403).send('workspace not allowed');
    }
    res.status(200).send('ok');

    const ev = body?.event;
    // R98.26.3 — Two event surfaces handled here:
    //   1. `app_mention` in channels — text starts with <@BOT_ID>; we strip
    //      the bot mention then parse "@persona prompt..." from what's left.
    //   2. `message` in IMs (the bot's Chat tab) — channel_type === 'im',
    //      no <@...> prefix, sender is the human. Plain "felix hello" or
    //      just "hello" (defaults to Felix). Filter out bot-authored messages
    //      (bot_id present) and message subtypes (edits, joins, etc.) to
    //      prevent reply loops.
    // R98.26.4 — also reject app_mention events that carry a subtype
    // (`bot_message`, edits, etc.) belt-and-suspenders against reply loops.
    const isMention = ev?.type === 'app_mention' && ev?.text && !ev?.bot_id && !ev?.subtype;
    // Accept both `im` (1:1 DM with bot) and `mpim` (multi-person group DM
    // that includes the bot). Filter bot-authored messages and message
    // subtypes (edits, joins, channel topic changes) to prevent reply loops.
    const isDM = ev?.type === 'message'
      && (ev?.channel_type === 'im' || ev?.channel_type === 'mpim')
      && ev?.text
      && !ev?.bot_id
      && !ev?.subtype;
    if (isMention || isDM) {
      const channelId: string = ev?.channel || '';
      const evUserId: string = ev?.user || '';
      const userCheck = verifySlackUser(evUserId);
      if (!userCheck.ok) {
        // INTENTIONAL silent drop — we already 200 OK'd. Logging the rejected
        // user_id gives the operator an audit trail (and the U… id they need
        // if they want to add the user to SLACK_ALLOWED_USER_ID).
        console.warn(`[slack] event rejected user=${evUserId} channel=${channelId} — ${userCheck.reason}`);
        return;
      }
      const rl = slackRateLimitOk(channelId);
      if (!rl.ok) {
        // INTENTIONAL silent drop — we already 200 OK'd above, so Slack
        // won't retry. Retrying a rate-limited event would amplify the
        // abuse pattern we're trying to throttle (and Slack's retry budget
        // is generous enough that a runaway loop could 6× the LLM spend).
        // If we ever need user-visible "slow down" feedback in channels,
        // post a chat.postMessage here instead of just logging.
        console.warn(`[slack] event dropped channel=${channelId} ${rl.reason}`);
        return;
      }
      const text: string = (ev.text as string).replace(/<@[^>]+>\s*/g, '').trim();
      const m = text.match(/^@?(\w+)\s+([\s\S]+)$/);
      const firstWord = m ? m[1].toLowerCase() : '';
      // DB-driven routing (no hardcoded allowlist — new personas auto-route
      // the moment they're inserted with is_active=true). If the first word
      // resolves to an active persona, route there with the remainder as
      // prompt; otherwise dispatch the full text to Felix.
      setImmediate(async () => {
        try {
          const matched = firstWord ? await resolveFirstWordPersona(firstWord, deps.ADMIN_TENANT_ID) : null;
          const personaName = matched ? matched.name.toLowerCase() : 'felix';
          const prompt = matched && m ? m[2] : text;
          await dispatchToPersona({
            personaName,
            prompt,
            tenantId: deps.ADMIN_TENANT_ID,
            userId: `slack:${ev.user || 'unknown'}`,
            slackChannel: ev.channel,
            // DMs don't need threading (1:1 surface). Channel mentions
            // thread off the original message.
            slackThreadTs: isDM ? undefined : (ev.thread_ts || ev.ts),
            botToken,
            warnIfMissing: false,
          });
        } catch (e: any) {
          console.error('[slack] event dispatch error', e?.message || String(e));
        }
      });
    }
  });
}
