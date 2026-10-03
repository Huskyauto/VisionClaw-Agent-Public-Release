import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("chat persona selection only resolves personas associated with the conversation tenant", () => {
  const storage = read("server/storage.ts");
  const chat = read("server/chat-engine.ts");
  const schema = read("shared/schema.ts");
  const personaDefinition = schema.match(/export const personas = pgTable\("personas", \{[\s\S]*?\n}\);/);

  assert.ok(personaDefinition);
  assert.doesNotMatch(personaDefinition![0], /tenantId|tenant_id/);
  assert.match(storage, /getPersonaForTenant\(id: number, tenantId: number\)/);
  assert.match(storage, /\.innerJoin\(tenants, eq\(tenants\.id, tenantId\)\)[\s\S]*\.where\(eq\(personas\.id, id\)\)/);
  assert.match(storage, /getActivePersonaForTenant\(tenantId: number\)/);
  assert.match(storage, /\.innerJoin\(tenants, eq\(tenants\.id, tenantId\)\)[\s\S]*\.where\(eq\(personas\.isActive, true\)\)/);

  assert.match(chat, /storage\.getPersonaForTenant\(conv\.personaId, tenantId\)/);
  assert.match(chat, /storage\.getActivePersonaForTenant\(tenantId\)/);
  assert.doesNotMatch(
    chat,
    /const persona = conv\.personaId\s*\?\s*await storage\.getPersona\(conv\.personaId\)\s*:\s*await storage\.getActivePersona\(\)/,
  );
});

test("research system-persona resolution validates the tenant and unresolved personas store null", () => {
  const research = read("server/research-engine.ts");
  const resolver = research.match(
    /export async function resolvePersonaId[\s\S]*?\n}\n/,
  );

  assert.ok(resolver, "resolvePersonaId must remain exported for proposal ingestion");
  assert.match(resolver![0], /JOIN tenants t ON t\.id = \$\{tenantId\}/);
  assert.match(resolver![0], /p\.name = \$\{personaSlug\}/);
  assert.match(research, /const personaId = await resolvePersonaId\(mapping\.personaSlug, session\.tenantId\)/);
  assert.match(research, /\$\{personaId\},\s*\$\{session\.tenantId\}/);
});