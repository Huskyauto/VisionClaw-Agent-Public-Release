/**
 * R59 Tool Curator — usage hints seed dataset.
 *
 * Maps tool name → rich routing metadata that supplements the keyword-based
 * router and feeds the semantic embedding pool. Only ~60 high-value or
 * often-confused tools are seeded here; unhinted tools degrade gracefully
 * to their existing description + category.
 *
 * Schema:
 *   useWhen[]         — natural-language phrases describing trigger situations
 *   exampleTriggers[] — verbatim user-message exemplars (boost embedding match)
 *   antiPatterns[]    — situations where this tool is the WRONG pick
 *   pairsWith[]       — tools commonly chained after this one
 *
 * Curated by hand. Add entries here over time as routing mistakes surface.
 *
 * R98.27 — AUTHORING NOTE (Min et al., EMNLP 2022 — "Rethinking the Role of
 * Demonstrations: What Makes In-Context Learning Work?"). For exampleTriggers
 * the STRUCTURAL PATTERN matters more than the literal correctness of any one
 * example: input distribution (do these phrases sound like real user messages
 * for this tool?), output space (is the implied set of next actions consistent
 * across exemplars?), and format (consistent length, tone, phrasing). A few
 * lightly-noisy exemplars in the right shape outperform a single perfect
 * one. When adding entries: prefer 3–6 short verbatim user-message-shaped
 * triggers covering the realistic phrasing variants over a single hand-crafted
 * "ideal" trigger. Same applies to useWhen[]: keep entries grammatically
 * parallel and same length-class so the embedding cluster is tight.
 */

export interface ToolUsageHint {
  useWhen: string[];
  exampleTriggers: string[];
  antiPatterns?: string[];
  pairsWith?: string[];
}

