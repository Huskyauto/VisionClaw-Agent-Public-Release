// R98.12 — Felix Deliverable Reliability Plan W5: HTML app builder.
// Generates a single-file index.html (embedded CSS+JS) for small downloadable
// utilities (password generators, calculators, converters, timers, todo apps).
// Smoke-tests the output with jsdom before declaring success — catches the
// silent-broken-app failure mode where the LLM emits HTML that parses but the
// JS throws on first user interaction.
//
// Lives under project-assets/html-apps/<slug>-<timestamp>/index.html so the
// deliverable-verifier path-jail accepts it (project-assets is on the
// ALLOWED_FILE_ROOTS list in deliverable-verifier.ts).

import * as fs from "fs";
import * as path from "path";
import { runLlmTask } from "./llm-task";
import { logSilentCatch } from "./lib/silent-catch";

const WORKSPACE_ROOT = path.resolve(process.cwd());
const HTML_APPS_ROOT = path.resolve(WORKSPACE_ROOT, "project-assets", "html-apps");

export interface BuildHtmlAppInput {
  tenantId: number;
  topic: string;                       // "password generator", "tip calculator"
  description?: string;                // user's natural-language brief
  features?: string[];                 // bullet list of must-have features
  app_type?: string;                   // hint: "calculator" | "generator" | "converter" | "timer" | "todo" | "form" | "game" | "dashboard" | "other"
  style_notes?: string;                // visual direction
  smoke_assertion?: HtmlSmokeAssertion; // R98.14 +sec-2 — STRUCTURED ONLY. Free-form JS expressions are REJECTED (eval sink). See HtmlSmokeAssertion.
  model?: string;
  timeoutMs?: number;
}

export interface BuildHtmlAppResult {
  success: boolean;
  filePath?: string;                   // absolute path on disk
  relativePath?: string;               // relative to workspace root for emails/registration
  fileName?: string;
  bytes?: number;
  smokePassed?: boolean;
  smokeFailures?: string[];
  smokeWarnings?: string[];
  title?: string;
  error?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "html-app";
}

function extractHtml(raw: string): string {
  // Strip code fences if present, prefer the largest <!doctype html>...</html> block.
  let s = raw.trim();
  const fence = s.match(/```(?:html?)?\s*\n([\s\S]*?)\n```/i);
  if (fence) s = fence[1].trim();
  const doctypeIdx = s.toLowerCase().indexOf("<!doctype html");
  const htmlOpen = s.toLowerCase().indexOf("<html");
  const start = doctypeIdx >= 0 ? doctypeIdx : (htmlOpen >= 0 ? htmlOpen : 0);
  const closeIdx = s.toLowerCase().lastIndexOf("</html>");
  if (closeIdx > start) s = s.slice(start, closeIdx + 7);
  else if (start > 0) s = s.slice(start);
  return s.trim();
}

// R98.14 +sec-2 — STRUCTURED smoke-assertion DSL (replaces free-form JS eval).
// All checks are evaluated against the parsed jsdom Document using DOM read
// APIs only. No eval, no Function ctor, no script execution.
//
// Schema:
//   {
//     selectors_exist?: string[],                       // each must match ≥1 element
//     selectors_absent?: string[],                      // each must match 0 elements
//     text_includes?: { selector?: string, text: string }[],   // selector defaults to body
//     min_count?: { selector: string, min: number }[],         // querySelectorAll(s).length ≥ min
//     attr_equals?: { selector: string, attr: string, value: string }[],
//     title_includes?: string,
//   }
export interface HtmlSmokeAssertion {
  selectors_exist?: string[];
  selectors_absent?: string[];
  text_includes?: { selector?: string; text: string }[];
  min_count?: { selector: string; min: number }[];
  attr_equals?: { selector: string; attr: string; value: string }[];
  title_includes?: string;
}

