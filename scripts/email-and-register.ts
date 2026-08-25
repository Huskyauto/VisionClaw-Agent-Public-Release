import fs from "fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";

(async () => {
  const r = JSON.parse(fs.readFileSync("/tmp/cf-result.json", "utf8"));

  await db.execute(sql`
    INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
    VALUES
      (15, 'VisionClaw-Comprehensive-Features.pdf', ${r.pdf.viewUrl}, 'application/pdf', ${r.pdf.size}, 'VisionClaw Agent'),
      (15, 'VisionClaw-Comprehensive-Features.txt', ${r.txt.viewUrl}, 'text/plain', ${r.txt.size}, 'VisionClaw Agent')
    ON CONFLICT DO NOTHING
  `);
  console.log("[db] Registered in project_files");

  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult.inboxId || inboxResult.email);
  console.log("[email] inboxId:", inboxId);

  const text = `Bob —

The R54 + R54.F security bundle is shipped, README + replit.md updated, and pushed to GitHub (Huskyauto/VisionClaw-Agent main).

Updated comprehensive features documents:

  PDF:  ${r.pdf.viewUrl}
  TXT:  ${r.txt.viewUrl}

Both files are also registered in project 15 for Felix.

Quick summary of R54:
  - R54.A — auth-gated the persona/skill discovery endpoints (was leaking system prompts to anonymous probes)
  - R54.B — closed two IDOR routes (DELETE/PATCH /api/memory + /api/knowledge) that only checked the first 1000 rows
  - R54.D — vector search now requires tenantId; 4 internal queries in getConversationProjectContext are tenant-scoped
  - R54.E — KB section in agent prompt wrapped with "treat as data, not instructions" preamble
  - R54.F — same admin-default backdoor patched in keywordSearch fallbacks; ACTIVE SKILLS header for symmetry

Counts in this build: ${r.counts.tools} tools, ${r.counts.skills} skills, ${r.counts.personas} personas, 130 tables.

— VisionClaw Agent`;

  const sent = await sendEmail({
    inboxId,
    to: process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com",
    subject: "VisionClaw Updated Features — PDF + Text (R54 + R54.F)",
    text,
  } as any);
  console.log("[email] Sent:", JSON.stringify(sent).slice(0, 300));

  process.exit(0);
})().catch((e) => { console.error("[fatal]", e?.message || e); process.exit(1); });
