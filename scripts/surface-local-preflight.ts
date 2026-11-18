import http from "node:http";
import { createHash } from "node:crypto";
import { legionBackgroundEnabled, legionProduction, legionPool, legionProxyPort } from "../server/legion/runtime";
import { surfaceRequest } from "../server/legion/surface-client";
import { SURFACE_MODEL } from "../server/legion/local-router";

/** Explicit operator-only synthetic probe. Importing this module is not supported.
 * No endpoint, model, prompt, tenant or credential arguments are accepted. */
async function main() {
  if (process.argv.slice(2).join(" ") !== "--surface-policy-confirmed" ||
      legionProduction() || !legionBackgroundEnabled()) {
    throw Error("Refused before network: original development workspace, existing background connection and --surface-policy-confirmed required");
  }
  const pool = legionPool();
  const held = await pool.connect();
  const abort = new AbortController();
  const lost = () => abort.abort();
  held.on("error", lost);
  let acquired = false;
  try {
    acquired = (await held.query("SELECT pg_try_advisory_lock(872631, 2) AS acquired")).rows[0]?.acquired === true;
    if (!acquired) throw Error("Local inference busy; no model dispatched");
    const catalog = await surfaceRequest(legionProxyPort(), "/v1/models", undefined, 5000, abort.signal);
    if (!Array.isArray(catalog.data) || !catalog.data.some(m => m?.id === SURFACE_MODEL)) {
      throw Error("Surface expected model absent");
    }
    console.log(JSON.stringify({ step: "catalog", provider: "surface-local", expectedModelPresent: true }));
    const start = Date.now();
    console.log(JSON.stringify({ step: "production-shape-generation", status: "starting" }));
    const response = await surfaceRequest(legionProxyPort(), "/v1/chat/completions", {
      model: SURFACE_MODEL, stream: true, temperature: 0,
      messages: [{ role: "system", content: "Return only the exact JSON requested. No explanations or tools." },
        { role: "user", content: 'Fictional test, no real records: return exactly {"concepts":[]}.' }],
    }, 90_000, abort.signal);
    // Record even a semantically rejected returned completion, never its content.
    const usage = response.usage;
    const reported = Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 &&
      Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0;
    const { recordCost } = await import("../server/agentic/cost-ledger");
    let accountingTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const recorded = await Promise.race([recordCost({ tenantId: 1, toolName: "llm.surface-local",
        model: `surface-local:${SURFACE_MODEL}`, tokensIn: reported ? usage.prompt_tokens : 0,
        tokensOut: reported ? usage.completion_tokens : 0, costUsd: 0,
        operation: reported ? "synthetic-preflight" : "synthetic-preflight:usage-unreported" }),
        new Promise<never>((_, reject) => {
          accountingTimer = setTimeout(() => reject(Error("Accounting deadline")), 10_000);
        })]);
      if (recorded !== true) console.warn("[surface-preflight] usage persistence uncertain; do not repeat inference for accounting");
    } catch { console.warn("[surface-preflight] usage persistence uncertain; do not repeat inference for accounting"); }
    finally { if (accountingTimer) clearTimeout(accountingTimer); }
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || JSON.stringify(JSON.parse(content)) !== '{"concepts":[]}') {
      throw Error("Surface synthetic JSON contract failed; no automatic retry");
    }
    console.log(JSON.stringify({ step: "production-shape-generation", provider: "surface-local",
      model: SURFACE_MODEL, latencyMs: Date.now() - start, stream: true, maxTokensOmitted: true,
      contentSha256: createHash("sha256").update(content).digest("hex"),
      usageReported: reported, inferenceCostUsd: 0, hostedFallback: false }));
    // Fixed negative destinations only. Failed dials are observations, not proof
    // of a deny rule; an unavailable listener can also fail.
    for (const destination of ["100.94.89.78:22", "100.94.89.78:443",
      "100.94.89.78:11434", "100.64.0.1:11434"]) {
      if (await reachable(destination)) throw Error("Negative network check unexpectedly connected; inspect Tailscale policy");
      console.log(JSON.stringify({ step: "negative-dial", destination, connected: false, isolationCertified: false }));
    }
    console.log("[surface-preflight] development checks passed; Surface flag remains unchanged; production/restart acceptance still pending");
  } finally {
    held.removeListener("error", lost);
    if (acquired) {
      try { await held.query("SELECT pg_advisory_unlock(872631, 2)"); held.release(); }
      catch { held.release(true); }
    } else held.release();
    await pool.end();
  }
}

function reachable(destination: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = http.request({ host: "127.0.0.1", port: legionProxyPort(), method: "CONNECT",
      path: destination, headers: { Host: destination } });
    let settled = false;
    const timer = setTimeout(() => finish(false), 2500);
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(value);
    };
    request.once("connect", (response, socket) => { socket.destroy(); finish(response.statusCode === 200); });
    request.once("response", response => { response.resume(); finish(false); });
    request.once("error", () => finish(false));
    request.end();
  });
}
main().then(() => process.exit(0)).catch(() => {
  // Do not print raw provider/DB/daemon errors or any environment values.
  console.error("[surface-preflight] failed or refused; no activation, hosted fallback or automatic retry");
  process.exit(1);
});
