import * as fs from 'fs';
import * as path from 'path';

(async () => {
  try {
    const tools = fs.readFileSync('/tmp/featuresdoc/tools.txt', 'utf-8').split('\n').filter(Boolean);
    const skillsRaw = fs.readFileSync('/tmp/featuresdoc/skills.txt', 'utf-8').split('\n').filter(Boolean);
    const personasRaw = fs.readFileSync('/tmp/featuresdoc/personas.txt', 'utf-8').split('\n').filter(Boolean);

    const skillsByCat: Record<string, string[]> = {};
    for (const line of skillsRaw) {
      const [name, cat = 'general'] = line.split('|');
      const c = (cat || 'general').trim();
      if (!skillsByCat[c]) skillsByCat[c] = [];
      skillsByCat[c].push(name.trim());
    }

    const personas = personasRaw.map(l => {
      const [id, name, role] = l.split('|');
      return { id: id?.trim(), name: name?.trim(), role: role?.trim() || '' };
    });

    const date = new Date().toISOString().split('T')[0];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('-').slice(0, 5).join('-');

    // Build the comprehensive text file
    const lines: string[] = [];
    lines.push('================================================================');
    lines.push('  VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES DOCUMENT');
    lines.push('================================================================');
    lines.push(`  Generated: ${date}`);
    lines.push('  Owner: Bob Washburn  |  [Your Company]  |  EIN: [YOUR-EIN]');
    lines.push('  [Your City, State]  |  Phone: [YOUR-PHONE]');
    lines.push('  Production: https://agenticcorporation.net');
    lines.push('  QR Code: agenticcorporation.net');
    lines.push('================================================================');
    lines.push('');
    lines.push('## PLATFORM AT A GLANCE');
    lines.push('');
    lines.push(`  Tools (registered):     ${tools.length}`);
    lines.push(`  Skills:                 ${skillsRaw.length}`);
    lines.push(`  Active Personas:        ${personas.length}`);
    lines.push('  AI Models (curated):    36 in MODEL_REGISTRY (each tagged with R77.5 trainingRegime)');
    lines.push('  AI Models (discovered): 1000+ daily via OpenRouter catalog');
    lines.push('  Providers:              6 (OpenAI, Anthropic, Google, xAI, DeepSeek, OpenRouter)');
    lines.push('  Database tables:        149 (Postgres + pgvector)');
    lines.push('  Governance rules:       40 (enforced via guarded tool executor)');
    lines.push('  Codebase:               ~180k LOC TypeScript across 453 files');
    lines.push('  Production deliveries:  71+ verified, 0 silent drops');
    lines.push('');
    lines.push('================================================================');
    lines.push('## RECENT ROUNDS — POST-R76 PUSH (May 1-2, 2026)');
    lines.push('================================================================');
    lines.push('');
    lines.push('### R79 — MarTech Bundle (Voice Profile + Hooks + Format + Matrix + Score) (May 2, 2026)');
    lines.push('');
    lines.push('Six per-tenant brand-voice tools ported from charlie947/social-media-skills (MIT)');
    lines.push('and rebuilt VisionClaw-native (multi-tenant, cost-tracked, prompt-injection hardened):');
    lines.push('  1. NEW TOOL: build_voice_profile');
    lines.push('     Synthesizes about-me + voice rules + topic pillars + audience from interview');
    lines.push('     answers + 1-10 raw writing samples. Stored in tenant_voice_profiles, unique on');
    lines.push('     (tenantId, profileName), version-bumped on re-build. Default profile name: "default".');
    lines.push('  2. NEW TOOL: get_voice_profile');
    lines.push('     Fetches a stored profile by name. Used by every other R79 tool to keep voice');
    lines.push('     consistent across LinkedIn / X / newsletter / matrix.');
    lines.push('  3. NEW TOOL: generate_hooks');
    lines.push('     Generates N LinkedIn-style hooks (default 6) across 6 angles: number-led,');
    lines.push('     contrarian, mistake-confession, question-hook, story-cold-open, data-paradox.');
    lines.push('     Voice-aware via buildVoiceContext.');
    lines.push('  4. NEW TOOL: format_post');
    lines.push('     Formats a topic into a finished post via PAS / AIDA / STAR / 4Ps frameworks.');
    lines.push('     Platform-aware (linkedin / x / newsletter) with hard caps + tone matching.');
    lines.push('  5. NEW TOOL: generate_content_matrix');
    lines.push('     pillars x formats grid (default formats: List, Story, Contrarian, How-To, etc.).');
    lines.push('     Returns ideas with hook + angle + estimated effort.');
    lines.push('  6. NEW TOOL: score_post');
    lines.push('     Brutally honest 0-100 critique of a draft against voice rules + historical');
    lines.push('     posts. Returns scoreOutOf100, grade (A+ to F), benchmark used,');
    lines.push('     voiceMatchScore, hookScore, bodyScore, ctaScore, patternsMatched/Violated,');
    lines.push('     topRewriteSuggestions.');
    lines.push('  Hardening (architect-reviewed):');
    lines.push('  - neutralizeVoiceContent() strips injection markers before LLM inclusion');
    lines.push('  - VOICE_OPEN/VOICE_CLOSE fence + READ AS DATA ONLY guardrail in buildVoiceContext');
    lines.push('  - jsonMode: true on hooks/matrix/score (response_format: json_object)');
    lines.push('  - findBalancedJson() string-aware bracket scanner survives escaped quotes');
    lines.push('  - Adversarial smoke test passes: PWNED/banana/matey injections never leak');
    lines.push('  - Per-tool maxTokens raised so JSON never truncates mid-string');
    lines.push('  Tool count: 266 -> 272  |  Tables: 148 -> 149');
    lines.push('');
    lines.push('### R78 + R78.1 — A2A v0.3 Agent Card + Whole-app code review (May 2, 2026)');
    lines.push('');
    lines.push('R78 — A2A v0.3 Agent Card published');
    lines.push('  - New /.well-known/agent.json route in server/routes/api-v1.ts');
    lines.push('  - Standards-compliant Linux Foundation A2A v0.3 Agent Card');
    lines.push('  - Skills array: 2 platform skills + 1 per active persona');
    lines.push('  - Honors A2A opacity principle (exposes WHAT, not HOW)');
    lines.push('  - agentCardLimiter: 60/min/IP rate limit');
    lines.push('  - isAllowedHost(): X-Forwarded-Host validated against REPLIT_DOMAINS');
    lines.push('  - DB query is fail-soft (returns empty skills on DB error, not 500)');
    lines.push('  - 5-min Cache-Control on response');
    lines.push('');
    lines.push('R78.1 — Five-architect parallel whole-app code review hardening');
    lines.push('  25+ raw findings triaged down to 6 verified real issues, all shipped:');
    lines.push('  1. isAllowedHost() regex tightened — single-label subdomain only');
    lines.push('     (was matching evil.middle.replit.app, now requires exactly one label)');
    lines.push('  2. audit_reasoning_step per-tenant cooldown (1/30s, fail-CLOSED on saturation)');
    lines.push('     Kills 8x quota-amplification surface for parallel gemini-2.5-flash regens');
    lines.push('  3. crypto.timingSafeEqual on /api/presenter internal-key checks');
    lines.push('     (was timing-leaky string !== compare against SESSION_SECRET)');
    lines.push('  4. auth.ts skip-list refactored — PUBLIC_EXACT_PATHS Set + isPublicPath() helper');
    lines.push('     Lowercases + strips trailing slash; fixes /.WELL-KNOWN/AGENT.JSON 401-bug');
    lines.push('  5. timingSafeCompareAuthSecret legacy plaintext path padded to 256 bytes');
    lines.push('     Eliminates length-leaking short-circuit on legacy auth paths');
    lines.push('  6. Deleted substack_page.html (310KB stale scaffolding from empty d6c8612)');
    lines.push('  Triaged false-positives (no action): OIDC state/nonce, browser-screenshots IDOR,');
    lines.push('  req.ip rate-limit spoofing, API-key in error log');
    lines.push('');
    lines.push('### R77.7 — Whole-app code review v2 + 4 targeted fixes (May 1, 2026)');
    lines.push('  Six-pronged parallel architect review; 30+ findings triaged to 4 real issues');
    lines.push('  1. tenantRateLimiter fail-CLOSED on saturation');
    lines.push('     (was: bucket map at 10000 entries silently allowed all new IPs through)');
    lines.push('  2. loginAttempts Map cap 10000 entries + prune-then-refuse policy');
    lines.push('     Prevents OOM via X-Forwarded-For spoofing flood');
    lines.push('  3. GET /api/settings defense-in-depth — personality + defaultModel return null');
    lines.push('     when no tenant resolved (so future skip-list change cant leak system prompt)');
    lines.push('  4. TWILIO_SKIP_SIGNATURE dev escape hatch ignored in production');
    lines.push('     (was: accidentally-set env var let any caller forge SMS/WhatsApp messages)');
    lines.push('');
    lines.push('### R77.6 — Code-review-driven security hardening pass (May 1, 2026)');
    lines.push('  Eleven surgical fixes from four-architect whole-platform review:');
    lines.push('  1. SESSION_SECRET hard-fails on boot in production');
    lines.push('  2. decryptApiKey() warn-once on legacy plaintext (surfaces unmigrated rows)');
    lines.push('  3. _warnUnscoped() defense-in-depth in storage helpers');
    lines.push('  4. felix-loop 4h DB-backed minimum interval check (no longer in-memory mutex)');
    lines.push('  5. exec-tool strips process.env to 6-var whitelist when spawning shell');
    lines.push('  6. tenantRateLimiter 30/min cap on unauth requests');
    lines.push('  7-11. Six storage callsites now tenant-scoped (memory, conversations, sessions, chat-engine)');
    lines.push('');
    lines.push('### R77.5 — KisMATH Reasoning Audit Rail (May 1, 2026)');
    lines.push('  Seven shippable nuggets extracted from arxiv 2507.11408v2 ("Causal CoT Graphs"):');
    lines.push('  1. trainingRegime field on every entry in MODEL_REGISTRY');
    lines.push('     OpenAI/Claude/Gemini/Grok/o4 -> rlvr');
    lines.push('     DeepSeek-V/Gemma/Kimi/Nemotron/GLM/MiMo -> distilled');
    lines.push('     Sonar -> sft  |  Llama-4-Maverick -> base');
    lines.push('  2. Regime-aware auto-router demotes RLVR for exploration categories');
    lines.push('     (reasoning, agentic, research, data-analysis @ medium/high complexity)');
    lines.push('  3. REASONING_GLUE_MISSING flag in validateAgentResponse()');
    lines.push('     Fires when >=4 numbered steps + >=600 chars but <1 connective per 4 steps');
    lines.push('  4. NEW TOOL: audit_reasoning_step');
    lines.push('     Masks step k, regens with gemini-2.5-flash, computes per-step causalScore');
    lines.push('     via Jaccard divergence + numeric mismatch (KisMATH attention-suppression surrogate)');
    lines.push('  5. NEW TOOL: verify_math_chain');
    lines.push('     Deterministic re-execution of named arithmetic via identifier substitution +');
    lines.push('     Function constructor on strict allowlist; no LLM, sub-second, RCE-blocked');
    lines.push('  6. MoA mode: exploration | exploitation | auto');
    lines.push('     Exploration auto-rebalances proposers so >=50% are non-RLVR');
    lines.push('  7. Annotation-error second-pass in agent-eval');
    lines.push('     Borderline scores (0.35-0.75) trigger cross-check by gemini-2.5-flash');
    lines.push('     Disagreements surface as POSSIBLE_ANNOTATION_ERROR');
    lines.push('  Tool count: 264 -> 266');
    lines.push('');
    lines.push('### R76 — Trust-Tier Policy Engine + Deliverable Contract Verification');
    lines.push('  Per-tenant tool_policies engine (specificity-ranked allow/deny/require_approval');
    lines.push('  with deny beating allow on tie); HITL escalation via SSE hitl:pending + owner email;');
    lines.push('  8 deliverable contracts with magic-byte/MIME/render checks gate every persona');
    lines.push('  success-claim. New tools: set_policy, verify_deliverable.');
    lines.push('');
    lines.push('### R75 — GraphRAG Five (graphrag-rs port, MIT)');
    lines.push('  PageRank node importance + Louvain communities + causal chains + cAST code chunking');
    lines.push('  + dual-level recall_context routing. Wired into 3-phase dreaming scheduler.');
    lines.push('  New tools: query_communities, query_causal, chunk_code.');
    lines.push('');
    lines.push('================================================================');
    lines.push(`## COMPLETE TOOL INVENTORY (${tools.length} tools)`);
    lines.push('================================================================');
    lines.push('Every tool registered in server/tool-registry.ts. Felix uses this list as');
    lines.push('the authoritative source when deciding what the agent team can actually do.');
    lines.push('');
    // alphabetical, 4 columns
    const toolCols = 4;
    const colWidth = 30;
    const sortedTools = [...tools].sort();
    for (let i = 0; i < sortedTools.length; i += toolCols) {
      const row = sortedTools.slice(i, i + toolCols).map(t => t.padEnd(colWidth)).join('');
      lines.push('  ' + row);
    }
    lines.push('');
    lines.push('================================================================');
    lines.push(`## COMPLETE SKILLS INVENTORY (${skillsRaw.length} skills, ${Object.keys(skillsByCat).length} categories)`);
    lines.push('================================================================');
    lines.push('Every skill registered in the skills table. Felix uses these for capability');
    lines.push('discovery when deciding which agent path to take.');
    lines.push('');
    for (const cat of Object.keys(skillsByCat).sort()) {
      lines.push(`--- Category: ${cat} (${skillsByCat[cat].length}) ---`);
      for (const name of skillsByCat[cat].sort()) {
        lines.push(`  - ${name}`);
      }
      lines.push('');
    }
    lines.push('================================================================');
    lines.push(`## COMPLETE PERSONA ROSTER (${personas.length} active personas)`);
    lines.push('================================================================');
    lines.push('Every active persona in the personas table. Each carries Doctrine #11');
    lines.push('(GraphRAG Routing) and Doctrine #12 (Trust Tiers + Deliverable Contracts).');
    lines.push('');
    for (const p of personas) {
      lines.push(`  ${p.id.padEnd(4)} ${p.name.padEnd(20)} ${p.role}`);
    }
    lines.push('');
    lines.push('================================================================');
    lines.push('## CORE SUBSYSTEMS');
    lines.push('================================================================');
    lines.push('');
    lines.push('  - A2A v0.3 Agent Card discovery (/.well-known/agent.json)');
    lines.push('  - Multi-tenant fail-CLOSED tenant scoping (tenantScope helper, STRICT_TENANT_CONTEXT)');
    lines.push('  - Felix Autonomous Loop (4h cron, dry-run safety rail through 2026-05-12)');
    lines.push('  - Felix Verification Rail (expected_post_state spec verification)');
    lines.push('  - Trust-Tier Policy Engine (specificity-ranked allow/deny/require_approval)');
    lines.push('  - Deliverable Contract Verification (8 contracts, magic-byte + MIME + render)');
    lines.push('  - HITL Escalation (SSE hitl:pending + owner email, per-confirmation dedupe)');
    lines.push('  - GraphRAG Five (PageRank + Louvain + causal chains + cAST + dual-level recall)');
    lines.push('  - KisMATH Reasoning Audit Rail (regime tagging, audit_reasoning_step, verify_math_chain)');
    lines.push('  - Three-tier image cascade (Gemini Flash Image -> gpt-image-2 -> DALL-E 3)');
    lines.push('  - MoA (Mixture of Agents) with exploration/exploitation/auto modes');
    lines.push('  - Tool Curator (R59) — semantic + per-tenant performance re-rank');
    lines.push('  - Tool Sommelier (R74.13z+3) — flounder loop detection, dormant tool surfacing');
    lines.push('  - Universal Instant-Play Layer (attachInstantPlayUrls with two-gate safety)');
    lines.push('  - Encryption-at-rest (AES-256-GCM) for Telegram tokens, WhatsApp creds');
    lines.push('  - Auth-secret HMAC-SHA256 hashing (password reset, email verification)');
    lines.push('  - Webhook reliability (CLAIM-then-COMMIT pattern, 6h GC of in-flight)');
    lines.push('  - DreamGraph (tensions table, ADRs table, /api/graph-explorer SVG visualization)');
    lines.push('  - Self-heal loop (insight -> auto-apply -> Minerva plan -> Felix queue)');
    lines.push('  - 158 security tests in 6 categories (CI hard gate)');
    lines.push('  - Public marketing surface (11 pages: landing, about, updates, architecture, etc.)');
    lines.push('  - Stripe Checkout + Connect (priceId validated against live stripe.prices)');
    lines.push('  - Coinbase Commerce + Stripe webhook signature verification + replay safety');
    lines.push('  - Glasses Gateway (20 voice-safe tool allowlist)');
    lines.push('  - MCP plugin manifests (Claude Code, Cursor, OpenAI Codex CLI)');
    lines.push('');
    lines.push('================================================================');
    lines.push('## PRODUCTION HARDENING (Architect-reviewed, all PASS)');
    lines.push('================================================================');
    lines.push('');
    lines.push('  - SESSION_SECRET hard-fail in production (R77.6)');
    lines.push('  - decryptApiKey throws DecryptionError (no silent ciphertext leak) (R74.13u-sec)');
    lines.push('  - exec-tool process.env stripped to 6-var whitelist (R77.6)');
    lines.push('  - tenantRateLimiter fail-CLOSED on map saturation (R77.7)');
    lines.push('  - loginAttempts Map cap + prune-or-refuse (R77.7)');
    lines.push('  - TWILIO_SKIP_SIGNATURE ignored in production (R77.7)');
    lines.push('  - audit_reasoning_step per-tenant cooldown 1/30s (R78.1)');
    lines.push('  - crypto.timingSafeEqual on internal-key checks (R78.1)');
    lines.push('  - isAllowedHost single-label regex (R78.1)');
    lines.push('  - skip-list normalization (lowercase + trailing slash) (R78.1)');
    lines.push('  - timingSafeCompareAuthSecret padded to 256 bytes (R78.1)');
    lines.push('  - Webhook CLAIM-then-COMMIT idempotency (R74.13u-2)');
    lines.push('  - Stripe priceId validated against live stripe.prices (R74.13u-sec)');
    lines.push('  - CSRF tokens keyed per-session (R74.13u-sec)');
    lines.push('  - 11 fail-open patches (R74.13d/R74.5)');
    lines.push('  - Knowledge-base injection sanitizer (R74.3)');
    lines.push('  - Universal HMAC-SHA256 download signing + 30-min expiry (R64.C)');
    lines.push('  - MIME magic-byte sniff on uploads (rejects HTML/SVG/XML smuggling) (R64.C)');
    lines.push('  - Per-tenant derived MCP key + SSE session-to-tenant binding (R64.C)');
    lines.push('  - sql.raw never receives user input (hard rule, enforced by review)');
    lines.push('');
    lines.push('================================================================');
    lines.push('## INTEGRATIONS');
    lines.push('================================================================');
    lines.push('');
    lines.push('  - OpenAI (gpt-5, gpt-5-mini, gpt-image-2, embeddings)');
    lines.push('  - Anthropic (Claude Sonnet 4.5, Claude Haiku 4.5)');
    lines.push('  - Google (Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Image)');
    lines.push('  - xAI (Grok 4)');
    lines.push('  - DeepSeek (V3, R1)');
    lines.push('  - OpenRouter (1000+ daily-discovered models)');
    lines.push('  - ElevenLabs (TTS)');
    lines.push('  - Stripe (Checkout, Connect, Webhooks)');
    lines.push('  - Coinbase Commerce (Crypto checkout)');
    lines.push('  - Google Workspace (Mail, Drive, Calendar, Sheets)');
    lines.push('  - OneDrive');
    lines.push('  - Replit OIDC (Log in with Replit)');
    lines.push('  - Twilio (SMS + WhatsApp)');
    lines.push('  - Telegram');
    lines.push('  - Discord');
    lines.push('  - Browserless (PDF generation, browser automation)');
    lines.push('  - Playwright (browser automation, MCP)');
    lines.push('  - Figma (MCP)');
    lines.push('  - X/Twitter (v2 API)');
    lines.push('');
    lines.push('================================================================');
    lines.push('## OWNERSHIP');
    lines.push('================================================================');
    lines.push('');
    lines.push('  Owner:    Bob Washburn');
    lines.push('  Company:  [Your Company]');
    lines.push('  EIN:      [YOUR-EIN]');
    lines.push('  Address:  [Your City, State]');
    lines.push('  Phone:    [YOUR-PHONE]');
    lines.push('  Email:    huskyauto@gmail.com');
    lines.push('  Live:     https://agenticcorporation.net');
    lines.push('  QR Code:  agenticcorporation.net');
    lines.push('  License:  Proprietary');
    lines.push('');
    lines.push('================================================================');
    lines.push('  END OF DOCUMENT — Generated by VisionClaw post-edit pipeline');
    lines.push(`  R79 MarTech Bundle build  |  ${date}`);
    lines.push('================================================================');

    const txtContent = lines.join('\n');
    const txtPath = 'VisionClaw-Comprehensive-Features.txt';
    fs.writeFileSync(txtPath, txtContent);
    console.log(`TXT_WRITTEN: ${txtPath} (${txtContent.length} chars, ${lines.length} lines)`);

    // Build the PDF via generateStyledPdf
    const { generateStyledPdf } = await import('../server/pdf-create.js').catch(() =>
      import('../server/pdf-create.ts' as any)
    );

    // Group tools into bullet chunks for the PDF (60 per chunk = 5 pages of bullets)
    const chunkArray = <T,>(arr: T[], n: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };
    const toolChunks = chunkArray(sortedTools, 60);

    const pdfSections: any[] = [
      {
        title: 'Latest Rounds — May 1-2, 2026',
        bullets: [
          'R78 — A2A v0.3 Agent Card published at /.well-known/agent.json (Linux Foundation standard, 60/min/IP rate limit, host-validated, fail-soft DB read)',
          'R78.1 — Five-architect whole-app code review hardening: 6 verified fixes shipped (regex tightening, audit cooldown, timing-safe compares, skip-list normalization, length-leak elimination, dead-file removal)',
          'R77.7 — Whole-app review v2: 4 fixes (rate-limiter fail-CLOSED on saturation, loginAttempts cap, /api/settings null-default, TWILIO production guard)',
          'R77.6 — Code-review-driven hardening: 11 surgical fixes (SESSION_SECRET hard-fail, decryptApiKey warn-once, _warnUnscoped helper, felix-loop DB-backed interval, exec-tool env whitelist, tenant rate-limiter unauth cap)',
          'R77.5 — KisMATH Reasoning Audit Rail: 7 nuggets from arxiv 2507.11408v2 (training-regime tagging, regime-aware router, REASONING_GLUE_MISSING flag, audit_reasoning_step tool, verify_math_chain tool, MoA exploration mode, annotation-error cross-check)',
        ],
      },
      {
        title: 'Active Persona Roster',
        bullets: personas.map(p => `${p.name} (#${p.id}) — ${p.role}`),
      },
    ];

    // Tool inventory as multiple sections (60 per page)
    toolChunks.forEach((chunk, i) => {
      pdfSections.push({
        title: i === 0 ? `Complete Tool Inventory — ${tools.length} tools (page ${i + 1}/${toolChunks.length})` : `Tool Inventory — page ${i + 1}/${toolChunks.length}`,
        bullets: chunk,
      });
    });

    // Skills inventory grouped by category
    pdfSections.push({
      title: `Complete Skills Inventory — ${skillsRaw.length} skills`,
      subsections: Object.keys(skillsByCat).sort().map(cat => ({
        title: `${cat} (${skillsByCat[cat].length})`,
        bullets: skillsByCat[cat].sort(),
      })),
    });

    pdfSections.push({
      title: 'Core Subsystems',
      bullets: [
        'A2A v0.3 Agent Card discovery (/.well-known/agent.json)',
        'Multi-tenant fail-CLOSED tenant scoping (tenantScope helper, STRICT_TENANT_CONTEXT env)',
        'Felix Autonomous Loop (4h cron, dry-run safety rail through 2026-05-12)',
        'Felix Verification Rail (expected_post_state spec verification, all SQL parameterized)',
        'Trust-Tier Policy Engine (specificity-ranked allow/deny/require_approval, deny beats allow)',
        'Deliverable Contract Verification (8 contracts: html/pdf/deck/image/video/audio/csv/json)',
        'HITL Escalation (SSE hitl:pending + owner email, per-confirmation dedupe with TTL+cap)',
        'GraphRAG Five (PageRank + Louvain communities + causal chains + cAST chunking + dual-level recall)',
        'KisMATH Reasoning Audit Rail (regime tagging + audit_reasoning_step + verify_math_chain)',
        'Three-tier image cascade (Gemini 2.5 Flash Image ~7s -> gpt-image-2 ~16s -> DALL-E 3 fallback)',
        'MoA (Mixture of Agents) with exploration/exploitation/auto modes',
        'Tool Curator (R59) — semantic embeddings + per-tenant performance re-rank',
        'Tool Sommelier (R74.13z+3) — flounder loop detection, dormant tool surfacing',
        'Universal Instant-Play Layer (attachInstantPlayUrls with two-gate safety, 19/19 tests PASS)',
        'Encryption-at-rest AES-256-GCM (Telegram tokens, WhatsApp Baileys session creds)',
        'Auth-secret HMAC-SHA256 hashing (password reset, email verification codes)',
        'Webhook reliability (CLAIM-then-COMMIT pattern, 6h GC of in-flight claims)',
        'DreamGraph (tensions + ADRs + /api/graph-explorer SVG visualization)',
        'Self-heal loop (insight -> auto-apply -> Minerva plan -> Felix queue)',
        '158 security tests across 6 categories (CI hard gate)',
        'MCP plugin manifests (Claude Code, Cursor, OpenAI Codex CLI)',
      ],
    });

    pdfSections.push({
      title: 'Production Hardening Track Record',
      table: {
        headers: ['Round', 'Theme', 'Fixes'],
        rows: [
          ['R78.1', 'Whole-app code review (5 architects)', '6'],
          ['R78', 'A2A v0.3 Agent Card discovery', '1 endpoint + 4 hardening'],
          ['R77.7', 'Whole-app code review v2 (6 architects)', '4'],
          ['R77.6', 'Code-review-driven hardening', '11'],
          ['R77.5', 'KisMATH Reasoning Audit Rail', '7 nuggets'],
          ['R76', 'Trust-Tier Policy + Deliverable Contracts', '4 (2 HIGH, 2 MEDIUM)'],
          ['R75 + R75.1', 'GraphRAG Five (PageRank/Louvain/causal/cAST/dual-level)', '8/8 verification PASS'],
          ['R74.13y', '"Fix anything that needs to be fixed" sweep', '8 surgical'],
          ['R74.13x', 'Felix Verification Rail (SWD-inspired)', '1 module + 2 tools'],
          ['R74.13w', 'Felix Autonomous Loop', '5 operator tools + dry-run rail'],
          ['R74.13u-sec', 'Security sweep', '5'],
          ['R74.13u-2', 'Webhook reliability rebuild', 'CLAIM-COMMIT pattern'],
          ['R74.13g', 'Schema audit + tenant-context hardening', '31 defects across 5 architect passes'],
          ['R74.13d + fix1', 'Tenant isolation + encryption-at-rest + auth hashing', '11'],
          ['R74', 'Whole-app architect security review', '4 (1 CRITICAL + 2 HIGH)'],
          ['R64.A/B/C/D', 'Stripe + tenant scoping + signed downloads + image cascade', '4 themes'],
        ],
      },
    });

    pdfSections.push({
      title: 'Integrations',
      twoColumn: {
        left: {
          title: 'AI Providers',
          bullets: [
            'OpenAI (gpt-5, gpt-5-mini, gpt-image-2, embeddings)',
            'Anthropic (Claude Sonnet 4.5, Haiku 4.5)',
            'Google (Gemini 2.5 Pro, Flash, Flash Image)',
            'xAI (Grok 4)',
            'DeepSeek (V3, R1)',
            'OpenRouter (1000+ daily catalog)',
            'ElevenLabs (TTS)',
          ],
        },
        right: {
          title: 'Operations + Channels',
          bullets: [
            'Stripe (Checkout, Connect, Webhooks)',
            'Coinbase Commerce (Crypto)',
            'Google Workspace (Mail/Drive/Cal/Sheets)',
            'OneDrive',
            'Replit OIDC',
            'Twilio (SMS + WhatsApp)',
            'Telegram + Discord',
            'Browserless + Playwright',
            'Figma (MCP)',
            'X/Twitter (v2 API)',
          ],
        },
      },
    });

    pdfSections.push({
      title: 'About',
      content: 'VisionClaw is a self-hosted multi-tenant AI agent platform that ships paying client deliverables. Most agent platforms stop at the chat. VisionClaw goes the rest of the way: intake -> execution -> quality-gated PDF/file -> Stripe -> delivery -> owner alert, with a manual-review-then-graduate pipeline so a paid order can never silently fail. Live: agenticcorporation.net. 71+ verified deliveries, 0 silent drops.',
      highlight: `${tools.length} tools  |  ${skillsRaw.length} skills  |  ${personas.length} active personas  |  36 curated AI models + 1000+ daily  |  149 tables  |  ~180k LOC TypeScript`,
    });

    console.log('PDF_GEN_START');
    const pdfResult = await (generateStyledPdf as any)({
      title: 'VisionClaw Agent Platform',
      subtitle: `Comprehensive Features — ${date}`,
      companyLines: [
        '[Your Company] | EIN: [YOUR-EIN]',
        'Owner: Bob Washburn | [Your City, ST] | [YOUR-PHONE]',
        'https://agenticcorporation.net',
      ],
      coverStats: [
        { label: 'Tools', value: String(tools.length) },
        { label: 'Skills', value: String(skillsRaw.length) },
        { label: 'Personas', value: String(personas.length) },
        { label: 'AI Models', value: '36 + 1000/day' },
        { label: 'Tables', value: '149' },
        { label: 'LOC', value: '~180k' },
        { label: 'Files', value: '453' },
        { label: 'Latest Round', value: 'R79 MarTech' },
        { label: 'Production', value: '71+ deliveries' },
      ],
      sections: pdfSections,
      footerLines: [
        'VisionClaw Agent Platform | [Your Company] | EIN [YOUR-EIN]',
        'agenticcorporation.net | huskyauto@gmail.com | [YOUR-PHONE]',
      ],
      uploadToDrive: true,
      fileName: 'VisionClaw-Comprehensive-Features.pdf',
      folderLabel: 'Platform Documentation',
    });
    console.log('PDF_RESULT:', JSON.stringify({ success: pdfResult?.success, fileId: pdfResult?.fileId, viewUrl: pdfResult?.viewUrl, size: pdfResult?.size }));

    // Upload text file to Drive
    const { uploadAndShare } = await import('../server/google-drive.js').catch(() =>
      import('../server/google-drive.ts' as any)
    );
    const txtResult = await (uploadAndShare as any)({
      filePath: txtPath,
      fileName: 'VisionClaw-Comprehensive-Features.txt',
      description: 'VisionClaw Agent Platform - Complete Feature Document (Text)',
      folderLabel: 'Platform Documentation',
      share: true,
    });
    console.log('TXT_RESULT:', JSON.stringify({ success: txtResult?.success, fileId: txtResult?.fileId, viewUrl: txtResult?.viewUrl }));

    // Register both in project_files. Tenant-isolation guard: project must
    // exist AND belong to the owner tenant (tenant 1) before we touch its
    // files; project_files has no FK and no tenant_id column, so we enforce
    // it here. Idempotent: UPDATE-existing-or-INSERT keyed on
    // (project_id, file_name) instead of blind insert (no unique index exists).
    const PRESENTATION_PROJECT_ID = parseInt(
      process.env.FELIX_PRESENTATION_PROJECT_ID || '15',
      10
    );
    const OWNER_TENANT_ID = 1;
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const txtSize = fs.statSync(txtPath).size;

      const projCheck = await pool.query(
        `SELECT id, tenant_id FROM projects WHERE id = $1 LIMIT 1`,
        [PRESENTATION_PROJECT_ID]
      );
      if (projCheck.rowCount === 0) {
        console.warn(
          `PROJECT_FILES_SKIPPED: project ${PRESENTATION_PROJECT_ID} does not exist (set FELIX_PRESENTATION_PROJECT_ID env to a real id to enable Felix knowledge-base registration)`
        );
      } else if (projCheck.rows[0].tenant_id !== OWNER_TENANT_ID) {
        console.warn(
          `PROJECT_FILES_SKIPPED: project ${PRESENTATION_PROJECT_ID} belongs to tenant ${projCheck.rows[0].tenant_id}, not owner tenant ${OWNER_TENANT_ID} — refusing to write across tenants`
        );
      } else {
        const upsert = async (
          fileName: string,
          filePath: string,
          fileType: string,
          fileSize: number
        ) => {
          const upd = await pool.query(
            `UPDATE project_files
                SET file_path = $3, file_type = $4, file_size = $5,
                    uploaded_by = $6, created_at = CURRENT_TIMESTAMP
              WHERE project_id = $1 AND file_name = $2`,
            [PRESENTATION_PROJECT_ID, fileName, filePath, fileType, fileSize, 'VisionClaw Agent']
          );
          if ((upd.rowCount || 0) === 0) {
            await pool.query(
              `INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [PRESENTATION_PROJECT_ID, fileName, filePath, fileType, fileSize, 'VisionClaw Agent']
            );
            return 'inserted';
          }
          return 'updated';
        };
        const pdfAct = await upsert(
          'VisionClaw-Comprehensive-Features.pdf',
          pdfResult?.viewUrl || '',
          'application/pdf',
          pdfResult?.size || 0
        );
        const txtAct = await upsert(
          'VisionClaw-Comprehensive-Features.txt',
          txtResult?.viewUrl || '',
          'text/plain',
          txtSize
        );
        console.log(`PROJECT_FILES_REGISTERED: pdf=${pdfAct} txt=${txtAct} project=${PRESENTATION_PROJECT_ID} tenant=${OWNER_TENANT_ID}`);
      }
    } catch (e: any) {
      console.error('PROJECT_FILES_ERROR:', e.message);
    } finally {
      await pool.end();
    }

    // Email Bob both links
    const { getOrCreateTenantInbox, sendEmail } = await import('../server/email.js').catch(() =>
      import('../server/email.ts' as any)
    );
    const inboxResult = await (getOrCreateTenantInbox as any)(1);
    const inboxId = typeof inboxResult === 'string' ? inboxResult : (inboxResult.inboxId || inboxResult.email);
    const ownerEmail = process.env.OWNER_ALERT_EMAIL || 'huskyauto@gmail.com';

    const emailBody = `VisionClaw Comprehensive Features - R79 MarTech Bundle Build (${date})

PDF (premium styled, dark gradient cover):
${pdfResult?.viewUrl || '(PDF generation failed)'}

TEXT (Felix knowledge-base format):
${txtResult?.viewUrl || '(text upload failed)'}

What changed since the last comprehensive doc:
  - R79 — MarTech Bundle: 6 voice-aware content tools (build_voice_profile,
    get_voice_profile, generate_hooks, format_post, generate_content_matrix,
    score_post) ported from charlie947/social-media-skills (MIT) and rebuilt
    multi-tenant + prompt-injection hardened (neutralizeVoiceContent + JSON
    mode + balanced-bracket parser + adversarial smoke verified)
  - R78 / R78.1 — A2A v0.3 Agent Card + 6 hardening fixes
  - R77.7 — Whole-app review v2 (4 fixes)
  - R77.6 — Code-review-driven hardening (11 fixes)
  - R77.5 — KisMATH Reasoning Audit Rail (7 nuggets, 2 new tools)
  - Tool count: 266 -> 272  |  Tables: 148 -> 149
  - Code: ~180k LOC across 453 files

Both files are also registered to project 15 (presentation project) for Felix access.

-- VisionClaw Agent Pipeline (R79 MarTech build)
`;

    const emailResult = await (sendEmail as any)({
      inboxId,
      to: ownerEmail,
      subject: 'VisionClaw Updated Features - PDF + Text (R79 MarTech Bundle, May 2 2026)',
      text: emailBody,
    });
    console.log('EMAIL_RESULT:', JSON.stringify({ success: emailResult?.success, messageId: emailResult?.messageId, to: ownerEmail }));

    console.log('\n=== FINAL LINKS ===');
    console.log('PDF:  ' + (pdfResult?.viewUrl || 'FAILED'));
    console.log('TEXT: ' + (txtResult?.viewUrl || 'FAILED'));

    process.exit(0);
  } catch (e: any) {
    console.error('PIPELINE_ERROR:', e?.message || e);
    console.error(e?.stack);
    process.exit(1);
  }
})();