export const TOOL_USAGE_HINTS: Record<string, ToolUsageHint> = {
  // ─── Reasoning / multi-model ─────────────────────────────────────────
  ensemble_query: {
    useWhen: [
      "user wants the strongest possible answer to a thinking-heavy question",
      "high-stakes strategic decision where one model isn't enough",
      "user asks 'really think about this' / 'second opinion' / 'best answer'",
      // R125+13.18 — opt-in deliberation-quality knobs
      "question is fuzzy/ambiguous → add restate_gate:true to catch the divergence BEFORE deliberating",
      "decision-style question where premature consensus is the risk → add dissent_quota:true to force a steelman round if κ > 0.70",
      "strategy/risk/framing review where you want different REASONING LENSES not different model flavors → use proposer_pool:'polarity' (Munger/Taleb/Kahneman/Meadows, ~5x cost)",
    ],
    exampleTriggers: [
      "what's the best strategy for X",
      "give me your absolute best thinking on",
      "think harder about this",
      "panel of experts",
      "consensus answer",
      "argue both sides", // → dissent_quota:true
      "what am I missing", // → dissent_quota:true OR proposer_pool:'polarity'
      "stress test this decision", // → dissent_quota:true
      "look at this from every angle", // → proposer_pool:'polarity'
    ],
    antiPatterns: [
      "simple factual lookups",
      "tool-execution tasks",
      "code edits",
      "polarity + dissent_quota together (polarity already produces dissent by design — pick one)",
      "polarity for routine questions (~5x cost — reserve for genuine framing-sensitive decisions)",
    ],
    pairsWith: ["create_memory", "save_evidence"],
  },
  cross_critique: {
    useWhen: [
      "validating reasoning before committing to it",
      "stress-testing a draft argument or plan",
      "pre-flight check on outbound communication",
    ],
    exampleTriggers: ["poke holes in this", "what am I missing", "review my reasoning", "stress test this plan"],
  },
  tree_of_thought: {
    useWhen: ["branching exploration of decision paths", "comparing multiple solution trees"],
    exampleTriggers: ["explore options", "branch out", "what if we tried"],
  },
  debate: {
    useWhen: ["adversarial pros/cons analysis between two positions"],
    exampleTriggers: ["debate this", "argue both sides", "for and against"],
  },

  // ─── Orchestration / agents ──────────────────────────────────────────
  delegate_task: {
    useWhen: [
      "single well-defined sub-task that another persona is better suited for",
      "handing off to a specialist (Felix→Quill for writing, Felix→Minerva for planning)",
    ],
    exampleTriggers: ["have Quill draft", "ask Minerva to plan", "let Hopper handle"],
    pairsWith: ["sessions_send", "subagents"],
  },
  orchestrate: {
    useWhen: ["multi-step workflow needing coordination across several personas"],
    exampleTriggers: ["coordinate multiple steps", "end to end", "run the whole pipeline"],
    antiPatterns: ["single-call tasks", "trivial questions"],
  },
  lobster: {
    useWhen: ["heavyweight autonomous research+execute job that may take minutes"],
    exampleTriggers: ["go deep on", "research and produce", "build me a full"],
    antiPatterns: ["quick questions", "real-time interactive chat"],
  },
  plan_and_execute: {
    useWhen: ["request implies a structured plan must be made AND executed in one shot"],
    exampleTriggers: ["plan and execute", "make a plan and do it"],
  },
  parallel_research: {
    useWhen: ["multiple independent research questions that can run concurrently"],
    exampleTriggers: ["look into A, B, and C in parallel", "investigate these three things"],
  },

  // ─── Web / research ──────────────────────────────────────────────────
  deep_research: {
    useWhen: ["multi-source synthesis on a non-trivial topic"],
    exampleTriggers: ["deep research on", "comprehensive overview of", "what's the state of"],
    pairsWith: ["save_evidence", "create_memory"],
  },
  web_search: {
    useWhen: ["short factual web lookup, news, or simple link discovery"],
    exampleTriggers: ["search for", "find me articles on", "google"],
    antiPatterns: ["multi-source synthesis (use deep_research)"],
  },
  web_fetch: {
    useWhen: ["pull content from a specific known URL"],
    exampleTriggers: ["fetch this URL", "what's at https://", "read this page"],
  },
  firecrawl_scrape: {
    useWhen: ["scrape a single page that web_fetch can't render (JS-heavy / paywall-light)"],
    exampleTriggers: ["scrape", "extract from this site"],
  },
  firecrawl_crawl: {
    useWhen: ["crawl multiple pages of a site for indexing"],
    exampleTriggers: ["crawl the whole site", "index all pages of"],
  },
  readability_extract: {
    useWhen: ["clean readable text from a noisy HTML page"],
    exampleTriggers: ["readable version", "just the article text"],
  },
  vision_browse: {
    useWhen: ["visual inspection of a webpage (screenshot + analysis)"],
    exampleTriggers: ["look at this site", "what does the page look like", "visual check"],
  },
  trend_research: {
    useWhen: ["surfacing what's trending in a domain right now"],
    exampleTriggers: ["what's trending", "hot topics in"],
  },

  // ─── Memory / knowledge ──────────────────────────────────────────────
  search_memory: {
    useWhen: ["look up something the user told you before"],
    exampleTriggers: ["remember when I said", "what did I tell you about"],
  },
  create_memory: {
    useWhen: ["user shares a DURABLE personal preference, fact, or important context the persona should know in EVERY future conversation (L3 — persona-lifetime)"],
    exampleTriggers: ["remember this forever", "save this permanently", "always remember", "don't ever forget"],
    antiPatterns: [
      "in-flight state for the current conversation only (use remember_for_this_session instead — L2)",
      "agreements reached this turn that would be noise in other chats (use remember_for_this_session)",
    ],
  },
  remember_for_this_session: {
    useWhen: [
      "pin a fact to THIS conversation only — survives context-window truncation but does NOT cross to other chats",
      "in-flight task state, current debug target, agreements reached this turn",
      "anything that would be NOISE if it surfaced in a different conversation",
    ],
    exampleTriggers: ["for this chat", "for now", "in this thread", "remember for this conversation"],
    pairsWith: ["recall_context", "create_memory"],
    antiPatterns: [
      "durable cross-conversation facts about the user or brand (use create_memory — L3)",
      "reference knowledge a future agent should vector-search (use create_knowledge)",
    ],
  },
  recall_context: {
    useWhen: ["surface the most relevant past memories for the current topic"],
    exampleTriggers: [],
  },
  graph_memory: {
    useWhen: ["hierarchical/relational memory traversal (parent→child relationships)"],
    exampleTriggers: ["what's connected to", "related memories"],
  },
  search_knowledge: {
    useWhen: ["look up something in the structured knowledge base (not personal memories)"],
    exampleTriggers: ["what do we know about", "find in our knowledge"],
  },
  create_knowledge: {
    useWhen: ["save a learned fact, document chunk, or reusable piece of knowledge"],
    exampleTriggers: ["add to knowledge", "save this fact"],
  },
  store_triple: {
    useWhen: ["store a structured subject-predicate-object fact"],
    exampleTriggers: ["X is Y", "remember that A relates to B"],
  },
  query_triples: {
    useWhen: ["query the structured triples knowledge graph"],
    exampleTriggers: ["what do you know about", "list facts about"],
  },
  doc_search: {
    useWhen: [
      "search uploaded markdown/text/PDF documents the user has ingested into a collection",
      "find a passage in a known notes/docs/transcripts collection",
      "retrieve grounded source material from a tenant knowledge corpus before drafting",
      "ingest a new document into a collection (action: add_doc) — set auto_contextualize:true on noisy KBs to get -49% top-K retrieval failure",
    ],
    exampleTriggers: [
      "search the docs",
      "find in uploaded files",
      "look it up in our knowledge base",
      "what does the meeting transcript say about",
      "add this doc to the collection",
      "ingest these notes with auto-context",
    ],
    antiPatterns: [
      "personal memories about the user (use search_memory)",
      "structured triple/relational facts (use query_triples / search_knowledge)",
      "live web lookup (use web_search)",
    ],
  },

  // ─── Design ──────────────────────────────────────────────────────────
  figma: {
    useWhen: [
      "user references a Figma file, frame, or node-id",
      "needs design context for UI work (mockups, components, design tokens)",
      "extracting screenshots or comments from a Figma file",
    ],
    exampleTriggers: [
      "look at this figma",
      "design context for node-id",
      "what's in this figma frame",
      "render this figma component",
      "figma comments",
    ],
    antiPatterns: ["non-Figma design tools (Sketch, Adobe XD)"],
  },

  // ─── Wellness / Felix interventions ──────────────────────────────────
  stress_intervention: {
    useWhen: ["user shows signs of high stress, overwhelm, frustration"],
    exampleTriggers: ["I'm overwhelmed", "everything is going wrong", "I can't deal", "stressed out"],
    antiPatterns: ["normal task chat"],
  },
  detect_fatigue: {
    useWhen: ["session has been running long, user shows tiredness signals"],
    exampleTriggers: ["I'm tired", "long day", "burnt out"],
  },
  detect_emotional_state: {
    useWhen: ["before responding to a high-emotion message — calibrate tone"],
    exampleTriggers: [],
  },
  micro_sabbatical: {
    useWhen: ["recommending a brief break / breath / step away"],
    exampleTriggers: ["need a break"],
  },
  grounding_intervention: {
    useWhen: ["user is spiraling, anxious, dissociating — bring back to present"],
    exampleTriggers: ["panic", "spiraling", "anxious"],
  },

  // ─── Marketing / social ──────────────────────────────────────────────
  draft_social_post: {
    useWhen: ["compose a social media post in draft form (not publishing yet)"],
    exampleTriggers: ["write a tweet", "draft a LinkedIn post", "social post about"],
  },
  publish_social_post: {
    useWhen: ["actually publish to a connected social account (after approval)"],
    exampleTriggers: ["publish this", "post it now"],
    antiPatterns: ["draft phase (use draft_social_post)"],
  },
  generate_social_image: {
    useWhen: ["create an image to accompany a social post"],
    exampleTriggers: ["image for the post", "graphic to go with"],
  },
  x_post_tweet: {
    useWhen: ["post directly to X/Twitter via the API"],
    exampleTriggers: ["tweet this", "post on X"],
  },
  x_search: {
    useWhen: ["search X/Twitter for posts on a topic"],
    exampleTriggers: ["what are people saying on twitter", "x search"],
  },
  x_get_mentions: {
    useWhen: ["check who has mentioned the user's account recently"],
    exampleTriggers: ["my mentions", "who tagged me"],
  },

  // ─── Media / video / audio ───────────────────────────────────────────
  // Bob's flagship Built With Bob WEEKLY RECAP. This MUST surface (and be
  // called DIRECTLY) for any "this week's recap" request — without a hint the
  // router routed the query to the `knowledge` category and never offered the
  // tool, so the agent fell into a delegate_task loop that HITL-denied. The
  // hint folds bwb_weekly_build's media/video/social categories into scoring so
  // it appears in the candidate set for trusted personas (Felix/Forge).
  bwb_weekly_build: {
    useWhen: [
      "Bob asks to build this week's Built With Bob weekly recap video",
      "user wants the weekly recap that stitches Bob's daily selfie clips into one narrated story",
      "any request naming a week window for a Built With Bob recap (e.g. 'week of May 31 to June 6 recap')",
    ],
    exampleTriggers: [
      "build this week's recap",
      "this week's built with bob recap",
      "bwb weekly recap",
      "weekly recap video",
      "built with bob weekly",
      "recap for the week",
    ],
    antiPatterns: [
      "a generic customer video from a brief (use build_video_from_brief)",
      "a one-off evergreen video that does not pull this week's actual daily clips",
    ],
  },
  produce_video: {
    useWhen: ["full end-to-end video creation from a brief"],
    exampleTriggers: ["make me a video about", "produce a video"],
  },
  // Owner-only venture discovery loop. Without a hint, "explore this business
  // idea" routes to the `knowledge`/`research` category and the tool may never be
  // offered; this folds its research/planning categories into scoring so it
  // surfaces (for trusted personas) on idea-validation phrasings.
  venture_discovery: {
    useWhen: [
      "the owner wants a business or product idea explored / validated end-to-end",
      "the owner asks 'should I build X', 'is there a business in Y', or to vet a venture",
      "the owner wants to start, advance, or read a venture discovery run",
    ],
    exampleTriggers: [
      "run a venture discovery",
      "explore this business idea",
      "validate this startup idea",
      "should I build this",
      "vet this product idea",
      "advance the venture discovery",
    ],
    antiPatterns: [
      "general market research with no end-to-end discovery (use deep_research / web_search)",
      "a non-owner tenant trying to run the loop (it is owner-only)",
    ],
  },
  generate_audio: {
    useWhen: ["text-to-speech narration generation"],
    exampleTriggers: ["narration", "voiceover", "tts", "voice over"],
  },
  create_slideshow_video: {
    useWhen: ["build a slideshow video from images + audio"],
    exampleTriggers: ["slideshow video", "image-based video"],
  },
  video_burn_captions: {
    useWhen: ["overlay captions onto an existing video"],
    exampleTriggers: ["add captions", "burn subtitles"],
  },
  video_cut_fillers: {
    useWhen: ["remove ums/ahs/silences from video"],
    exampleTriggers: ["cut fillers", "remove ums"],
  },
  youtube: {
    useWhen: ["upload to YouTube or fetch metadata about a YouTube video"],
    exampleTriggers: ["upload to youtube", "youtube video info"],
  },

  // ─── Documents / PDF / slides ────────────────────────────────────────
  create_pdf: {
    useWhen: ["build a PDF document from scratch (report, brief, analysis)"],
    exampleTriggers: ["pdf report", "executive summary", "white paper", "create a pdf"],
  },
  create_styled_report: {
    useWhen: ["polished branded report PDF with headers/charts/tables"],
    exampleTriggers: ["styled report", "branded report"],
  },
  fill_pdf: {
    useWhen: ["populate fields in an existing fillable PDF form"],
    exampleTriggers: ["fill out this pdf form", "pdf form"],
  },
  analyze_pdf: {
    useWhen: ["extract text and structure from a PDF for analysis"],
    exampleTriggers: ["analyze this pdf", "what's in this pdf"],
  },
  create_slides: {
    useWhen: ["generate a slide deck (Google Slides / pptx)"],
    exampleTriggers: ["slide deck", "presentation about", "powerpoint"],
  },
  build_presentation_distributed: {
    useWhen: ["large slide deck where slides should be drafted in parallel by multiple agents"],
    exampleTriggers: ["build a long deck", "distributed presentation"],
  },

  // ─── Finance ─────────────────────────────────────────────────────────
  forecast_ticker: {
    useWhen: ["produce a forward-looking forecast for a specific stock ticker"],
    exampleTriggers: ["forecast AAPL", "where is X stock going", "predict ticker"],
  },
  analyze_portfolio: {
    useWhen: ["holistic risk/diversification/allocation analysis of a portfolio"],
    exampleTriggers: ["analyze my portfolio", "portfolio risk", "diversification check"],
  },
  finance_market_overview: {
    useWhen: ["snapshot of broad market conditions today"],
    exampleTriggers: ["market today", "market overview", "what's happening in markets"],
  },
  finance_news: {
    useWhen: ["recent financial news on a topic or ticker"],
    exampleTriggers: ["finance news", "market news"],
  },

  // ─── CRM / sales ─────────────────────────────────────────────────────
  add_customer: {
    useWhen: ["add a new customer record to CRM"],
    exampleTriggers: ["new customer", "add client"],
  },
  enrich_lead: {
    useWhen: ["enhance a sparse lead record with additional public data"],
    exampleTriggers: ["enrich this lead", "fill in missing info on"],
  },
  score_leads: {
    useWhen: ["rank multiple leads by ICP fit"],
    exampleTriggers: ["score these leads", "which leads are best"],
  },
  create_sequence: {
    useWhen: ["set up a multi-step outreach email cadence"],
    exampleTriggers: ["email sequence", "drip campaign", "cadence"],
  },
  classify_reply: {
    useWhen: ["categorize an inbound email reply (interested / not / objection)"],
    exampleTriggers: ["what kind of reply", "classify this email"],
  },

  // ─── Email / messaging ───────────────────────────────────────────────
  send_email: {
    useWhen: ["send a real outbound email to a recipient (after content is finalized)"],
    exampleTriggers: ["send the email", "email this to"],
    antiPatterns: ["drafting (write the body first, then call this)"],
  },
  check_inbox: {
    useWhen: ["check Gmail for new messages"],
    exampleTriggers: ["check email", "any new emails"],
  },
  send_message: {
    useWhen: ["send via SMS/Twilio/WhatsApp depending on configured channel"],
    exampleTriggers: ["text them", "send sms"],
  },

  // ─── Files / drive ───────────────────────────────────────────────────
  google_drive: {
    useWhen: ["upload, list, download, share files on Google Drive"],
    exampleTriggers: ["save to drive", "upload to google drive", "list drive files"],
  },
  read_file: {
    useWhen: ["read content from a stored file in this project"],
    exampleTriggers: ["read this file", "open the file"],
  },
  write_file: {
    useWhen: ["create or overwrite a file in this project"],
    exampleTriggers: ["save as file", "write to a file", "create file"],
  },

  // ─── Skills / tool factory ───────────────────────────────────────────
  create_tool: {
    useWhen: ["agent identifies a recurring need and wants to synthesize a new custom tool"],
    exampleTriggers: ["I need a tool that", "make a custom tool"],
  },
  manage_skills: {
    useWhen: ["enable, disable, or inspect persona skills"],
    exampleTriggers: ["enable skill", "manage skills"],
  },
  skill_seeker: {
    useWhen: ["scan the system for capability gaps and propose new skills"],
    exampleTriggers: ["what skills are we missing", "find capability gaps"],
  },
  introspect_tools: {
    useWhen: ["agent wants to know what tools it has available right now"],
    exampleTriggers: ["what tools do I have for"],
  },

  // ─── System / governance ─────────────────────────────────────────────
  check_system_status: {
    useWhen: ["health check on platform components"],
    exampleTriggers: ["system status", "is everything working", "health check"],
  },
  agent_status: {
    useWhen: ["status of running agents and recent runs"],
    exampleTriggers: ["agent status", "what are agents doing"],
  },
  context_budget_audit: {
    useWhen: ["check whether the current tenant is approaching context window limits"],
    exampleTriggers: ["context budget", "are we over the limit"],
  },
  request_approval: {
    useWhen: ["pause for human approval before a high-stakes action"],
    exampleTriggers: ["need approval", "ask before doing"],
  },
  self_heal: {
    useWhen: ["repair a known platform regression or stuck workflow"],
    exampleTriggers: ["self heal", "fix the system"],
  },

  // ─── Planning ─────────────────────────────────────────────────────────
  create_plan: {
    useWhen: ["generate a structured Minerva plan for a non-trivial multi-step request"],
    exampleTriggers: ["plan this out", "make a plan for"],
  },

  // ─── Reporting ───────────────────────────────────────────────────────
  profit_and_loss: {
    useWhen: ["P&L statement for a period"],
    exampleTriggers: ["p&l", "profit and loss", "income statement"],
  },
  business_health_score: {
    useWhen: ["composite health score across finance/sales/operations"],
    exampleTriggers: ["business health", "how is the business doing"],
  },

  // ─── Competitor intel ────────────────────────────────────────────────
  add_competitor: {
    useWhen: ["start tracking a new competitor"],
    exampleTriggers: ["track competitor", "watch this company"],
  },
  competitor_briefing: {
    useWhen: ["produce a briefing on detected competitor changes"],
    exampleTriggers: ["competitor update", "what changed at"],
  },

  // ─── Notes ───────────────────────────────────────────────────────────
  write_daily_note: {
    useWhen: ["log a daily journal-style note"],
    exampleTriggers: ["log today", "daily note"],
  },
  write_scratchpad: {
    useWhen: ["jot a quick thought to a scratchpad for later"],
    exampleTriggers: ["scratchpad", "jot down"],
  },

  // ─── Code execution ──────────────────────────────────────────────────
  exec: {
    useWhen: ["run a shell command in the sandbox (after explicit user request)"],
    exampleTriggers: ["run this command", "exec"],
    antiPatterns: ["any unsanctioned shell access"],
  },
  execute_code: {
    useWhen: ["run a code snippet in the sandbox to compute something"],
    exampleTriggers: ["run this code", "execute"],
  },
};

export function getUsageHint(toolName: string): ToolUsageHint | undefined {
  return TOOL_USAGE_HINTS[toolName];
}

export function getHintedToolNames(): string[] {
  return Object.keys(TOOL_USAGE_HINTS);
}

export function buildHintCorpus(toolName: string): string {
  const h = TOOL_USAGE_HINTS[toolName];
  if (!h) return "";
  return [
    ...h.useWhen,
    ...h.exampleTriggers,
  ].join(" • ");
}
