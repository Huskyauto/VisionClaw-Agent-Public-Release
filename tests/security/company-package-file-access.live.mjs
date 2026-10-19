// Explicit development-only HTTP integration check. No model/provider calls.
// All keys and files are disposable; raw credentials never leave this process.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";

if (process.env.RUN_PACKAGE_PRIVATE_FILE_LIVE !== "1" ||
    process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Requires explicit opt-in in a development workspace");
}
assert.ok(process.env.REPLIT_DEV_DOMAIN && process.env.DATABASE_URL);
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const tag = `package-boundary-${randomUUID()}`;
const keyIds = [], fileIds = [];
let otherTenant;
const bytes = Buffer.from("%PDF-1.4\n% disposable access-control fixture\n%%EOF\n");
async function key(tenantId) {
  const raw = `vc_${randomBytes(32).toString("hex")}`;
  const result = await pool.query(
    "INSERT INTO api_keys(tenant_id,name,key_hash,key_prefix,scopes,expires_at) VALUES($1,$2,$3,$4,ARRAY['read'],NOW()+INTERVAL '5 minutes') RETURNING id",
    [tenantId, tag, createHash("sha256").update(raw).digest("hex"), raw.slice(0, 12)]);
  keyIds.push(result.rows[0].id);
  return raw;
}
async function file(tenantId, filename) {
  const result = await pool.query(
    "INSERT INTO file_storage(tenant_id,filename,original_name,mime_type,size,data) VALUES($1,$2,$2,'application/pdf',$3,$4) RETURNING id",
    [tenantId, filename, bytes.length, bytes.toString("base64")]);
  fileIds.push(result.rows[0].id);
  return result.rows[0].id;
}
async function get(raw, route, status) {
  const response = await fetch(origin + route, {
    headers: { Authorization: `Bearer ${raw}`, Origin: origin },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, status, route);
  return response;
}
try {
  const created = await pool.query("INSERT INTO tenants(email,name) VALUES($1,$2) RETURNING id",
    [`${tag}@example.invalid`, tag]);
  otherTenant = created.rows[0].id;
  const ownerKey = await key(1), otherKey = await key(otherTenant);
  const reserved = `__admin-company-package-${Date.now()}`;
  const full = await file(1, `${reserved}-full.pdf`);
  const teaser = await file(1, `${reserved}-teaser.pdf`);
  const ordinary = await file(1, `${tag}.pdf`);
  const otherOrdinary = await file(otherTenant, `${tag}-other.pdf`);
  for (const raw of [ownerKey, otherKey]) {
    const visible = await (await get(raw, "/api/tenant/files", 200)).json();
    assert.ok(Array.isArray(visible));
    assert.ok(!visible.some(row => row.id === full || row.id === teaser));
    await get(raw, `/api/tenant/files/${full}`, 404);
    await get(raw, `/api/tenant/files/${teaser}`, 404);
    await get(raw, `/uploads/${reserved}-full.pdf`, 404);
    await get(raw, `/uploads/%5f%5fadmin-company-package-${reserved.split("-").at(-1)}-teaser.pdf`, 404);
  }
  assert.deepEqual(Buffer.from(await (await get(ownerKey, `/api/tenant/files/${ordinary}`, 200)).arrayBuffer()), bytes);
  await get(otherKey, `/api/tenant/files/${ordinary}`, 404);
  await get(ownerKey, `/api/tenant/files/${otherOrdinary}`, 404);
  await get(otherKey, `/api/tenant/files/${otherOrdinary}`, 200);
  console.log("PASS: real owner-tenant read-only key and different-tenant key cannot list/download private full/teaser packages; ordinary own files remain accessible; cross-tenant reads denied.");
} finally {
  try {
    if (fileIds.length) await pool.query("DELETE FROM file_storage WHERE id=ANY($1::int[])", [fileIds]);
    if (keyIds.length) await pool.query("DELETE FROM api_keys WHERE id=ANY($1::int[])", [keyIds]);
    if (otherTenant) await pool.query("DELETE FROM tenants WHERE id=$1 AND name=$2", [otherTenant, tag]);
    console.log("Only disposable file/key/tenant fixtures removed; no customer records changed.");
  } finally { await pool.end(); }
}
