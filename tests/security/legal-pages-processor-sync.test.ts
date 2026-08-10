/**
 * Legal-pages processor sync gate (Task: catch legal-page drift).
 *
 * Enforces the Legal-pages sync rule (replit.md, 2026-08-02): every third-party
 * processor the platform actually uses — payment SDKs, AI-provider SDKs, and
 * communication/integration SDKs detected in package.json (dependencies AND
 * devDependencies) — must be named in client/src/pages/privacy.tsx. Payment
 * processors must additionally appear in client/src/pages/terms.tsx.
 *
 * Drift detection is FAIL-CLOSED registry-driven:
 *  - EVERY production dependency in package.json must be classified: either it
 *    maps to a disclosed processor via KNOWN_SDKS, or it is explicitly listed
 *    in INTERNAL_DEPS as a non-processor library. A brand-new SDK of ANY kind
 *    (dropbox, @slack/web-api, twilio, …) matches neither and fails the suite
 *    until a reviewer classifies it — that is the "new processor shipped
 *    silently" case, closed without relying on a name-prefix taxonomy.
 *  - CATEGORY_PREFIXES is a supplemental guard: a categorized payment/AI/
 *    communication SDK can never be waved through as "internal".
 *  - Processors with no npm SDK footprint (accessed via HTTP APIs or Replit
 *    integrations, e.g. xAI, OpenRouter, ElevenLabs, Coinbase Commerce) are
 *    pinned in NON_SDK_PROCESSORS so they can never be dropped from the pages.
 *
 * Pure static text scan: no DB, no server imports (keeps the pg pool closed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const SYNC_RULE_MSG =
  "Legal-pages sync rule (replit.md, 2026-08-02): when a new payment processor, " +
  "AI provider, or third-party integration ships, /privacy and /terms must be " +
  "updated to enumerate it. Disclose the processor on the legal pages, then " +
  "register its SDK in KNOWN_SDKS (or NON_SDK_PROCESSORS) in this test.";

// ---------------------------------------------------------------------------
// SDK registry: package prefix → processor disclosure requirement.
// A prefix ending in "/" matches any package in that scope; otherwise it
// matches the exact name or "<prefix>-*".
// ---------------------------------------------------------------------------

interface SdkEntry {
  /** Processor name that must literally appear in privacy.tsx. */
  name: string;
  /** Alternate spellings that also satisfy the mention requirement. */
  aliases?: string[];
  /** Payment processors must also appear in terms.tsx. */
  payment?: boolean;
  /** Internal/infra SDK — no third-party processor disclosure required. */
  exempt?: boolean;
}

const KNOWN_SDKS: Record<string, SdkEntry> = {
  // Payments
  stripe: { name: "Stripe", payment: true },
  "@stripe/": { name: "Stripe", payment: true },
  "stripe-replit-sync": { name: "Stripe", payment: true },
  coinbase: { name: "Coinbase Commerce", aliases: ["Coinbase"], payment: true },
  "@coinbase/": { name: "Coinbase Commerce", aliases: ["Coinbase"], payment: true },
  // AI providers
  openai: { name: "OpenAI" },
  "@anthropic-ai/": { name: "Anthropic" },
  "@google/": { name: "Google" },
  googleapis: { name: "Google" },
  // Account integrations
  "@microsoft/": { name: "Microsoft" },
  // Communication / messaging channels
  agentmail: { name: "AgentMail" },
  "discord.js": { name: "Discord" },
  grammy: { name: "Telegram" },
  "@whiskeysockets/": { name: "WhatsApp" }, // baileys
  "twitter-api-v2": { name: "X (Twitter)", aliases: ["X (Twitter)", "Twitter"] },
  // Infra / hosting (not third-party data processors of user content beyond
  // hosting, disclosed as Replit)
  "@replit/": { name: "Replit" },
};

// ---------------------------------------------------------------------------
// INTERNAL_DEPS: production dependencies explicitly reviewed as NOT third-party
// data processors (frameworks, parsers, utilities, self-hosted libs). Adding a
// new production dependency requires classifying it here OR in KNOWN_SDKS —
// the classification gate below fails closed on anything unclassified.
// ---------------------------------------------------------------------------

const INTERNAL_DEPS = new Set<string>([
  "@jridgewell/trace-mapping", "@modelcontextprotocol/sdk", "@mozilla/readability",
  "@playwright/test", "adm-zip", "cheerio", "commander", "connect-pg-simple",
  "cron-parser", "date-fns", "defuddle", "diff", "docx", "dompurify",
  "drizzle-orm", "drizzle-zod", "esbuild", "exceljs", "express",
  "express-rate-limit", "express-session", "ffmpeg-static", "ffprobe-static",
  "graphology", "graphology-communities-louvain", "graphology-pagerank",
  "graphology-types", "header-generator", "helmet", "js-yaml", "jsdom",
  "magika", "mammoth", "memoizee", "memorystore", "minimatch", "multer",
  "openid-client", "p-limit", "p-retry", "passport", "passport-local",
  "pdf-lib", "pdf-parse", "pdfkit", "pg", "puppeteer-core", "qrcode", "rollup",
  "sharp", "tsx", "ws", "zod", "zod-validation-error",
]);

