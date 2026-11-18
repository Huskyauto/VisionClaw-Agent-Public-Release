import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidGrantError, InvalidScopeError, InvalidClientMetadataError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { connectorScopes, validConnectorRedirect } from "./policy";
import { tenantAccessAllowed } from "../lib/owner-only-access";

export type OAuthRecord = {
  id: string; kind: "client" | "pending" | "code" | "access" | "refresh";
  clientId: string; expiresAt: number; data: Record<string, any>;
};
export interface OAuthRecordTransaction {
  get(id: string): Promise<OAuthRecord | undefined>;
  put(record: OAuthRecord): Promise<void>;
  remove(id: string): Promise<void>;
  removeClient(clientId: string): Promise<void>;
  countClients(): Promise<number>;
  prepareClient(clientId:string,tenantId:number,allowWork:boolean):Promise<void>;
}
export interface OAuthRecordStore {
  transaction<T>(fn: (tx: OAuthRecordTransaction) => Promise<T>): Promise<T>;
}
const opaque = () => randomBytes(32).toString("base64url");
export const oauthRecordId = (kind: string, value: string) => `${kind}:${createHash("sha256").update(value).digest("hex")}`;
const seconds = () => Math.floor(Date.now() / 1000);

export class FelixOAuthProvider implements OAuthServerProvider {
  // The SDK otherwise validates PKCE separately and discards code_verifier.
  // Our provider MUST receive it: exchangeAuthorizationCode independently
  // validates S256 under the same transaction that consumes the one-use code.
  // This skips only the SDK's duplicate check, never the provider's check.
  readonly skipLocalPkceValidation = true;
  constructor(
    private store: OAuthRecordStore,
    readonly origin: URL,
    private owner: () => number,
    private development = false,
  ) {}
  private resource(resource?: URL) {
    if (resource && resource.href !== new URL("/mcp", this.origin).href) throw new InvalidGrantError("invalid resource");
  }
  private async read(tx: OAuthRecordTransaction, kind: OAuthRecord["kind"], value: string, clientId?: string) {
    if (typeof value !== "string" || !value || value.length > 1024) throw new InvalidGrantError("invalid credential");
    const row = await tx.get(oauthRecordId(kind, value));
    if (!row || row.kind !== kind || row.expiresAt <= seconds() || (clientId && row.clientId !== clientId))
      throw new InvalidGrantError("invalid or expired credential");
    return row;
  }
  get clientsStore() {
    return {
      getClient: async (clientId: string): Promise<OAuthClientInformationFull | undefined> => this.store.transaction(async tx => {
        const row = await tx.get(oauthRecordId("client", clientId));
        return row && row.expiresAt > seconds() ? row.data as OAuthClientInformationFull : undefined;
      }),
      registerClient: async (input: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull> => {
        if (!input.redirect_uris?.length || input.redirect_uris.length > 5 ||
            input.redirect_uris.some(u => !validConnectorRedirect(u, this.development)) ||
            (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== "none"))
          throw new InvalidClientMetadataError("Public PKCE client with a Claude HTTPS callback required");
        const client: OAuthClientInformationFull = {
          client_id: `felix_${opaque()}`, client_id_issued_at: seconds(),
          client_name: "Claude — Felix line", redirect_uris: [...input.redirect_uris],
          token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"], scope: "felix:read felix:write",
        };
        await this.store.transaction(async tx => {
          if (await tx.countClients() >= 100) throw new InvalidClientMetadataError("Registration capacity reached");
          await tx.put({id: oauthRecordId("client", client.client_id), kind: "client",
            clientId: client.client_id, data: client, expiresAt: seconds() + 3600});
        });
        return client;
      },
    };
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.resource(params.resource);
    if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidGrantError("invalid redirect");
    let scopes: string[];
    try { scopes = connectorScopes(params.scopes ?? []); } catch { throw new InvalidScopeError("invalid_scope"); }
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidGrantError("S256 PKCE required");
    const pending = opaque();
    await this.store.transaction(async tx => {
      await tx.put({id: oauthRecordId("pending", pending), kind: "pending", clientId: client.client_id,
        expiresAt: seconds() + 600, data: {...params, resource: new URL("/mcp", this.origin).href, scopes}});
    });
    res.redirect(`/felix-connector?request=${encodeURIComponent(pending)}`);
  }
  async pending(request: string, tenantId: number) {
    if (tenantId !== this.owner()) throw new InvalidGrantError("owner required");
    return this.store.transaction(async tx => {
      const row = await this.read(tx, "pending", request);
      return {clientId: row.clientId, clientName: "Claude — Felix line", scopes: row.data.scopes,
        redirectOrigin: new URL(row.data.redirectUri).origin};
    });
  }
  async consent(request: string, tenantId: number, denied = false, allowWork = false) {
    if (tenantId !== this.owner()) throw new InvalidGrantError("owner required");
    if(typeof allowWork!=="boolean") throw new InvalidGrantError("invalid permission");
    return this.store.transaction(async tx => {
      const row = await this.read(tx, "pending", request);
      const redirect = new URL(row.data.redirectUri);
      if (row.data.state) redirect.searchParams.set("state", row.data.state);
      if (denied) redirect.searchParams.set("error", "access_denied");
      else {
        const registration = await this.read(tx, "client", row.clientId, row.clientId);
        if(allowWork && !row.data.scopes.includes("felix:write")) throw new InvalidScopeError("Sending permission required for work");
        // The store prepares thread + permission + audit on THIS transaction.
        // Failure rolls back pending consumption and prevents any issued code.
        await tx.prepareClient(row.clientId,tenantId,allowWork);
        await tx.remove(registration.id);
        await tx.put({...registration, expiresAt: seconds() + 365 * 86400});
        const code = opaque();
        await tx.put({...row, id: oauthRecordId("code", code), kind: "code",
          data: {...row.data, tenantId}, expiresAt: seconds() + 300});
        redirect.searchParams.set("code", code);
      }
      await tx.remove(row.id);
      return redirect.href;
    });
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    return this.store.transaction(async tx => (await this.read(tx, "code", code, client.client_id)).data.codeChallenge);
  }
  private async issue(tx: OAuthRecordTransaction, row: OAuthRecord, scopes: string[]): Promise<OAuthTokens> {
    const access = `flx_a_${opaque()}`, refresh = `flx_r_${opaque()}`;
    const data = {tenantId: row.data.tenantId, scopes, resource: new URL("/mcp", this.origin).href};
    await tx.put({id: oauthRecordId("access", access), kind: "access", clientId: row.clientId,
      data, expiresAt: seconds() + 3600});
    await tx.put({id: oauthRecordId("refresh", refresh), kind: "refresh", clientId: row.clientId,
      data, expiresAt: seconds() + 30 * 86400});
    await tx.remove(row.id);
    return {access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: scopes.join(" ")};
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string,
      verifier?: string, redirectUri?: string, resource?: URL) {
    this.resource(resource);
    return this.store.transaction(async tx => {
      const row = await this.read(tx, "code", code, client.client_id);
      if (redirectUri !== row.data.redirectUri) throw new InvalidGrantError("redirect mismatch");
      const challenge = createHash("sha256").update(verifier ?? "").digest("base64url");
      if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
          Buffer.byteLength(challenge) !== Buffer.byteLength(row.data.codeChallenge) ||
          !timingSafeEqual(Buffer.from(challenge), Buffer.from(row.data.codeChallenge))) throw new InvalidGrantError("PKCE mismatch");
      return this.issue(tx, row, row.data.scopes);
    });
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, token: string, requested?: string[], resource?: URL) {
    this.resource(resource);
    return this.store.transaction(async tx => {
      const row = await this.read(tx, "refresh", token, client.client_id);
      const scopes = requested?.length ? requested : row.data.scopes as string[];
      if (scopes.some(s => !row.data.scopes.includes(s))) throw new InvalidScopeError("scope escalation denied");
      return this.issue(tx, row, scopes);
    });
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.store.transaction(async tx => {
      let row: OAuthRecord;
      try { row = await this.read(tx, "access", token); } catch { throw new InvalidTokenError("invalid or expired token"); }
      if (row.data.tenantId !== this.owner() || !tenantAccessAllowed(row.data.tenantId)) throw new InvalidTokenError("invalid owner");
      return {token, clientId: row.clientId, scopes: row.data.scopes, expiresAt: row.expiresAt,
        resource: new URL(row.data.resource), extra: {tenantId: row.data.tenantId}};
    });
  }
  async revokeToken(client: OAuthClientInformationFull, input: OAuthTokenRevocationRequest) {
    await this.store.transaction(async tx => {
      const kind = input.token.startsWith("flx_r_") ? "refresh" : "access";
      const row = await tx.get(oauthRecordId(kind, input.token));
      if (row?.clientId === client.client_id) await tx.removeClient(client.client_id);
    });
  }
  async revokeClient(clientId: string) { await this.store.transaction(tx => tx.removeClient(clientId)); }
}
