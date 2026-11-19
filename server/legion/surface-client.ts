import { StringDecoder } from "node:string_decoder";
import http from "node:http";
import { SURFACE_MODEL, SurfaceModelUnavailable } from "./local-router";

/** Streaming output is untrusted data. No partial or truncated result passes. */
export class SurfaceStreamDecoder {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private content = "";
  private bytes = 0;
  private done = false;
  private stopped = false;
  private sawModel = false;
  private usage: unknown;

  push(chunk: Buffer) {
    this.bytes += chunk.length;
    if (this.bytes > 256 * 1024) throw Error("Surface response byte limit exceeded");
    this.pending += this.decoder.write(chunk);
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.pending))) {
      const event = this.pending.slice(0, boundary.index);
      this.pending = this.pending.slice(boundary.index + boundary[0].length);
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n");
      if (!data) continue; // SSE comments/keepalives do not reset the deadline.
      if (this.done) throw Error("Surface data after terminal event");
      if (data === "[DONE]") { this.done = true; continue; }
      const value = JSON.parse(data);
      if (!value || typeof value !== "object" || Array.isArray(value) || value.error) {
        throw Error("Surface invalid stream event");
      }
      if (value.model !== undefined) {
        if (value.model !== SURFACE_MODEL) throw Error("Surface model mismatch");
        this.sawModel = true;
      }
      if (value.usage !== undefined && value.usage !== null) this.usage = value.usage;
      if (!Array.isArray(value.choices) || value.choices.length > 1) throw Error("Surface invalid choices");
      for (const choice of value.choices) {
        if (choice.index !== 0 || !choice.delta || choice.delta.tool_calls?.length ||
            choice.delta.function_call || choice.delta.refusal ||
            (choice.finish_reason !== null && choice.finish_reason !== undefined && choice.finish_reason !== "stop")) {
          throw Error("Surface non-text or incomplete response");
        }
        if (choice.delta.content !== null && choice.delta.content !== undefined) {
          if (this.stopped || typeof choice.delta.content !== "string") throw Error("Surface invalid content");
          this.content += choice.delta.content;
          if (this.content.length > 12_000) throw Error("Surface output limit exceeded");
        }
        if (choice.finish_reason === "stop") this.stopped = true;
      }
    }
    if (this.pending.length > 32_768) throw Error("Surface stream event limit exceeded");
  }

  finish(): Record<string, any> {
    if (this.decoder.end() || this.pending.trim() || !this.done || !this.stopped ||
        !this.sawModel || !this.content.trim()) throw Error("Surface stream incomplete");
    return { model: SURFACE_MODEL, ...(this.usage === undefined ? {} : { usage: this.usage }),
      choices: [{ finish_reason: "stop", message: { content: this.content } }] };
  }
}

/** Test injection replaces HTTP only; destinations and parameter guards stay fixed.
 * This is provider-specific, not an exception to any tool's SSRF protection. */
export function createSurfaceTransport(send: typeof http.request = http.request) {
  return async (
    proxyPort: number, path: "/v1/models" | "/v1/chat/completions",
    body?: Record<string, any>, timeoutMs = 90_000, signal?: AbortSignal,
  ): Promise<Record<string, any>> => {
    if (![10551, 10552].includes(proxyPort) ||
        !["/v1/models", "/v1/chat/completions"].includes(path) ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) {
      throw Error("Surface transport destination/deadline refused");
    }
    if (path === "/v1/models" ? body !== undefined :
        !body || body.model !== SURFACE_MODEL || body.stream !== true || body.temperature !== 0 ||
        Object.keys(body).some(key => !["model", "stream", "temperature", "messages"].includes(key)) ||
        !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 4 ||
        body.messages.some((m: any) => !m || !["system", "user"].includes(m.role) ||
          typeof m.content !== "string" || Object.keys(m).some(k => !["role", "content"].includes(k))) ||
        body.messages.reduce((n: number, m: any) => n + m.content.length, 0) > 13_000) {
      throw Error("Surface request shape refused");
    }
    signal?.throwIfAborted();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload && Buffer.byteLength(payload) > 64_000) throw Error("Surface request too large");
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, value?: Record<string, any>) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      };
      const request = send({
        host: "127.0.0.1", port: proxyPort, signal,
        method: payload === undefined ? "GET" : "POST",
        path: "http://100.94.89.78:5273" + path,
        headers: { Host: "100.94.89.78:5273",
          Accept: payload === undefined ? "application/json" : "text/event-stream",
          ...(payload === undefined ? {} : { "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload) }) },
      });
      // One total deadline, including proxy dialing and keepalive-only streams.
      // There is deliberately no shorter first-token deadline.
      timer = setTimeout(() => {
        finish(Error("Surface wall-clock deadline exceeded"));
        request.destroy();
      }, timeoutMs);
      request.once("error", () => finish(Error("Surface transport unavailable or interrupted")));
      request.once("response", response => {
        if (response.statusCode !== 200) {
          const status = response.statusCode;
          if (payload && [400, 404, 503].includes(status || 0)) {
            let errorBody = "";
            response.on("data", chunk => {
              errorBody += chunk.toString("utf8");
              if (Buffer.byteLength(errorBody) > 4096) {
                finish(Error("Surface error response too large"));
                response.destroy(); request.destroy();
              }
            });
            response.once("error", () => finish(Error("Surface error response interrupted")));
            response.once("aborted", () => finish(Error("Surface error response aborted")));
            response.once("end", () => {
              let unavailable = false;
              try {
                const message = JSON.parse(errorBody)?.error?.message;
                unavailable = typeof message === "string" &&
                  /\bmodel\b[^.\n]{0,120}\bnot (?:currently )?loaded\b/i.test(message);
              } catch {
                // Malformed provider content cannot authorize a paid retry.
                unavailable = false;
              }
              finish(unavailable ? new SurfaceModelUnavailable("Surface model not loaded") : Error(`Surface HTTP ${status}`));
            });
          } else {
            finish(Error(`Surface HTTP ${status}`));
            response.destroy();
            request.destroy();
          }
          return;
        }
        if (payload && !String(response.headers["content-type"]).startsWith("text/event-stream")) {
          finish(Error("Surface streaming response required"));
          response.destroy();
          request.destroy();
          return;
        }
        const decoder = payload ? new SurfaceStreamDecoder() : undefined;
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.once("error", () => finish(Error("Surface response interrupted")));
        response.once("aborted", () => finish(Error("Surface response aborted")));
        response.on("data", chunk => {
          if (settled) return;
          try {
            if (decoder) decoder.push(Buffer.from(chunk));
            else {
              bytes += chunk.length;
              if (bytes > 256 * 1024) throw Error("Surface catalog too large");
              chunks.push(Buffer.from(chunk));
            }
          } catch {
            finish(Error("Surface response exceeded limits or failed validation"));
            response.destroy();
            request.destroy();
          }
        });
        response.once("end", () => {
          if (settled) return;
          try {
            const value = decoder ? decoder.finish() : JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
            finish(undefined, value);
          } catch { finish(Error("Surface incomplete or invalid response")); }
        });
      });
      request.end(payload);
    });
  };
}
export const surfaceRequest = createSurfaceTransport();
