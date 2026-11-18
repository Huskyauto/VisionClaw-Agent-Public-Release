import http from "node:http";

export const LEGION_ORIGIN = "http://100.73.84.100:11434";
// Tailscale parses policy tag names case-insensitively into lowercase.
// LocalAPI does not run the CLI's input normalization for us.
export const LEGION_TAG = "tag:visionclaw";

/** Private provider-only transport. No caller URL, redirects, ambient proxy,
 * credentials or general fetch/SSRF exception. Exactly four API paths. */
export function legionRequest(
  proxyPort: number,
  path: "/api/version" | "/api/tags" | "/v1/chat/completions" | "/v1/embeddings",
  body?: unknown,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  if (![10551, 10552].includes(proxyPort) ||
      !["/api/version", "/api/tags", "/v1/chat/completions", "/v1/embeddings"].includes(path)) {
    return Promise.reject(new Error("Legion transport destination refused"));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    return Promise.reject(new Error("Legion transport deadline refused"));
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload && Buffer.byteLength(payload) > 64_000) return Promise.reject(new Error("Legion request too large"));
  return new Promise((resolve, reject) => {
    let total = 0;
    const request = http.request({
      signal,
      host: "127.0.0.1", port: proxyPort, method: payload ? "POST" : "GET",
      path: LEGION_ORIGIN + path,
      headers: { Host: "100.73.84.100:11434", ...(payload ? {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload),
      } : {}) },
    });
    const timer = setTimeout(() => request.destroy(new Error("Legion wall-clock deadline")), timeoutMs);
    const finish = (error?: Error, value?: Record<string, any>) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    request.once("error", () => finish(new Error("Legion transport unavailable or deadline exceeded")));
    request.once("response", response => {
      const chunks: Buffer[] = [];
      response.on("error", () => finish(new Error("Legion response interrupted")));
      response.on("data", chunk => {
        total += chunk.length;
        if (total > 1024 * 1024) request.destroy(new Error("Legion response too large"));
        else chunks.push(Buffer.from(chunk));
      });
      response.once("end", () => {
        if (response.statusCode !== 200) return finish(new Error(`Legion HTTP ${response.statusCode}`));
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          finish(undefined, value);
        } catch { finish(new Error("Legion response is not a JSON object")); }
      });
    });
    request.end(payload);
  });
}
