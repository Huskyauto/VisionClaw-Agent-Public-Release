import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { checkAndAutoCreateProject } from "../server/auto-project";
import { db } from "../server/db";

test("concurrent auto-project turns converge on one tenant-owned project", async () => {
  const marker = `qa-auto-project-${Date.now()}`;
  const conversationResult = await db.execute(sql`
    INSERT INTO conversations (title, tenant_id)
    VALUES (${marker}, 1)
    RETURNING id
  `);
  const conversationId = Number((((conversationResult as any).rows || conversationResult)[0]).id);
  const createdProjectIds: number[] = [];

  try {
    await db.execute(sql`
      INSERT INTO messages (conversation_id, role, content, tenant_id)
      VALUES (${conversationId}, 'user', 'Build a CMMC reporting project and create a verified prospect report.', 1)
    `);

    const [first, second] = await Promise.all([
      checkAndAutoCreateProject(conversationId, 1, "Build a CMMC reporting project and create a verified prospect report."),
      checkAndAutoCreateProject(conversationId, 1, "Build a CMMC reporting project and create a verified prospect report."),
    ]);

    assert.ok(first?.projectId);
    assert.ok(second?.projectId);
    assert.equal(first.projectId, second.projectId);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
    createdProjectIds.push(first.projectId!);

    const assignmentResult = await db.execute(sql`
      SELECT c.project_id, p.tenant_id,
             (SELECT COUNT(*)::int FROM project_conversations pc
              WHERE pc.conversation_id = c.id AND pc.project_id = c.project_id) AS link_count
      FROM conversations c
      JOIN projects p ON p.id = c.project_id
      WHERE c.id = ${conversationId} AND c.tenant_id = 1
    `);
    const assignment = ((assignmentResult as any).rows || assignmentResult)[0];
    assert.equal(Number(assignment.project_id), first.projectId);
    assert.equal(Number(assignment.tenant_id), 1);
    assert.equal(Number(assignment.link_count), 1);
  } finally {
    await db.execute(sql`DELETE FROM project_conversations WHERE conversation_id = ${conversationId}`);
    await db.execute(sql`DELETE FROM conversations WHERE id = ${conversationId} AND tenant_id = 1`);
    for (const projectId of createdProjectIds) {
      await db.execute(sql`DELETE FROM project_notes WHERE project_id = ${projectId}`);
      await db.execute(sql`DELETE FROM projects WHERE id = ${projectId} AND tenant_id = 1`);
    }
  }
});