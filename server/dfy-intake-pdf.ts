/**
 * Printable (paper) version of the DFY intake questionnaire.
 *
 * For customers who aren't comfortable filling out an online form: the admin
 * prints this PDF, the customer writes their answers by hand, and the admin
 * types them into the same intake form afterwards (the "Enter answers" button
 * on the Website Audit page → Step 3). From there the fix-kit generation flow
 * is identical to an online submission.
 *
 * Rendered from the SAME shared field catalog as the online form
 * (shared/dfy-intake-fields.ts), so paper and web never drift apart.
 * PDF conversion uses the platform's standard Browserless endpoint
 * (see .agents/skills/browserless-pdf — production-sfo, never chrome.*).
 */

import { DFY_INTAKE_SECTIONS } from "@shared/dfy-intake-fields";
import type { DfyIntakeForm } from "@shared/schema";

const BROWSERLESS_TIMEOUT_MS = 60_000;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One ruled write-in line. */
function line(): string {
  return `<div class="line"></div>`;
}

export function buildDfyIntakeQuestionnaireHtml(form?: Pick<DfyIntakeForm, "company" | "website" | "customerName"> | null): string {
  const forWhom = form
    ? `<div class="for-block">Prepared for: <strong>${esc(form.company)}</strong>${form.customerName ? ` — ${esc(form.customerName)}` : ""}<br/>Website: ${esc(form.website)}</div>`
    : `<div class="for-block">Business: <span class="inline-line"></span><br/>Website: <span class="inline-line"></span></div>`;

  const sectionsHtml = DFY_INTAKE_SECTIONS.map((section) => {
    const fields = section.fields.map((f) => {
      // Multiline questions get a generous ruled answer box; short ones get 1-2 lines.
      const lines = f.multiline ? 6 : 2;
      return `
        <div class="q">
          <div class="q-label">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</div>
          ${f.hint ? `<div class="q-hint">${esc(f.hint)}</div>` : ""}
          ${f.placeholder ? `<div class="q-hint">Example: ${esc(f.placeholder).replace(/\n/g, " · ")}</div>` : ""}
          <div class="answer">${Array.from({ length: lines }, line).join("")}</div>
        </div>`;
    }).join("");
    return `
      <div class="section">
        <h2>${esc(section.title)}</h2>
        ${section.description ? `<p class="section-desc">${esc(section.description)}</p>` : ""}
        ${fields}
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AI Setup Questionnaire</title>
<style>
  @page { size: letter portrait; margin: 0.65in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; font-size: 12pt; line-height: 1.4; }
  .header { border-bottom: 3px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 6px; }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .tagline { font-size: 10.5pt; color: #444; margin: 0; }
  .for-block { margin: 14px 0 4px; font-size: 11pt; line-height: 1.9; }
  .inline-line { display: inline-block; width: 4in; border-bottom: 1px solid #888; }
  .intro { font-size: 10.5pt; color: #333; background: #f3f3f3; border-left: 4px solid #999; padding: 8px 12px; margin: 12px 0 4px; }
  .section { margin-top: 22px; }
  .section h2 { page-break-after: avoid; }
  .section h2 { font-size: 13.5pt; border-bottom: 1.5px solid #333; padding-bottom: 3px; margin: 0 0 4px; }
  .section-desc { font-size: 10pt; color: #555; margin: 2px 0 8px; }
  .q { margin: 12px 0 14px; page-break-inside: avoid; }
  .q-label { font-weight: bold; font-size: 11pt; }
  .req { color: #b00020; }
  .q-hint { font-size: 9.5pt; color: #666; font-style: italic; margin-top: 1px; }
  .answer { margin-top: 6px; }
  .line { border-bottom: 1px solid #999; height: 0.32in; }
  .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #999; font-size: 9.5pt; color: #555; }
</style></head><body>
  <div class="header">
    <h1>AI Setup Questionnaire</h1>
    <p class="tagline">Done-For-You Website AI-Readiness Package — please answer in print. Questions marked <span class="req">*</span> are required.</p>
  </div>
  ${forWhom}
  <div class="intro">
    Your answers are used to build your website's AI-readiness files with accurate, real information —
    the more complete your answers, the better the result. This takes about 10–15 minutes.
    If a question doesn't apply to your business, write "N/A".
  </div>
  ${sectionsHtml}
  <div class="footer">
    When you're done, return this form to your service provider. Your information is only used to
    prepare your AI-readiness deliverables and is never shared.
  </div>
</body></html>`;
}

/** Render the questionnaire HTML to a PDF buffer via Browserless (portrait letter). */
export async function renderDfyIntakeQuestionnairePdf(form?: Pick<DfyIntakeForm, "company" | "website" | "customerName"> | null): Promise<{ ok: true; buf: Buffer } | { ok: false; error: string }> {
  const key = process.env.BROWSERLESS_API_KEY;
  if (!key) return { ok: false, error: "PDF service is not configured (BROWSERLESS_API_KEY missing)." };
  const html = buildDfyIntakeQuestionnaireHtml(form);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BROWSERLESS_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://production-sfo.browserless.io/pdf?token=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal as any,
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          landscape: false,
          printBackground: true,
          margin: { top: "0.65in", bottom: "0.65in", left: "0.65in", right: "0.65in" },
        },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[dfy-intake-pdf] Browserless failed: ${resp.status} ${errText.slice(0, 200)}`);
      return { ok: false, error: `PDF conversion failed (${resp.status}).` };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1000 || buf.subarray(0, 5).toString() !== "%PDF-") {
      return { ok: false, error: "PDF conversion returned invalid output." };
    }
    return { ok: true, buf };
  } catch (err: any) {
    return { ok: false, error: err?.name === "AbortError" ? "PDF conversion timed out." : (err?.message || "PDF conversion failed.") };
  } finally {
    clearTimeout(timer);
  }
}
