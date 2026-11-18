import { ssrfSafeUrl, pinnedDispatcher } from "./ssrf-jail";

type Check = typeof ssrfSafeUrl;
export async function validateMcpServerUrl(raw: string, check: Check = ssrfSafeUrl) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MCP requires an HTTPS URL without credentials, query or fragment");
  }
  const checked = await check(url.toString());
  if (!checked.ok) throw new Error(`Unsafe MCP destination: ${checked.reason}`);
  if (!checked.addresses?.length) throw new Error("MCP destination has no validated address");
  return { url: url.toString().replace(/\/$/, ""), addresses: checked.addresses };
}

/** Revalidate stored endpoints on every use; pin DNS and never forward auth on redirects. */
export async function fetchMcpEndpoint(base: string, endpoint: "tools/list" | "tools/call",
  init: RequestInit, deps: {
    check?: Check; fetch?: typeof fetch; dispatcher?: typeof pinnedDispatcher;
  } = {}): Promise<Response> {
  const target = await validateMcpServerUrl(base, deps.check);
  const dispatcher = (deps.dispatcher ?? pinnedDispatcher)(target.addresses);
  try {
    return await (deps.fetch ?? fetch)(`${target.url}/${endpoint}`, {
      ...init, redirect: "error", dispatcher,
    } as RequestInit);
  } finally {
    void dispatcher.close().catch(() => console.warn("[mcp] Validated connection cleanup failed"));
  }
}
