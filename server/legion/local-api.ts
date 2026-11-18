import http from "node:http";
import { LEGION_TAG } from "./proxy-client";

/** Secret travels in memory to the Unix control socket, never argv/env/files. */
export async function startTailnetNode(
  socket: string, authKey: string, environment: "development" | "production", needsLogin = true,
) {
  if (!authKey || !["development", "production"].includes(environment)) throw new Error("Invalid Legion startup scope");
  const payload = JSON.stringify({
    AuthKey: authKey,
    UpdatePrefs: {
      ControlURL: "https://controlplane.tailscale.com",
      WantRunning: true, Hostname: `visionclaw-${environment === "development" ? "dev" : "prod"}-legion`,
      AdvertiseTags: [LEGION_TAG], CorpDNS: false, RouteAll: false, ShieldsUp: true,
    },
  });
  async function post(path: "/localapi/v0/start" | "/localapi/v0/login-interactive", body: string) {
    return new Promise<void>((resolve, reject) => {
    const request = http.request({
      socketPath: socket, path, method: "POST",
      headers: { Host: "local-tailscaled.sock", "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body) },
    }, response => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode === 204) resolve();
        else reject(new Error(`Tailnet startup HTTP ${response.statusCode}`));
      });
      response.once("error", () => reject(new Error("Tailnet startup interrupted")));
    });
    const timer = setTimeout(() => request.destroy(), 45_000);
    request.once("close", () => clearTimeout(timer));
    request.once("error", () => reject(new Error("Tailnet startup unavailable")));
    request.end(body);
    });
  }
  await post("/localapi/v0/start", payload);
  // Match tailscale up: Start configures the backend but does not initiate
  // first-login. This consumes the already supplied AuthKey; no browser flow
  // or returned login URL is followed or exposed.
  if (needsLogin) await post("/localapi/v0/login-interactive", "");
}
