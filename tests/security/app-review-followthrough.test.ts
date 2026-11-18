import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "esbuild";
import { PgDialect, pgTable, integer, boolean } from "drizzle-orm/pg-core";
import * as orm from "drizzle-orm";

/** Run the actual named source closure without loading providers or credentials. */
function closure(file: string, name: string, context: Record<string, unknown>) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selected: ts.FunctionDeclaration | ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) {
      selected = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(selected, `${name} exists in production source`);
  const declaration = `${ts.isVariableDeclaration(selected) ? "const " : ""}${selected.getText(source)};`;
  const code = transformSync(declaration.replace(/\bimport\(("[^"]+")\)/g,
    "Promise.resolve(require($1))"), { loader: "tsx", format: "cjs", jsxFactory: "h", jsxFragment: "Fragment" }).code;
  return vm.runInNewContext(`${code}\n${name}`, {
    module: { exports: {} }, Fragment: "Fragment", console: { warn() {}, error() {} }, ...context,
  });
}

test("logout removes local identity and cached data even when remote revocation fails", async () => {
  const cleared: string[] = [];
  const logout = closure("client/src/lib/auth.tsx", "logout", {
    token: "fixture-session", isReplitAuth: false,
    useCallback: (fn: unknown) => fn,
    apiRequest: async () => { throw Error("offline"); },
    transitionTenantIdentity: async (value: unknown) => { assert.equal(value, null); cleared.push("cache"); return 1; },
    isCurrentAuthIdentityGeneration: () => true,
    setToken: (v: unknown) => { assert.equal(v, null); cleared.push("token"); },
    setTenant: (v: unknown) => { assert.equal(v, null); cleared.push("tenant"); },
    setReplitUser: () => cleared.push("oidc-user"),
    setIsReplitAuth: () => cleared.push("oidc-state"),
    localStorage: { removeItem: (key: string) => { assert.equal(key, "vc_token"); cleared.push("storage"); } },
  });
  await logout();
  assert.deepEqual(cleared, ["cache", "token", "tenant", "oidc-user", "oidc-state", "storage"]);
});

test("signed-in Skills navigation reaches the workspace instead of the public catalog", () => {
  const source = readFileSync("client/src/App.tsx", "utf8");
  const context: Record<string, unknown> = {};
  for (const m of source.matchAll(/(?:<|component=\{)([A-Z]\w*)/g)) context[m[1]] = m[1];
  context.h = (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children });
  context.useEffect = () => {};
  context.useLocation = () => ["/skills", () => {}];
  context.useQuery = () => ({ data: { needsSetup: false, isFreshDeploy: false } });
  for (const signedIn of [true, false]) {
    context.useAuth = () => ({ token: signedIn ? "fixture" : null, authRequired: true, isChecking: false });
    const gate = closure("client/src/App.tsx", "AuthGate", context);
    const routes: { props: { path?: string; component?: string } }[] = [];
    function visit(node: any) {
      if (!node || typeof node !== "object") return;
      if (node.type === "Route") routes.push(node);
      node.children?.flat(Infinity).forEach(visit);
    }
    visit(gate());
    const skills = routes.find(r => r.props?.path === "/skills");
    if (signedIn) assert.notEqual(skills?.props.component, "SkillsCatalogPage", "workspace route must not be shadowed");
    else assert.equal(skills?.props.component, "SkillsCatalogPage", "public discovery remains available");
  }
});

test("legacy MCP rechecks disabled cached tenants and refuses unavailable authorization state", async () => {
  const tenants = pgTable("tenants", { id: integer("id"), isActive: boolean("is_active") });
  const dialect = new PgDialect();
  for (const cached of [true, false]) {
    for (const state of ["active", "disabled", "unavailable"]) {
      const key = "fixture-derived-tenant-key";
      const cache = new Map(cached ? [[key, 7]] : []);
      const predicates: { sql: string; params: unknown[] }[] = [];
      const lookup = closure("server/mcp-server.ts", "lookupTenantForKey", {
        _knownTenantKeys: cache, KNOWN_TENANT_KEYS_MAX: 256,
        deriveMcpTenantKey: (id: number) => id === 7 ? key : "different",
        timingSafeEqual: (a: string, b: string) => a === b,
        require: (name: string) => {
          if (name === "@shared/schema") return { tenants };
          if (name === "drizzle-orm") return orm;
          assert.equal(name, "./db");
          return { db: { select: () => ({ from: () => {
            if (state === "unavailable") throw Error("offline authorization store");
            return {
              then: (resolve: (rows: unknown[]) => void) => resolve([{ id: 7 }]),
              where: (predicate: orm.SQL) => {
                predicates.push(dialect.sqlToQuery(predicate));
                return Promise.resolve(state === "active" ? [{ id: 7 }] : []);
              },
            };
          } }) } };
        },
      });
      const result = await lookup(key);
      assert.equal(result.kind, state === "active" ? "hit" : state === "disabled" ? "miss" : "infra_error",
        `${state}, previously cached=${cached}`);
      if (state === "disabled") assert.equal(cache.has(key), false);
      if (state !== "unavailable") {
        assert.equal(predicates.length, 1, "even cached hits must query current authorization");
        assert.match(predicates[0].sql, /"tenants"\."is_active"/);
        assert.ok(predicates[0].params.includes(true));
        if (cached) assert.ok(predicates[0].params.includes(7), "cached checks retain exact tenant ownership");
      }
    }
  }
});

test("private-mode visitors see an explicit notice instead of inaccessible contact and purchase forms", () => {
  for (const [file, name, forbidden] of [
    ["client/src/pages/contact.tsx", "ContactPage", "form"],
    ["client/src/pages/store.tsx", "StorePage", "CatalogView"],
  ]) {
    const source = readFileSync(file, "utf8");
    const context: Record<string, unknown> = {
      useEffect: () => {}, useState: (initial: unknown) => [initial, () => {}],
      useLocation: () => ["/store", () => {}], useToast: () => ({ toast() {} }),
      useSiteConfig: () => ({ config: { platformName: "Fixture", contactEmail: "owner@example.test" } }),
      URLSearchParams, window: { location: { search: "" } },
      h: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    };
    for (const m of source.matchAll(/<([A-Z]\w*)/g)) context[m[1]] = m[1];
    for (const ownerOnly of [true, false]) {
      context.useAuth = () => ({ ownerOnly, tenant: null });
      const types: string[] = [];
      function visit(node: any) {
        if (!node || typeof node !== "object") return;
        types.push(node.type);
        node.children?.flat(Infinity).forEach(visit);
      }
      visit(closure(file, name, context)());
      assert.equal(types.includes(forbidden), !ownerOnly, `${name}: ownerOnly=${ownerOnly}`);
    }
  }
});

test("the legacy global owner key cannot bypass a disabled account or authorization outage", async () => {
  for (const kind of ["hit", "miss", "infra_error"]) {
    const key = "offline-global-key-with-at-least-32-characters";
    let probes = 0;
    const middleware = closure("server/mcp-server.ts", "mcpAuthMiddleware", {
      MCP_API_KEY: key, ADMIN_TENANT_ID: 1,
      _warnedGlobalKeyAuth: false, _warnedQueryStringAuth: false,
      timingSafeEqual: (a: string, b: string) => a === b,
      deriveMcpTenantKey: (id: number) => `derived:${id}`,
      isCachedInvalid: () => false, rememberInvalidKey() {},
      lookupTenantForKey: async (candidate: string) => {
        assert.equal(candidate, "derived:1"); probes++;
        return { kind, tenantId: 1 };
      },
      require: (name: string) => {
        assert.equal(name, "./lib/tenant-context");
        return { runWithTenant: (id: number, source: string, next: () => void) => {
          assert.equal(id, 1); assert.equal(source, "api-key"); next();
        } };
      },
    });
    const status = await new Promise<number>(resolve => {
      const res = { statusCode: 200, status(n: number) { this.statusCode = n; return this; },
        json() { resolve(this.statusCode); return this; } };
      middleware({ headers: { authorization: `Bearer ${key}` }, query: {} }, res, () => resolve(200));
    });
    assert.equal(probes, 1);
    assert.equal(status, kind === "hit" ? 200 : kind === "miss" ? 401 : 503);
  }
});
