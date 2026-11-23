import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { workingContextRepository } from "../../server/working-context-store";
import { createWorkingContextService } from "../../server/working-context";
import { compileWorkingContext } from "../../server/lib/agent-working-context";

test("PostgreSQL working context preserves isolation, revisions, corrections and monotonic dreaming", async () => {
  const rollback = new Error("intentional fixture rollback");
  try {
    await db.transaction(async tx => {
      const marker = `working-context-${process.pid}-${Date.now()}`;
      const tenantIds = (await tx.execute(sql`
        INSERT INTO tenants (email,name) VALUES
          (${marker + "-a@example.invalid"}, 'Working context fixture A'),
          (${marker + "-b@example.invalid"}, 'Working context fixture B') RETURNING id
      `)).rows.map(row => Number(row.id));
      const [tenantA, tenantB] = tenantIds;
      const project = async (tenant: number) => Number((await tx.execute(sql`
        INSERT INTO projects (tenant_id,name) VALUES (${tenant},'Working context fixture') RETURNING id
      `)).rows[0].id);
      const projectA = await project(tenantA), projectOther = await project(tenantA), projectB = await project(tenantB);
      const personaIds = (await tx.execute(sql`SELECT id FROM personas ORDER BY id LIMIT 2`)).rows.map(row => Number(row.id));
      assert.equal(personaIds.length, 2);
      const conversation = async (tenant: number, persona: number, projectId: number | null) =>
        Number((await tx.execute(sql`INSERT INTO conversations (tenant_id,persona_id,project_id,title)
          VALUES (${tenant},${persona},${projectId},'Working context fixture') RETURNING id`)).rows[0].id);
      const original = await conversation(tenantA, personaIds[0], projectA);
      const resumed = await conversation(tenantA, personaIds[0], null);
      await tx.execute(sql`INSERT INTO project_conversations (project_id,conversation_id) VALUES (${projectA},${resumed})`);
      const wrongPersona = await conversation(tenantA, personaIds[1], projectA);
      const wrongProject = await conversation(tenantA, personaIds[0], projectOther);
      const foreign = await conversation(tenantB, personaIds[0], projectB);
      const message = async (role: string, content: string, tenant = tenantA) =>
        Number((await tx.execute(sql`INSERT INTO messages (tenant_id,conversation_id,role,content)
          VALUES (${tenant},${original},${role},${content}) RETURNING id`)).rows[0].id);
      const userText = "Use Resend for delivery.";
      const reported = "The draft is ready; delivery remains unverified.";
      const userId = await message("user", userText);
      const rawAssistant = "<!-- tools:[] -->\n" + reported + "x".repeat(20_000);
      const assistantId = await message("assistant", rawAssistant);
      const repo = workingContextRepository({ execute: async query => tx.execute(query) });
      const service = createWorkingContextService(repo, { deadlineMs: 1500 });
      const scope = { tenantId: tenantA, personaId: personaIds[0], projectId: projectA, conversationId: original };
      assert.deepEqual(await repo.resolveScope(tenantA, original), scope);
      assert.equal(await repo.resolveScope(tenantB, original), null);
      assert.equal((await repo.resolveScope(tenantA, resumed))?.projectId, projectA, "linked-project fallback matches chat");
      const capture = await service.prepareCapture({ ...scope, userMessageId: userId, assistantMessageId: assistantId });
      assert.ok(capture);
      assert.equal(capture.sources[1].content.length, 16000);
      assert.ok(capture.sources[1].content.startsWith(reported));
      const candidate = [
        { kind: "decision", role: "user", quote: userText },
        { kind: "reported_result", role: "assistant", quote: reported },
      ];
      assert.equal(await service.commitCapture(capture, candidate), 2);
      await service.commitCapture(capture, candidate);
      const firstArtifacts = await repo.loadArtifacts(scope);
      assert.equal(firstArtifacts.length, 1, "duplicate capture does not add an artifact");
      assert.equal(JSON.stringify(firstArtifacts).includes(userText), false);
      assert.match(await service.prompt({ ...scope, conversationId: resumed }), /Use Resend/);
      assert.equal(await service.prompt({ ...scope, conversationId: wrongPersona, personaId: personaIds[1] }), "");
      assert.equal(await service.prompt({ ...scope, conversationId: wrongProject }), "");
      const foreignScope = { tenantId: tenantB, personaId: personaIds[0], projectId: projectB, conversationId: foreign };
      assert.equal(await service.prompt(foreignScope), "");
      assert.deepEqual(await repo.loadSources(foreignScope, [userId, assistantId]), []);
      const inconsistent = await message("user", "A different customer's confidential source.", tenantB);
      assert.deepEqual(await repo.loadSources(scope, [inconsistent]), [], "message and conversation must share tenant");

      // Edits outside the visible excerpt still invalidate its full-source hash.
      await tx.execute(sql`UPDATE messages SET content=${rawAssistant + "changed outside visible prefix"}
        WHERE id=${assistantId} AND tenant_id=${tenantA}`);
      const revised = await service.prompt(scope);
      assert.match(revised, /Use Resend/);
      assert.doesNotMatch(revised, /The draft is ready/);

      const correction = "Actually use AgentMail instead of Resend.";
      const correctedUser = await message("user", correction);
      const correctedAssistant = await message("assistant", "The preference has been noted; no email was sent.");
      const next = await service.prepareCapture({ ...scope, userMessageId: correctedUser, assistantMessageId: correctedAssistant });
      assert.ok(next);
      const oldDecision = firstArtifacts[0].entries.find(entry => entry.kind === "decision")!;
      await service.commitCapture(next, [{ kind: "decision", role: "user", quote: correction, supersedes: [oldDecision.id] }]);
      const corrected = await service.prompt({ ...scope, conversationId: resumed });
      assert.match(corrected, /Actually use AgentMail/);
      assert.equal(corrected.includes(`"id":"${oldDecision.id}"`), false);
      assert.equal(await service.consolidate(tenantA), 1);
      await repo.save(firstArtifacts[0], true);
      const dreamed = (await repo.loadArtifacts(scope)).find(a => a.entries.some(e => e.turnMessageId === correctedUser));
      assert.ok(dreamed);
      assert.equal(dreamed.userMessageId, correctedUser, "an old compaction cannot replace the newer cursor");

      const latestUser = await message("user", "Keep the existing approval requirement.");
      const liveSources = await repo.loadSources(scope, [latestUser]);
      const unsaved = compileWorkingContext({ scope, userMessageId: latestUser, sources: liveSources,
        candidate: [{ kind: "constraint", role: "user", quote: liveSources[0].content }] });
      await tx.execute(sql`UPDATE conversations SET project_id=${projectOther} WHERE id=${original} AND tenant_id=${tenantA}`);
      await repo.save(unsaved);
      await tx.execute(sql`UPDATE conversations SET project_id=${projectA} WHERE id=${original} AND tenant_id=${tenantA}`);
      assert.equal((await repo.loadArtifacts(scope)).some(a => a.userMessageId === latestUser), false,
        "write-time project binding rejects a relink race");
      await tx.execute(sql`UPDATE conversations SET deleted_at=CURRENT_TIMESTAMP WHERE id=${original} AND tenant_id=${tenantA}`);
      assert.equal(await service.prompt({ ...scope, conversationId: resumed }), "");
      throw rollback;
    });
    assert.fail("fixture transaction unexpectedly committed");
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await pool.end();
  }
});