function isTypesPackage(dep: string): boolean {
  return dep.startsWith("@types/");
}

// Processors in active use with no npm SDK footprint (HTTP APIs / Replit
// integrations). These can never silently drop off the legal pages.
const NON_SDK_PROCESSORS: SdkEntry[] = [
  { name: "xAI" },
  { name: "OpenRouter" },
  { name: "ElevenLabs" },
  { name: "Replit" },
];

// ---------------------------------------------------------------------------
// Category prefix lists: any installed dep matching these MUST have a
// KNOWN_SDKS entry. This is what makes a silently-shipped new processor fail
// CI without a manual allowlist edit.
// ---------------------------------------------------------------------------

const CATEGORY_PREFIXES: Record<string, string[]> = {
  payment: [
    "stripe", "@stripe/", "stripe-replit-sync", "coinbase", "@coinbase/",
    "@paypal/", "paypal", "braintree", "square", "@square/", "razorpay",
    "@adyen/", "adyen", "@lemonsqueezy/", "paddle", "@paddle/", "shopify",
    "@shopify/",
  ],
  ai: [
    "openai", "@openai/", "@anthropic-ai/", "@google/", "@google-cloud/",
    "groq-sdk", "@mistralai/", "cohere-ai", "@cohere-ai/", "replicate",
    "together-ai", "@xai-org/", "@openrouter/", "ollama", "@huggingface/",
    "@aws-sdk/client-bedrock", "@azure/openai", "elevenlabs", "@elevenlabs/",
    "@deepgram/", "assemblyai",
  ],
  communication: [
    "agentmail", "discord.js", "@discordjs/", "grammy", "telegraf",
    "node-telegram-bot-api", "@whiskeysockets/", "whatsapp-web.js",
    "twitter-api-v2", "@slack/", "twilio", "@sendgrid/", "nodemailer",
    "mailgun", "mailgun.js", "postmark", "resend", "@resend/",
    "@microsoft/microsoft-graph-client", "googleapis",
  ],
};

function matchesPrefix(dep: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return dep.startsWith(prefix);
  return dep === prefix || dep.startsWith(prefix + "-");
}

function stripComments(src: string): string {
  // Static-guard rule: strip comments first so a processor named only in a
  // comment doesn't satisfy (or trip) the gate.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const privacySrc = stripComments(read("client/src/pages/privacy.tsx")).toLowerCase();
const termsSrc = stripComments(read("client/src/pages/terms.tsx")).toLowerCase();

const pkg = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const depNames = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
];

function mentioned(src: string, entry: SdkEntry): boolean {
  const names = [entry.name, ...(entry.aliases ?? [])];
  return names.some((n) => src.includes(n.toLowerCase()));
}

function lookupSdk(dep: string): SdkEntry | undefined {
  for (const [prefix, entry] of Object.entries(KNOWN_SDKS)) {
    if (matchesPrefix(dep, prefix)) return entry;
  }
  return undefined;
}

// Exported for the negative regression tests below.
export function findUnregisteredCategorizedDeps(deps: string[]): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    const categorized = Object.values(CATEGORY_PREFIXES).some((prefixes) =>
      prefixes.some((p) => matchesPrefix(dep, p)),
    );
    if (categorized && !lookupSdk(dep)) out.push(dep);
  }
  return out;
}

/**
 * Fail-closed classification: every production dep must be a known processor
 * SDK, an explicitly reviewed internal lib, or a @types/ shim. Anything else
 * (dropbox, @slack/web-api, twilio, any future connector) is unclassified.
 */
export function findUnclassifiedProductionDeps(deps: string[]): string[] {
  return deps.filter(
    (dep) => !isTypesPackage(dep) && !lookupSdk(dep) && !INTERNAL_DEPS.has(dep),
  );
}

/** Supplemental guard: a categorized SDK can never be waved through as internal. */
export function findMisclassifiedInternalDeps(): string[] {
  return [...INTERNAL_DEPS].filter(
    (dep) =>
      Object.values(CATEGORY_PREFIXES).some((prefixes) =>
        prefixes.some((p) => matchesPrefix(dep, p)),
      ) || lookupSdk(dep) !== undefined,
  );
}

export function findUndisclosedProcessors(deps: string[], src: string): string[] {
  const missing = new Set<string>();
  for (const dep of deps) {
    const entry = lookupSdk(dep);
    if (entry && !entry.exempt && !mentioned(src, entry)) missing.add(entry.name);
  }
  return [...missing];
}

