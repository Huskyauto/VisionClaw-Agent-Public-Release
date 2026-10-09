import { createHash } from "node:crypto";

export const AGENTID_ISSUER = "https://auth.agentid.com";
export const AGENTID_CALLBACK_PATH = "/api/auth/agentid/callback";

export function agentIdIdentity(sub: unknown): string {
  if (typeof sub !== "string" || !sub.trim() || sub.length > 512) {
    throw new Error("Invalid AgentID subject");
  }
  return `agentid:${createHash("sha256").update(`${AGENTID_ISSUER}\0${sub}`).digest("hex")}`;
}

export function agentIdEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTID_ENABLED === "1" &&
    !!env.AGENTID_CLIENT_ID?.trim() && !!env.AGENTID_CLIENT_SECRET?.trim();
}

export function agentIdRedirectUri(env: NodeJS.ProcessEnv = process.env): URL {
  let uri: URL;
  try { uri = new URL(env.AGENTID_REDIRECT_URI || ""); }
  catch { throw new Error("AgentID callback is not configured"); }
  if (uri.protocol !== "https:" || uri.username || uri.password ||
      uri.pathname !== AGENTID_CALLBACK_PATH || uri.search || uri.hash) {
    throw new Error("AgentID callback must be an HTTPS exact-path URL without credentials, query or fragment");
  }
  return uri;
}
