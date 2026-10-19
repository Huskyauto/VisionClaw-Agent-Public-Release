import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { ownerAlertLogs } from "@shared/schema";
import { saveOwnerAlert, readOwnerAlert, retryPendingOwnerAlerts } from "../../server/lib/owner-alert-archive";
import { prepareOwnerAlert } from "../../server/lib/owner-alert-archive-core";
import { ADMIN_TENANT_ID } from "../../server/tenant-constants";

test("real durable snapshot restores its private folder copy after local loss, without sending mail", async () => {
  const marker = `Archive durability verification ${crypto.randomUUID()}`;
  const saved = await saveOwnerAlert({
    subject: marker, text: "Evidence after the 200-character summary boundary.\n".repeat(50),
    source: "synthetic-verification", reports: [{ name: "complete.md", content: `${marker}\nFINAL DETAIL MARKER` }],
  });
  assert.equal(saved.durability, "durable");
  assert.ok(saved.id);
  const local = path.join(process.cwd(), "data/private-alert-logs/archive", `${saved.id}.json`);
  try {
    await fs.unlink(local);
    const fetched = await readOwnerAlert(saved.id!);
    assert.equal(fetched?.reports[0].content, `${marker}\nFINAL DETAIL MARKER`);
    assert.ok((fetched?.sizeBytes || 0) > 200);
    const restored = JSON.parse(await fs.readFile(local, "utf8"));
    assert.equal(restored.id, saved.id);
    assert.equal((await fs.stat(local)).mode & 0o777, 0o600);
  } finally {
    await db.delete(ownerAlertLogs).where(and(eq(ownerAlertLogs.id, saved.id!), eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID)));
    await fs.unlink(local).catch(() => {});
  }
});

test("a malformed pending file is quarantined and does not prevent a later valid record recovering", async () => {
  const root = path.join(process.cwd(), "data/private-alert-logs");
  const suffix = crypto.randomUUID().slice(-12);
  const badId = `00000000-0000-4000-8000-${suffix}`;
  const goodId = `00000001-0000-4000-8000-${suffix}`;
  const record = { ...prepareOwnerAlert({ subject: `Synthetic recovery ${suffix}`, text: "Later valid pending details" }), id: goodId };
  await fs.mkdir(path.join(root, "pending"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(root, "pending", `${badId}.json`), "{malformed", { mode: 0o600 });
  await fs.writeFile(path.join(root, "pending", `${goodId}.json`), JSON.stringify(record), { mode: 0o600 });
  try {
    await retryPendingOwnerAlerts();
    assert.equal((await readOwnerAlert(goodId))?.text, record.text);
    assert.ok((await fs.stat(path.join(root, "quarantine", `${badId}.json`))).isFile());
  } finally {
    await db.delete(ownerAlertLogs).where(and(eq(ownerAlertLogs.id, goodId), eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID)));
    for (const [dir, id] of [["pending", badId], ["pending", goodId], ["quarantine", badId], ["archive", goodId]])
      await fs.unlink(path.join(root, dir, `${id}.json`)).catch(() => {});
  }
});

test("a transient spool read error retains valid evidence for a later retry", async () => {
  const row = prepareOwnerAlert({ subject: "Synthetic transient recovery", text: "Retain this evidence" });
  const file = path.join(process.cwd(), "data/private-alert-logs/pending", `${row.id}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(row), { mode: 0o600 });
  const originalOpen = fs.open;
  fs.open = (async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === file) throw Object.assign(new Error("temporary descriptor exhaustion"), { code: "EMFILE" });
    return originalOpen(...args);
  }) as typeof fs.open;
  try {
    await retryPendingOwnerAlerts();
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).id, row.id);
  } finally { fs.open = originalOpen; }
  try {
    await retryPendingOwnerAlerts();
    assert.equal((await readOwnerAlert(row.id))?.text, row.text);
  } finally {
    await db.delete(ownerAlertLogs).where(and(eq(ownerAlertLogs.id, row.id), eq(ownerAlertLogs.tenantId, ADMIN_TENANT_ID)));
    for (const dir of ["archive", "pending"]) await fs.unlink(path.join(process.cwd(), "data/private-alert-logs", dir, `${row.id}.json`)).catch(() => {});
  }
});
