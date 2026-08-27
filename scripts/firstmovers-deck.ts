(async () => {
  const { generateStyledPdf } = await import("../server/pdf-create");
  const { deliverDigitalProduct } = await import("../server/delivery-pipeline");

  const N = (text: string) => ({ title: "Speaker Narration", content: text });

  const sections = [
    {
      title: "Slide 1 — Title",
      content:
        "First Movers x VisionClaw\nAn Operating System For The AI Services Business You Are Already Running.",
      bullets: [
        "Investor and Partnership Pitch",
        "Presented by Robert Washburn, Founder, [Your Company]",
        "VisionClaw — agenticcorporation.net",
      ],
      subsections: [
        N(
          "Thank you for the time today. I am Robert Washburn, the founder of VisionClaw. " +
            "What I want to walk First Movers through over the next fifteen minutes is not another AI tool you could plug into. " +
            "It is the operating system for the AI services business you are already running. " +
            "We will cover the gap in the market, what VisionClaw actually is, how it would run First Movers internally, " +
            "how you can resell that same engine to your own customers, the trust and governance we have built in, " +
            "the live numbers from production today, the business model, and what we are asking for."
        ),
      ],
    },

    {
      title: "Slide 2 — Why Now",
      content:
        "Every company is being told to adopt AI. Almost none of them have an operating model for it.",
      bullets: [
        "The market moved past chatbots in 2025 — buyers want outcomes, not prompts.",
        "Enterprises are spending on AI but cannot put it into a repeatable workflow.",
        "Service firms like First Movers are the bridge — but the bridge is held together with scripts and Slack.",
        "Whoever delivers a real, governed, multi-agent operating layer in the next 12 months wins the category.",
      ],
      subsections: [
        N(
          "Here is the timing argument. In 2024 the question was, can the model do this. In 2025 the question became, " +
            "can my company actually run on this. And almost nobody can answer that yes. Buyers are tired of demos. " +
            "They want outcomes — a finished report on their desk, an outbound campaign that ran itself, a monitoring " +
            "loop that catches issues before they happen. Service companies like First Movers are the natural bridge " +
            "between models and outcomes. But today that bridge is held together with custom scripts, Slack threads, and " +
            "smart humans firefighting. The window for someone to ship a real operating layer that turns service teams " +
            "into AI-native businesses is the next twelve months. After that the category is set."
        ),
      ],
    },

    {
      title: "Slide 3 — The Pain Your Customers Are Already Telling You",
      bullets: [
        "They paid for an AI tool. They still do not have an outcome.",
        "Each agent is its own island — research, writing, outreach, monitoring all live in different tabs.",
        "There is no audit trail. They cannot show their board what the AI did or why.",
        "There is no governance. One bad prompt can email a customer or move money.",
        "Quality drifts. What worked Monday is mediocre by Friday and nobody knows why.",
      ],
      subsections: [
        N(
          "These five bullets are what your customers are already complaining about, even if they have not put it this " +
            "cleanly. They paid for the AI tool. They still do not have the outcome they were sold. Their agents are siloed. " +
            "Their compliance team has no audit trail. Their CFO is nervous because nothing stops a hallucination from " +
            "becoming an outbound email. And quality is silently drifting because nobody is measuring it. Every one of " +
            "these is a problem VisionClaw was built to solve, and every one of these is something First Movers can " +
            "stop apologizing for the moment we are under the hood."
        ),
      ],
    },

    {
      title: "Slide 4 — What VisionClaw Actually Is",
      content:
        "VisionClaw is a multi-tenant agentic AI corporation platform. Not a chatbot. A company in software.",
      bullets: [
        "Sixteen specialist AI agents with defined roles — research, ops, sales, content, monitoring, finance, engineering.",
        "Two hundred and fifty-one connected tools across thirty-six model routes plus a thousand-route fallback mesh.",
        "Coordinated by a chief-of-staff layer that plans, delegates, audits, and reports.",
        "Multi-tenant by design — every customer gets their own isolated company brain.",
        "Live in production today at agenticcorporation.net.",
      ],
      coverStatsHint: true,
      subsections: [
        N(
          "Here is what we actually are. VisionClaw runs as a software corporation. Sixteen specialist agents — not " +
            "personas in a prompt, real agents with their own memory, their own tools, their own scopes. They work " +
            "across two hundred and fifty-one connected tools and route across thirty-six primary models with a thousand " +
            "additional fallback routes, so when a provider goes down the work does not stop. Above all of that sits a " +
            "chief-of-staff layer that does what a real COO does — it plans, it delegates, it audits, and it reports. " +
            "And critically, this is multi-tenant from the ground up. Every customer that lives on VisionClaw gets their " +
            "own isolated company brain — their own data, their own agents, their own audit trail. This is not vapor. " +
            "This is running in production right now at agenticcorporation.net."
        ),
      ],
    },

    {
      title: "Slide 5 — How It Runs Your Company (First Movers Internally)",
      content:
        "Day one, VisionClaw runs the parts of First Movers that are eating your team's nights and weekends.",
      bullets: [
        "Research agents pull market intel, competitor moves, and customer signals every night.",
        "Content agents draft proposals, case studies, weekly reports, and investor updates.",
        "Sales agents triage inbound, draft follow-ups, and queue them for human approval.",
        "Ops agents monitor deliverables, catch SLA risk early, and route exceptions to a human.",
        "Finance agents reconcile billing, flag revenue leaks, and prep your board pack.",
        "All of it logged, attributed, and approval-gated where it touches money or customers.",
      ],
      subsections: [
        N(
          "Before we talk about reselling, let me show you what VisionClaw does for First Movers itself on day one. " +
            "Your research function — gone, in a good way. Agents pull market intel, competitor moves, and customer " +
            "signals every night while your team sleeps. Your content function — proposals, case studies, weekly client " +
            "reports, investor updates — drafted automatically, ready for a human edit. Your sales function — every " +
            "inbound triaged, every follow-up drafted, queued for one-click approval. Operations watches every active " +
            "engagement and flags SLA risk before your customer notices. Finance reconciles billing and preps your board " +
            "pack. And the whole thing is logged and attributed, with mandatory human approval anywhere money or a " +
            "customer is touched. This alone is the ROI story for First Movers as a customer of one."
        ),
      ],
    },

    {
      title: "Slide 6 — How It Runs Your Customers' Companies (The Resell Layer)",
      content:
        "Now the real business: First Movers becomes the operating layer your customers depend on.",
      bullets: [
        "Each customer gets a fully isolated VisionClaw tenant — their own data, agents, and brand.",
        "First Movers configures the workflows, owns the relationship, sets the price.",
        "Customer sees First Movers branding, First Movers SLA, First Movers invoice.",
        "VisionClaw is the engine — invisible to the end customer, fully under your control.",
        "Net result: every customer becomes a recurring SaaS line item, not a one-time project.",
      ],
      subsections: [
        N(
          "And this is where it stops being a tool conversation and starts being a business model conversation. " +
            "Today First Movers sells projects. Smart projects, AI-flavored projects, but projects. They end. The customer " +
            "moves on. With VisionClaw underneath you, every customer becomes a tenant — a fully isolated environment " +
            "you spin up for them. You configure the workflows. You own the customer relationship. They see your brand, " +
            "your SLA, your invoice. We are the engine they never have to know about. You set the price and you keep " +
            "the margin. The same engagement that used to be a sixty-day project becomes a recurring subscription that " +
            "compounds. That is the difference between a services revenue line and a SaaS revenue line, and your valuation " +
            "multiple knows the difference."
        ),
      ],
    },

    {
      title: "Slide 7 — Technical Architecture (The Short Version)",
      content:
        "Built for production. Not a prototype with a polished landing page.",
      bullets: [
        "TypeScript Express backend, React Vite frontend, PostgreSQL with one hundred and thirty-eight tables.",
        "pgvector with HNSW indexes for semantic memory across every conversation, doc, and agent decision.",
        "Multi-provider model mesh — OpenAI, Anthropic, xAI, Gemini, OpenRouter, ElevenLabs.",
        "Coinbase Commerce and Stripe for payments, Google Drive and Gmail for delivery, MCP server for tool exposure.",
        "Job worker, background autoresearch, dreaming and self-reflection cycles, heartbeat-driven autonomy.",
        "Full deploy at agenticcorporation.net. Production indexes, health monitor, watchdog — currently green.",
      ],
      subsections: [
        N(
          "I will not bore the room with architecture, but the technical team in here needs to know this is real. " +
            "TypeScript backend, React frontend, Postgres with one hundred and thirty-eight production tables, pgvector " +
            "with HNSW indexes for semantic recall across every conversation. We route across every major model provider " +
            "with automatic fallback so a single provider outage never takes us down. Payments, document delivery, " +
            "and agent tooling are all wired through standard interfaces — Stripe, Coinbase, Google Workspace, MCP. " +
            "There is a job worker, a watchdog, a health monitor, and the platform actually has a self-reflection and " +
            "dreaming cycle that consolidates memory overnight. It is currently deployed and healthy at agenticcorporation.net."
        ),
      ],
    },

    {
      title: "Slide 8 — Trust, Safety, And Governance",
      content:
        "The piece every other AI vendor is missing — and the piece your enterprise customers will demand.",
      bullets: [
        "Forty governance rules enforced in code, not policy docs.",
        "Mandatory human approval gates on any high-risk action — outbound email, payment, contract, deletion.",
        "Trust score per agent — rises with successful outcomes, drops when humans override.",
        "Full audit log of every decision, every tool call, every model route, every approval.",
        "Tenant data is isolated at the database row level — no customer ever sees another customer's data.",
        "Forty-seven production indexes ensure scale stays sane as you add tenants.",
      ],
      subsections: [
        N(
          "This is the slide that closes enterprise customers. Every other AI vendor in the market sells you the " +
            "horsepower and leaves the seatbelts as a problem for you. We did the opposite. There are forty governance " +
            "rules enforced in code — not policy documents, code. Anywhere an action is high-risk — outbound email, " +
            "money movement, contract changes, deletions — there is a mandatory human approval gate. We track a trust " +
            "score per agent that rises with successful outcomes and drops when a human overrides. Every decision, every " +
            "tool call, every model route, every approval is logged and queryable. And tenant data is isolated at the " +
            "database row level — there is no scenario where one of your customers ever sees another customer's data. " +
            "When First Movers' enterprise customer asks the inevitable security question, you will have an answer."
        ),
      ],
    },

    {
      title: "Slide 9 — Live Production Numbers (As Of Today)",
      table: {
        headers: ["Metric", "Live Value"],
        rows: [
          ["Production tables", "138"],
          ["Specialist agents", "16"],
          ["Connected tools", "251"],
          ["Model routes (primary + fallback)", "36 + 1,000"],
          ["Active capabilities", "89"],
          ["Production indexes ensured", "47 / 47"],
          ["Governance rules enforced", "40"],
          ["Conversations to date", "427"],
          ["Messages processed", "336+"],
          ["Stored memories", "480+"],
          ["Autonomous tasks completed", "16"],
          ["Tasks executed", "179+"],
          ["Wiring invariants — critical findings", "0"],
        ],
      },
      subsections: [
        N(
          "These are not pitch-deck numbers. These are pulled live from production this afternoon. One hundred and " +
            "thirty-eight production tables. Sixteen real agents. Two hundred and fifty-one connected tools. Thirty-six " +
            "primary model routes plus a thousand fallback routes. Eighty-nine active capabilities, forty-seven of " +
            "forty-seven production indexes ensured at every startup, forty governance rules enforced. Four hundred and " +
            "twenty-seven conversations have already moved through the system. Four hundred and eighty memories " +
            "consolidated. Sixteen fully autonomous tasks completed end to end. And the most important line on this " +
            "slide — zero critical wiring findings on the latest invariant scan. This is not a slide about what we " +
            "intend to build. This is the inventory of what is running right now."
        ),
      ],
    },

    {
      title: "Slide 10 — Business Model",
      content:
        "Three revenue lines, all recurring, all aligned with how First Movers makes money.",
      bullets: [
        "Platform subscription — flat monthly per First Movers tenant, scales with seat count.",
        "Customer-tenant pricing — First Movers pays a wholesale rate per customer-tenant they spin up; sells retail at whatever margin they want.",
        "Usage overage — model spend, document storage, premium tools billed at cost-plus.",
        "Optional revenue share on flagship co-built workflows.",
      ],
      table: {
        headers: ["Revenue line", "First Movers economics"],
        rows: [
          ["Platform subscription", "Predictable monthly base"],
          ["Per-customer-tenant", "High-margin recurring resell"],
          ["Usage overage", "Pass-through with markup"],
          ["Co-built workflows", "Shared upside on hits"],
        ],
      },
      subsections: [
        N(
          "The model is simple and it is built so we both win when First Movers grows. Three lines. A flat platform " +
            "subscription that gives First Movers the right to operate on VisionClaw — predictable, low risk. A wholesale " +
            "per-customer-tenant rate that you mark up to your customers however your market will bear, which is the " +
            "real margin engine. A pass-through usage line for model spend and storage at cost plus a small markup, so " +
            "your customers' usage growth never becomes your liability. And optional revenue share on co-built workflows " +
            "where we ship something together that becomes a category — we share the upside instead of arguing over the " +
            "invoice."
        ),
      ],
    },

    {
      title: "Slide 11 — Use Of Funds",
      table: {
        headers: ["Bucket", "Allocation", "What It Buys"],
        rows: [
          ["Engineering scale", "40 percent", "Hardening multi-tenant isolation, SOC2 prep, agent SDK"],
          ["Go-to-market with First Movers", "25 percent", "Partner enablement, white-label tooling, joint case studies"],
          ["Model and infra cost runway", "20 percent", "Eighteen months of model spend at projected tenant load"],
          ["Compliance and security", "10 percent", "Pen tests, SOC2 Type 1, data residency"],
          ["Operating reserve", "5 percent", "Working capital and contingency"],
        ],
      },
      subsections: [
        N(
          "Here is exactly where the money goes. Forty percent into engineering scale — hardening the multi-tenant " +
            "isolation, kicking off SOC2 prep, building the agent SDK that lets First Movers extend the platform without " +
            "waiting on us. Twenty-five percent into go-to-market specifically with First Movers — partner enablement, " +
            "white-label tooling, joint case studies that we both put on our websites. Twenty percent reserved as model " +
            "and infrastructure runway so we are never the bottleneck on a tenant launch. Ten percent into compliance " +
            "— pen tests, SOC2 Type 1, data residency options for the customers that will ask. Five percent operating " +
            "reserve. No marketing spray, no vanity hires, no leased office. Every dollar is in the product, the " +
            "partnership, or the runway."
        ),
      ],
    },

    {
      title: "Slide 12 — The Ask",
      content:
        "We are raising a strategic round and we want First Movers in it.",
      bullets: [
        "Strategic capital with a partnership commitment, not just a check.",
        "Joint go-to-market — First Movers becomes our anchor reseller and reference logo.",
        "First-look on enterprise tenants in your customer base before any other partner.",
        "Quarterly product roadmap input — the workflows that move your business move first.",
        "Investor seat for visibility, not control.",
      ],
      subsections: [
        N(
          "The ask. We are raising a strategic round and the reason First Movers is sitting in this room is that we " +
            "want this to be a partnership, not a check. What that looks like — strategic capital paired with a " +
            "commercial commitment, joint go-to-market with First Movers as our anchor reseller and our first reference " +
            "logo, first-look on enterprise tenants in your existing book of business before we offer them to any other " +
            "partner, quarterly product roadmap input so the workflows that grow your revenue grow first on our side, " +
            "and an investor seat for visibility, not for control. The exact dollar figure and structure I am happy to " +
            "walk through in the follow-up — that is a conversation, not a slide."
        ),
      ],
    },

    {
      title: "Slide 13 — Why First Movers Specifically",
      content:
        "We could pitch ten firms. We are pitching First Movers because the fit is mechanical.",
      bullets: [
        "You already run AI workloads for customers — you understand what we are without a translation layer.",
        "Your customers already trust you with their highest-leverage problems — that distribution is irreplaceable.",
        "You are early enough to shape the product, late enough to demand it actually works — both true today.",
        "Your reputation as a first mover is the reason the partnership label means something on our side.",
      ],
      subsections: [
        N(
          "And to close — the reason First Movers is the right partner. You already run AI workloads for your customers, " +
            "which means I do not have to spend an hour explaining what an agentic workflow is. You already have the " +
            "trust of customers who are facing the exact problems we solve. You are early enough that your input shapes " +
            "the roadmap and late enough that you are not going to bet your firm on something that does not work — and " +
            "what we just walked through is something that does work. And finally, the name First Movers means something " +
            "in this market. When we say First Movers chose VisionClaw as their operating layer, every other partnership " +
            "conversation I have for the next twenty-four months gets easier."
        ),
      ],
    },

    {
      title: "Slide 14 — Q&A Prep (Likely Questions and How To Answer Them)",
      subsections: [
        {
          title: "Q: What stops OpenAI or Anthropic from just doing this themselves",
          content:
            "They build models. Their incentive is to sell tokens, not to build a multi-tenant operating company. " +
            "Every layer above the model is left open precisely because the model labs do not want to be in the " +
            "services business. That is the gap we live in.",
        },
        {
          title: "Q: How is this different from CrewAI, AutoGen, LangGraph",
          content:
            "Those are open-source agent frameworks for engineers to build with. We are an operating company that " +
            "non-engineers run a business on. Different buyer, different price point, different deliverable.",
        },
        {
          title: "Q: What if a customer's data leaks across tenants",
          content:
            "Tenant isolation is enforced at the database row level on every read and write. There is no shared " +
            "memory store, no cross-tenant agent, no global cache. Plus full audit logging and the forty governance " +
            "rules that gate sensitive actions.",
        },
        {
          title: "Q: What if a model provider has an outage during a customer-critical run",
          content:
            "We route across thirty-six primary models with a thousand-route fallback mesh. A single provider going " +
            "down degrades, it does not stop, the platform.",
        },
        {
          title: "Q: When is SOC2",
          content:
            "Type 1 inside twelve months of close. Type 2 the year after. The compliance budget on the previous slide " +
            "is sized for it.",
        },
        {
          title: "Q: What is the realistic timeline to onboard a First Movers customer as a tenant",
          content:
            "Pilot tenant standup in days, not weeks. Production tenant with First Movers' branding and approval " +
            "gates configured in two to four weeks depending on how custom the workflows need to be.",
        },
      ],
    },

    {
      title: "Slide 15 — Closing",
      content:
        "First Movers built a business on being early to AI. VisionClaw is what makes that lead structural.",
      bullets: [
        "The category is being decided in the next twelve months.",
        "Either you are the operating layer your customers run on, or you are the consultancy they remember fondly.",
        "We have the platform, the production deployment, and the governance. You have the customers and the trust.",
        "Let's pick a partnership shape this week.",
      ],
      highlight:
        "Robert Washburn  |  [Your Company]  |  huskyauto@gmail.com  |  agenticcorporation.net",
      subsections: [
        N(
          "Closing. First Movers built its business on being early to AI. VisionClaw is what turns that early lead " +
            "into a structural one. The category is being decided in the next twelve months. After that, your customers " +
            "either run on you, or they remember you. We have the platform, the production deployment, the governance, " +
            "the live numbers. You have the customers and the trust. The smart move is to pick a partnership shape this " +
            "week. Thank you. I'll take questions."
        ),
      ],
    },
  ];

  console.log("[deck] generating PDF...");
  const pdf = await generateStyledPdf({
    title: "First Movers x VisionClaw",
    subtitle: "Investor & Partnership Pitch — Fully Narrated",
    companyLines: [
      "[Your Company]  |  Robert Washburn, Founder",
      "agenticcorporation.net  |  huskyauto@gmail.com",
      "Presentation date: April 28, 2026",
    ],
    coverStats: [
      { label: "Specialist agents", value: "16" },
      { label: "Connected tools", value: "251" },
      { label: "Model routes", value: "36 + 1,000" },
      { label: "Production tables", value: "138" },
      { label: "Governance rules", value: "40" },
      { label: "Critical findings", value: "0" },
    ],
    sections,
    footerLines: [
      "Confidential — for First Movers leadership only.",
      "Robert Washburn  |  huskyauto@gmail.com  |  agenticcorporation.net",
    ],
    orientation: "landscape",
    fileName: "VisionClaw-FirstMovers-Investor-Pitch.pdf",
    folderLabel: "investor-pitches",
    uploadToDrive: true,
  });

  console.log("[deck] PDF generated:", JSON.stringify({ size: pdf.size, fileId: pdf.fileId }));

  if (!pdf.success || !pdf.localPath) {
    console.error("[deck] PDF generation failed");
    process.exit(1);
  }

  console.log("[deck] delivering to huskyauto@gmail.com...");
  const delivery = await deliverDigitalProduct({
    customerName: "Robert Washburn",
    customerEmail: "huskyauto@gmail.com",
    productName: "First Movers x VisionClaw — Narrated Investor Pitch Deck",
    filePath: pdf.localPath,
    fileName: "VisionClaw-FirstMovers-Investor-Pitch.pdf",
    mimeType: "application/pdf",
    sendEmail: true,
  });

  console.log(
    "[deck] DELIVERY_RESULT:",
    JSON.stringify(
      {
        success: delivery.success,
        deliveryId: delivery.deliveryId,
        downloadLink: delivery.downloadLink,
        shareableLink: delivery.shareableLink,
        emailSent: delivery.emailSent,
        linkVerified: delivery.linkVerified,
      },
      null,
      2
    )
  );
  process.exit(delivery.success ? 0 : 1);
})();
