const GOOGLE_HTTP_TIMEOUT_MS = 15_000;

const connectorCache: Record<string, { token: string; expiresAt: number }> = {};

export interface GoogleApiRetryContext {
  tenantId: number;
  service?: string;
  connectorName?: string;
}

export interface GoogleApiFetchDeps {
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  getFreshToken?: () => Promise<string | null>;
}

interface GoogleConnectorResponse {
  items?: Array<{
    settings?: {
      access_token?: unknown;
      expires_at?: unknown;
      oauth?: { credentials?: { access_token?: unknown } };
    };
  }>;
}

function errorDetail(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 160);
}

export function clearGoogleConnectorTokenCache(connectorName?: string): void {
  if (connectorName) {
    delete connectorCache[connectorName];
  } else {
    for (const key of Object.keys(connectorCache)) delete connectorCache[key];
  }
  console.log(`[google_workspace] Token cache cleared${connectorName ? ` for ${connectorName}` : " (all)"}`);
}

async function boundedGoogleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Google request timed out")), GOOGLE_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
}

export async function getGoogleConnectorToken(
  connectorName: string,
  options: { required?: boolean } = {},
): Promise<string | null> {
  const cached = connectorCache[connectorName];
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? `repl ${process.env.REPL_IDENTITY}`
      : process.env.WEB_REPL_RENEWAL
        ? `depl ${process.env.WEB_REPL_RENEWAL}`
        : null;
    if (!hostname || !xReplitToken) {
      throw new Error("Replit connector runtime credentials are unavailable");
    }

    const response = await boundedGoogleFetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
      { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
    );
    if (!response.ok) {
      throw new Error(`Replit connector lookup failed with HTTP ${response.status}`);
    }
    const data = await response.json() as GoogleConnectorResponse;
    const connection = data.items?.[0];
    if (!connection) throw new Error(`No ${connectorName} connection was returned`);

    const token = connection.settings?.access_token
      || connection.settings?.oauth?.credentials?.access_token;
    if (typeof token !== "string" || !token) {
      throw new Error(`${connectorName} connection returned no access token`);
    }

    const parsedExpiry = connection.settings?.expires_at
      ? new Date(String(connection.settings.expires_at)).getTime()
      : Number.NaN;
    const expiresAt = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : Date.now() + 4 * 60 * 1000;
    connectorCache[connectorName] = { token, expiresAt };
    return token;
  } catch (error: unknown) {
    const detail = errorDetail(error);
    console.error(`[google_workspace] Connector ${connectorName} credential lookup failed: ${detail}`, error);
    if (options.required) {
      throw new Error(`Gmail connector credential lookup failed: ${detail}`, { cause: error });
    }
    return null;
  }
}

export async function fetchGoogleApiJson(
  token: string,
  url: string,
  init?: RequestInit,
  retryContext?: GoogleApiRetryContext,
  deps: GoogleApiFetchDeps = {},
): Promise<unknown> {
  const fetcher = deps.fetcher || boundedGoogleFetch;
  const request = (accessToken: string) => fetcher(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const response = await request(token);
  if (response.status === 401 && retryContext && deps.getFreshToken) {
    console.warn("[google_workspace] Got 401 from Google API — clearing token cache and retrying");
    clearGoogleConnectorTokenCache(retryContext.connectorName);
    const freshToken = await deps.getFreshToken();
    if (freshToken && freshToken !== token) {
      const retryResponse = await request(freshToken);
      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        throw new Error(`Google API ${retryResponse.status}: ${text.slice(0, 500)}. Token may have expired — try reconnecting Google in Settings.`);
      }
      if (retryResponse.status === 204) return { success: true };
      return retryResponse.json();
    }
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google API ${response.status}: ${text.slice(0, 500)}. Token may have expired — try reconnecting Google in Settings.`);
  }
  if (response.status === 204) return { success: true };
  return response.json();
}