test("every installed processor SDK's processor is disclosed in privacy.tsx", () => {
  const missing = findUndisclosedProcessors(depNames, privacySrc);
  assert.deepEqual(
    missing,
    [],
    `Installed processor SDKs whose processor is NOT disclosed in client/src/pages/privacy.tsx: ${missing.join(", ")}. ${SYNC_RULE_MSG}`,
  );
});

test("every production dependency is classified (fail-closed new-integration gate)", () => {
  const prodDeps = Object.keys(pkg.dependencies ?? {});
  const unclassified = findUnclassifiedProductionDeps(prodDeps);
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified production dependencies: ${unclassified.join(", ")}. Every production dep ` +
      `must be registered in KNOWN_SDKS (third-party processor — disclose it on the legal ` +
      `pages) or INTERNAL_DEPS (reviewed non-processor library). ${SYNC_RULE_MSG}`,
  );
});

test("INTERNAL_DEPS contains no categorized or known processor SDKs", () => {
  const misclassified = findMisclassifiedInternalDeps();
  assert.deepEqual(
    misclassified,
    [],
    `These INTERNAL_DEPS entries look like processor SDKs and must be moved to KNOWN_SDKS ` +
      `with a legal-pages disclosure: ${misclassified.join(", ")}. ${SYNC_RULE_MSG}`,
  );
});

test("every categorized processor SDK is registered in KNOWN_SDKS (new-processor drift gate)", () => {
  const unregistered = findUnregisteredCategorizedDeps(depNames);
  assert.deepEqual(
    unregistered,
    [],
    `package.json contains payment/AI/communication SDKs with no KNOWN_SDKS entry: ${unregistered.join(", ")}. ` +
      `A new processor appears to have shipped without a legal-pages update. ${SYNC_RULE_MSG}`,
  );
});

test("non-SDK processors (HTTP-API / Replit-integration providers) are disclosed in privacy.tsx", () => {
  const missing = NON_SDK_PROCESSORS.filter((p) => !mentioned(privacySrc, p)).map((p) => p.name);
  assert.deepEqual(
    missing,
    [],
    `Non-SDK processors missing from client/src/pages/privacy.tsx: ${missing.join(", ")}. ${SYNC_RULE_MSG}`,
  );
});

test("payment processors are disclosed in terms.tsx billing terms", () => {
  const paymentEntries = new Map<string, SdkEntry>();
  for (const dep of depNames) {
    const entry = lookupSdk(dep);
    if (entry?.payment) paymentEntries.set(entry.name, entry);
  }
  // Coinbase Commerce is API-key based (no npm SDK) — always required.
  paymentEntries.set("Coinbase Commerce", {
    name: "Coinbase Commerce",
    aliases: ["Coinbase"],
    payment: true,
  });
  const missing = [...paymentEntries.values()]
    .filter((e) => !mentioned(termsSrc, e))
    .map((e) => e.name);
  assert.deepEqual(
    missing,
    [],
    `Payment processors missing from client/src/pages/terms.tsx: ${missing.join(", ")}. ${SYNC_RULE_MSG}`,
  );
});

// ---------------------------------------------------------------------------
// Regression cases: prove the gate actually FAILS on drift (an unknown
// categorized SDK, and a known SDK whose processor is not disclosed).
// ---------------------------------------------------------------------------

test("regression: an unknown payment SDK is detected as unregistered", () => {
  const unregistered = findUnregisteredCategorizedDeps([...depNames, "@paypal/checkout-server-sdk"]);
  assert.ok(
    unregistered.includes("@paypal/checkout-server-sdk"),
    "gate failed to flag a hypothetical new payment SDK — drift detection is broken",
  );
});

test("regression: an unknown messaging SDK is detected as unregistered", () => {
  const unregistered = findUnregisteredCategorizedDeps([...depNames, "@slack/web-api"]);
  assert.ok(
    unregistered.includes("@slack/web-api"),
    "gate failed to flag a hypothetical new messaging SDK — drift detection is broken",
  );
});

test("regression: a Dropbox-class connected-account SDK is caught as unclassified", () => {
  for (const newDep of ["dropbox", "@slack/web-api", "twilio", "@notionhq/client"]) {
    const unclassified = findUnclassifiedProductionDeps([
      ...Object.keys(pkg.dependencies ?? {}),
      newDep,
    ]);
    assert.ok(
      unclassified.includes(newDep),
      `gate failed to flag hypothetical new integration SDK "${newDep}" — fail-closed classification is broken`,
    );
  }
});

test("regression: a known SDK with an undisclosed processor is detected", () => {
  const missing = findUndisclosedProcessors(["discord.js"], "no processors named here");
  assert.deepEqual(
    missing,
    ["Discord"],
    "gate failed to flag a known SDK whose processor is absent from the page text",
  );
});
