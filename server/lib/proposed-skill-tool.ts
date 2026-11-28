import { ADMIN_TENANT_ID as TOOL_ADMIN_TENANT_ID } from "../tenant-constants";

/** Global promotion authority is enforced here, before persistence or spend. */
export async function proposeSkillTool(params: Record<string, any>, dependencies: {
  storage: Pick<typeof import("../storage").storage, "createSkill">;
  errorMessage: (error: unknown, fallback?: string) => string;
}) {
  const { storage, errorMessage } = dependencies;
  const tid = params._tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "propose_skill requires tenant context" };
  // The enabled catalog and its review UI are platform-owner-only.
  if (tid !== TOOL_ADMIN_TENANT_ID) {
    return { error: "Global skill proposals and builds require the authenticated platform-owner tenant" };
  }
  const name = String(params.name || "").trim();
  const description = String(params.description || "").trim();
  const body = String(params.body || "").trim();
  if (!name || !description || !body) return { error: "propose_skill requires name, description, body" };
  if (name.length > 80) return { error: "name must be ≤80 chars" };
  if (description.length > 300) return { error: "description must be ≤300 chars" };
  if (body.length > 20000) return { error: "body must be ≤20000 chars" };
  try {
    const { db } = await import("../db");
    const { proposedSkills } = await import("@shared/schema");
    const { sanitizeUntrusted } = await import("./sanitize-untrusted");
    const safeName = sanitizeUntrusted(name);
    const safeDescription = sanitizeUntrusted(description);
    const safeBody = sanitizeUntrusted(body);
    const confRaw = typeof params.confidence === "number" ? params.confidence : 70;
    const confidence = Math.max(0, Math.min(100, Math.round(confRaw)));
    const { eq } = await import("drizzle-orm");
    const [row] = await db.insert(proposedSkills).values({
      tenantId: tid, name: safeName, description: safeDescription, body: safeBody,
      category: params.category ? String(params.category).slice(0, 60) : "general",
      sourceContext: params.source_context ? String(params.source_context).slice(0, 500) : null,
      proposingPersona: params._personaName ? String(params._personaName).slice(0, 80) : null,
      confidence,
    }).returning();
    // Preserve the owner's existing jury-gated autonomous build policy.
    const { jurySkillBuild, skillBuildApproved } = await import("./jury-skill-build");
    const jury = await jurySkillBuild({
      name: safeName, description: safeDescription, body: safeBody,
      sourceContext: params.source_context ? String(params.source_context).slice(0, 500) : undefined,
      proposingPersona: params._personaName ? String(params._personaName) : undefined,
      confidence, tenantId: tid,
    });
    const juryLine = jury.votes.map((v) => `${v.model}:${v.verdict}`).join(", ") || "(no votes)";
    if (skillBuildApproved(jury.decision)) {
      const MAX_PROMOTED_BODY_CHARS = 8000;
      if (safeBody.length > MAX_PROMOTED_BODY_CHARS) {
        await db.update(proposedSkills).set({
          status: "pending",
          reviewedBy: `jury (${jury.majority}/3 BUILD, body over ${MAX_PROMOTED_BODY_CHARS}-char cap)`,
          reviewedAt: new Date(),
        }).where(eq(proposedSkills.id, row.id));
        return {
          ok: true, decision: "escalate", proposed_skill_id: row.id,
          review_url: "/admin/proposed-skills", jury: juryLine,
          message: `Jury voted BUILD (${jury.majority}/3) but the body exceeds the ${MAX_PROMOTED_BODY_CHARS}-char promote cap; left pending for a human to trim/approve.`,
        };
      }
      const promoteName = sanitizeUntrusted(safeName, { maxBytes: 200 });
      const promoteDesc = sanitizeUntrusted(safeDescription, { maxBytes: 1000 });
      const promoteBody = sanitizeUntrusted(safeBody, { maxBytes: MAX_PROMOTED_BODY_CHARS });
      let built: any;
      try {
        built = await storage.createSkill({
          name: promoteName, description: promoteDesc, promptContent: promoteBody,
          category: params.category ? String(params.category).slice(0, 60) : "general",
          enabled: true,
        } as any);
      } catch (error) {
        const { isManagedSkillSecurityError } = await import("./managed-skill-safety");
        if (!isManagedSkillSecurityError(error)) throw error;
        await db.update(proposedSkills).set({
          status: "pending",
          reviewedBy: `jury (${jury.majority}/3 BUILD, security scan rejected: ${error.patterns.join(", ")})`,
          reviewedAt: new Date(),
        }).where(eq(proposedSkills.id, row.id));
        return {
          ok: true, decision: "escalate", proposed_skill_id: row.id,
          review_url: "/admin/proposed-skills", jury: juryLine,
          message: "Jury voted BUILD, but the skill security scan rejected the content; left pending for owner review.",
        };
      }
      await db.update(proposedSkills).set({
        status: "accepted", reviewedBy: `jury (${jury.majority}/3 BUILD)`,
        reviewedAt: new Date(), promotedSkillId: built.id,
      }).where(eq(proposedSkills.id, row.id));
      return {
        ok: true, decision: "build", built_skill_id: built.id, proposed_skill_id: row.id, jury: juryLine,
        message: `Jury approved (${jury.majority}/3 BUILD). Skill '${name}' is now LIVE and enabled for all agents — no human review needed.`,
      };
    }
    if (jury.decision === "reject") {
      await db.update(proposedSkills).set({
        status: "rejected", reviewedBy: `jury (${jury.majority}/3 REJECT)`, reviewedAt: new Date(),
      }).where(eq(proposedSkills.id, row.id));
      return {
        ok: true, decision: "reject", proposed_skill_id: row.id, jury: juryLine,
        message: `Jury declined to build '${name}' (${jury.majority}/3 REJECT). Not added. Reasoning: ${jury.votes.find((v) => v.verdict === "REJECT")?.rationale?.slice(0, 200) || "n/a"}`,
      };
    }
    // A split vote preserves the existing pending queue and non-blocking ping.
    void (async () => {
      try {
        const { sendEmail, isEmailConfigured } = await import("../email");
        if (!isEmailConfigured?.()) return;
        const OWNER_EMAIL = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
        if (!OWNER_EMAIL) return;
        await (sendEmail as any)({
          to: OWNER_EMAIL,
          subject: `[VisionClaw] Skill jury split — '${name}' needs your call`,
          text: `An agent proposed a new skill and the 3-model jury could NOT reach a 2-of-3 majority, so it was NOT auto-built.\n\nSkill: ${name}\nProposed by: ${params._personaName || "unknown"}\nVotes: ${juryLine}\n\nReview/decide at /admin/proposed-skills (proposal #${row.id}).\n\nThis is the only case a skill build needs your eyes — majority BUILD/REJECT verdicts auto-apply with no human in the loop.`,
        });
      } catch (e) {
        console.warn(`[propose_skill] escalate owner-ping failed (non-fatal): ${errorMessage(e, String(e))}`);
      }
    })();
    return {
      ok: true, decision: "escalate", proposed_skill_id: row.id,
      review_url: "/admin/proposed-skills", jury: juryLine,
      message: `Jury split — no 2/3 majority (${juryLine}). Skill '${name}' left pending for your call; you've been pinged. This is the only case that needs a human.`,
    };
  } catch (e) { return { error: `propose_skill failed: ${errorMessage(e, String(e))}` }; }
}