// Strict CSS-selector allowlist — only printable ASCII characters used in real
// selectors (alphanumerics, #, ., -, _, [, ], =, ", ', :, (, ), >, +, ~, *,
// space, comma). Refuses anything that looks like injection (`<`, `;`, etc.).
const SAFE_SELECTOR_RE = /^[A-Za-z0-9_\-#.\[\]="':()>+~*,\s]{1,300}$/;
function assertSafeSelector(s: string, label: string): void {
  if (typeof s !== "string" || !SAFE_SELECTOR_RE.test(s)) throw new Error(`${label}: selector contains disallowed characters or is too long`);
}
function assertSafeText(s: string, label: string, max = 500): void {
  if (typeof s !== "string" || s.length === 0 || s.length > max) throw new Error(`${label}: text must be 1-${max} chars`);
}
function assertSafeAttr(s: string, label: string): void {
  if (typeof s !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]{0,40}$/.test(s)) throw new Error(`${label}: attribute name must be a-z/0-9/- and ≤40 chars`);
}

function evaluateStructuredSmokeAssertion(doc: any, a: any): string[] {
  const fails: string[] = [];
  // Reject legacy string form outright — anything that comes through as a
  // plain string is the old eval-form attempt. Refuse it loudly so the agent
  // gets a clear error and switches to the structured form.
  if (typeof a === "string") {
    fails.push(`legacy free-form smoke_assertion (string) is REJECTED in R98.14+sec-2 — pass a structured object instead. See build_html_app schema.`);
    return fails;
  }
  if (!a || typeof a !== "object") return fails;

  if (Array.isArray(a.selectors_exist)) {
    for (const sel of a.selectors_exist) {
      try { assertSafeSelector(sel, "selectors_exist"); } catch (e: any) { fails.push(e.message); continue; }
      try { if (!doc.querySelector(sel)) fails.push(`selectors_exist '${sel}' not found`); } catch (e: any) { fails.push(`selectors_exist '${sel}' invalid: ${e?.message}`); }
    }
  }
  if (Array.isArray(a.selectors_absent)) {
    for (const sel of a.selectors_absent) {
      try { assertSafeSelector(sel, "selectors_absent"); } catch (e: any) { fails.push(e.message); continue; }
      try { if (doc.querySelector(sel)) fails.push(`selectors_absent '${sel}' was found (should be absent)`); } catch (e: any) { fails.push(`selectors_absent '${sel}' invalid: ${e?.message}`); }
    }
  }
  if (Array.isArray(a.text_includes)) {
    for (const ti of a.text_includes) {
      const sel = ti?.selector || "body";
      try { assertSafeSelector(sel, "text_includes.selector"); assertSafeText(String(ti?.text || ""), "text_includes.text"); } catch (e: any) { fails.push(e.message); continue; }
      try {
        const el = doc.querySelector(sel);
        if (!el) { fails.push(`text_includes selector '${sel}' not found`); continue; }
        const t = String(el.textContent || "");
        if (!t.includes(String(ti.text))) fails.push(`text_includes: '${sel}' missing text '${String(ti.text).slice(0, 80)}'`);
      } catch (e: any) { fails.push(`text_includes '${sel}' invalid: ${e?.message}`); }
    }
  }
  if (Array.isArray(a.min_count)) {
    for (const mc of a.min_count) {
      const sel = mc?.selector;
      const min = Number(mc?.min);
      if (!Number.isFinite(min) || min < 0 || min > 1000) { fails.push(`min_count.min must be 0-1000`); continue; }
      try { assertSafeSelector(sel, "min_count.selector"); } catch (e: any) { fails.push(e.message); continue; }
      try {
        const n = doc.querySelectorAll(sel).length;
        if (n < min) fails.push(`min_count: '${sel}' has ${n}, need ≥${min}`);
      } catch (e: any) { fails.push(`min_count '${sel}' invalid: ${e?.message}`); }
    }
  }
  if (Array.isArray(a.attr_equals)) {
    for (const ae of a.attr_equals) {
      try { assertSafeSelector(ae?.selector, "attr_equals.selector"); assertSafeAttr(ae?.attr, "attr_equals.attr"); assertSafeText(String(ae?.value || ""), "attr_equals.value", 200); } catch (e: any) { fails.push(e.message); continue; }
      try {
        const el = doc.querySelector(ae.selector);
        if (!el) { fails.push(`attr_equals selector '${ae.selector}' not found`); continue; }
        const v = el.getAttribute(ae.attr);
        if (v !== ae.value) fails.push(`attr_equals: '${ae.selector}'[${ae.attr}] = '${String(v).slice(0, 80)}', expected '${String(ae.value).slice(0, 80)}'`);
      } catch (e: any) { fails.push(`attr_equals '${ae?.selector}' invalid: ${e?.message}`); }
    }
  }
  if (typeof a.title_includes === "string") {
    try { assertSafeText(a.title_includes, "title_includes"); } catch (e: any) { fails.push(e.message); }
    const tt = String(doc.title || "");
    if (!tt.includes(a.title_includes)) fails.push(`title_includes: title='${tt.slice(0, 80)}' missing '${a.title_includes.slice(0, 80)}'`);
  }
  return fails;
}

async function smokeTest(html: string, smokeAssertion?: HtmlSmokeAssertion | string): Promise<{ passed: boolean; failures: string[]; warnings: string[]; title?: string }> {
  const failures: string[] = [];
  const warnings: string[] = [];
  let title: string | undefined;
  // Architect MEDIUM #3 hardening — defense-in-depth before jsdom runs scripts:
  // (a) reject any external <script src=...> or <link rel=stylesheet href=...>
  //     before parse — single-file rule already requires inline-only, so an
  //     external ref is itself a HARD-REQUIREMENT-#1 violation (rejects the
  //     deliverable cleanly instead of letting jsdom potentially fetch it).
  // (b) JSDOM defaults to NOT fetching external resources unless `resources`
  //     is set; we rely on the default + explicit `url:'about:blank'` to keep
  //     the document origin opaque so any window.fetch attempt has no base URL
  //     to resolve against.
  if (/<script[^>]+src\s*=/i.test(html)) {
    failures.push("external <script src=...> found — single-file rule requires inline JS only");
  }
  if (/<link[^>]+rel\s*=\s*["']?stylesheet/i.test(html) && /<link[^>]+href\s*=\s*["']?https?:/i.test(html)) {
    failures.push("external <link rel=stylesheet href=https://...> found — single-file rule requires inline CSS only");
  }
  if (failures.length > 0) return { passed: false, failures, warnings, title };
  try {
    const { JSDOM, VirtualConsole } = (await import("jsdom" as any)) as any;
    const vc = new VirtualConsole();
    const consoleErrors: string[] = [];
    vc.on("jsdomError", (e: any) => { consoleErrors.push(String(e?.message || e).slice(0, 300)); });
    // R110 +sec gold-pass-3 — runScripts:"dangerously" REMOVED. Executing
    // LLM-authored JavaScript inside the server process is a remote-code
    // execution sink (LLM can be prompt-injected by upstream input).
    // We now do static DOM-structure validation only: parse the HTML,
    // walk the resulting tree, and check structural invariants. Smoke
    // testing actual <script> behavior is the user's responsibility in
    // their browser, where the same-origin / sandbox policies apply.
    const dom = new JSDOM(html, {
      runScripts: undefined,
      virtualConsole: vc,
      pretendToBeVisual: true,
      url: "about:blank",
    });
    // No script execution → no need to wait for DOMContentLoaded.
    const doc = dom.window.document;
    title = doc.title?.trim() || undefined;
    const bodyText = (doc.body?.textContent || "").trim();
    if (!doc.documentElement) failures.push("no <html> root after parse");
    if (!doc.body) failures.push("no <body> after parse");
    if (bodyText.length < 5 && !doc.querySelector("input, button, canvas, svg")) {
      failures.push("body has neither visible text nor any interactive element (likely broken render)");
    }
    if (consoleErrors.length > 0) {
      // Treat the first hard JS error as a failure; later ones as warnings.
      failures.push(`runtime JS error: ${consoleErrors[0]}`);
      for (const e of consoleErrors.slice(1, 3)) warnings.push(`additional JS error: ${e}`);
    }
    if (smokeAssertion) {
      // R98.14 +sec-2 — architect CRITICAL fix: smoke_assertion was previously
      // a free-form JS expression interpolated into `(function(){ return !!(${assertion}) })()`
      // and run via dom.window.eval(). Since the assertion ultimately came
      // from model output (and the model is influenced by customer prompts),
      // this was a code-execution sink — a crafted "topic" could cause Felix
      // to emit a smoke_assertion like `(globalThis.process.mainModule.require('child_process').exec('rm -rf .'),true)`
      // and the jsdom window's eval would happily run it. The fix: smoke_assertion
      // is now a STRUCTURED ASSERTION OBJECT (HtmlSmokeAssertion below) evaluated
      // by a tiny safe runner that uses ONLY DOM read APIs (querySelector /
      // querySelectorAll / textContent / getAttribute). NO eval, NO Function ctor,
      // NO arbitrary expression evaluation. Anything else is rejected up front.
      try {
        const aFails = evaluateStructuredSmokeAssertion(doc, smokeAssertion);
        for (const f of aFails) failures.push(`smoke_assertion: ${f}`);
      } catch (e: any) {
        failures.push(`smoke_assertion runner threw: ${e?.message || String(e)}`);
      }
    }
    try { dom.window.close(); } catch (_e) { logSilentCatch("server/html-app-builder.ts", _e); }
  } catch (e: any) {
    failures.push(`jsdom parse failed: ${e?.message || String(e)}`);
  }
  return { passed: failures.length === 0, failures, warnings, title };
}

export async function buildHtmlApp(input: BuildHtmlAppInput): Promise<BuildHtmlAppResult> {
  const topic = String(input.topic || "").trim();
  if (!topic) return { success: false, error: "topic is required" };
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) return { success: false, error: "tenantId is required" };

  const featureBullets = Array.isArray(input.features) && input.features.length > 0
    ? input.features.map((f) => `- ${String(f).slice(0, 200)}`).join("\n")
    : "- (no extra features specified — pick the obvious essentials yourself)";
  const appType = (input.app_type || "other").toLowerCase();
  const style = (input.style_notes || "Clean modern minimalist. System font stack. Generous whitespace. Mobile-friendly. Subtle shadows. No external CDN — all CSS and JS inline.").slice(0, 600);

  const prompt = `You are a senior frontend engineer. Generate ONE complete, self-contained, working single-file HTML application.

TOPIC: ${topic}
APP TYPE HINT: ${appType}
USER BRIEF: ${(input.description || "").slice(0, 1500) || "(none — infer from topic)"}
MUST-HAVE FEATURES:
${featureBullets}
VISUAL DIRECTION: ${style}

HARD REQUIREMENTS — fail any of these and the deliverable is rejected:
1. EXACTLY ONE FILE: a single <!DOCTYPE html>...</html> document with all CSS in <style> and all JS in <script>. Zero external <link>, <img src=http...>, or <script src=...> references — fully offline-runnable.
2. The app MUST work the moment the file is double-clicked — no build step, no server, no npm.
3. The app MUST do what the topic says, end-to-end. If "password generator" → it generates passwords on a button click and shows them in an output element. If "tip calculator" → entering bill + tip% updates the total live. No placeholder TODOs.
4. Include a clear page <title>, a visible <h1>, and meaningful labels on every input/button.
5. Wrap all event listeners in DOMContentLoaded or place the <script> at end of <body>.
6. Do not use document.write, eval, or alert (alert is fine for confirms only — never for primary output).
7. Mobile-friendly viewport meta tag included.
8. Output ONLY the raw HTML document — no markdown fences, no commentary before or after.`;

  // R98.25 — switched from runLlmTask (JSON-mode, returns {json}) to
  // runLlmTextTask. The previous wiring forced response_format=json_object
  // on a prompt that explicitly asks for raw HTML, then read .output/.text
  // from a result that only had .json — every call returned "LLM returned
  // empty output", which is what froze the html_app golden paths.
  const { runLlmTextTask } = await import("./llm-task");
  // R105.2 — wiring-invariants flagged 25% fail rate (11/44 over 7d) on
  // build_html_app, dominated by transient `Request was aborted` errors. Add
  // bounded retry with exponential backoff for those specific transients.
  // Non-transient failures (rate limits, prompt rejections, real errors) bail
  // immediately to avoid wasting LLM spend.
  function isTransientLlmError(msg: string): boolean {
    const m = (msg || "").toLowerCase();
    return m.includes("aborted") || m.includes("timeout") || m.includes("timed out") || m.includes("econnreset") || m.includes("socket hang up") || m.includes("fetch failed");
  }
  let llmRes: any;
  let lastErr = "";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      llmRes = await runLlmTextTask({
        tenantId: input.tenantId,
        prompt,
        model: input.model || "claude-sonnet-4-5",
        timeoutMs: input.timeoutMs || 180000,
        maxTokens: 16000,
        temperature: 0.4,
      });
      if (llmRes.success) { lastErr = ""; break; }
      lastErr = String(llmRes.error || "unknown");
      if (!isTransientLlmError(lastErr) || attempt === maxAttempts) break;
    } catch (e: any) {
      lastErr = e?.message || String(e);
      if (!isTransientLlmError(lastErr) || attempt === maxAttempts) {
        return { success: false, error: `LLM call failed (attempt ${attempt}/${maxAttempts}): ${lastErr}` };
      }
    }
    await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s backoff
  }
  if (lastErr) return { success: false, error: `LLM call failed after ${maxAttempts} attempts: ${lastErr}` };
  const raw = String(llmRes.text || "").trim();
  if (!raw) return { success: false, error: "LLM returned empty output" };

  const html = extractHtml(raw);
  if (html.length < 200) return { success: false, error: `extracted HTML too small (${html.length} bytes) — model likely refused or returned a stub` };
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) return { success: false, error: "missing <html>...</html> wrapper after extraction" };

  // Smoke-test BEFORE writing to disk — refuse to deliver broken apps.
  const smoke = await smokeTest(html, input.smoke_assertion);
  if (!smoke.passed) {
    return {
      success: false,
      smokePassed: false,
      smokeFailures: smoke.failures,
      smokeWarnings: smoke.warnings,
      bytes: html.length,
      title: smoke.title,
      error: `HTML app failed smoke test: ${smoke.failures.join("; ")}`,
    };
  }

  // Write to project-assets/html-apps/<slug>-<ts>/index.html
  if (!fs.existsSync(HTML_APPS_ROOT)) fs.mkdirSync(HTML_APPS_ROOT, { recursive: true });
  const slug = slugify(topic);
  const ts = Date.now();
  const dirName = `${slug}-${ts}`;
  const dirPath = path.resolve(HTML_APPS_ROOT, dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  const filePath = path.resolve(dirPath, "index.html");
  fs.writeFileSync(filePath, html, "utf8");
  const stat = fs.statSync(filePath);

  return {
    success: true,
    filePath,
    relativePath: path.relative(WORKSPACE_ROOT, filePath),
    fileName: `${slug}.html`,
    bytes: stat.size,
    smokePassed: true,
    smokeFailures: [],
    smokeWarnings: smoke.warnings,
    title: smoke.title || topic,
  };
}
