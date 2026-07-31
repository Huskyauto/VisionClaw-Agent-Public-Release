import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { ensureProjectFolder, uploadAndShare } from "../server/google-drive";
import * as path from "path";
import * as fs from "fs";

const TENANT_ID = 1;

interface PlanSpec {
  name: string;
  description: string;
  tags: string[];
  customerName?: string;
  customerEmail?: string;
  docs: string[];
}

const PLANS: PlanSpec[] = [
  {
    name: "Monetization Plays & Wedge (R125+8.9)",
    description:
      "Origin: Bob 2026-05-24, after Project #2 (Zombie Detector) shipped. Standing instruction: figure out how to make money with VisionClaw and run it through Greg Isenberg's Idea Browser to figure out how to market it. This project holds the strategic GTM brief — wedge selection, pricing motion, ICP cluster, distribution channels, and the path from one-off audit to recurring monitoring revenue.",
    tags: ["isenberg", "ideabrowser", "monetization", "wedge", "gtm", "strategy"],
    docs: ["docs/monetization-plays-and-wedge.md"],
  },
  {
    name: "AI-Native Readiness Audit (Idea Browser Wedge)",
    description:
      "The framework-scored wedge product — a one-shot AI-Native Readiness Audit that reports a company's readiness to operate AI agents in production, scored against an Idea Browser-style entry rubric. Companion to the GTM brief. Productized as the output-skill ai-native-readiness-audit.md so any persona can summon it via lookup_output_skill. Public lead-capture surface at /audit.",
    tags: ["isenberg", "ideabrowser", "wedge", "audit", "ai-readiness", "lead-capture"],
    docs: [
      "docs/idea-browser-wedge-concept.md",
      "data/output-skills/ai-native-readiness-audit.md",
    ],
  },
  {
    name: "Audit Monitoring — $99/mo Recurring Tier",
    description:
      "The recurring-revenue layer that turns the one-shot audit into a subscription. Waitlist live on /audit (R125+12). Infrastructure deferred to Q3 — we don't build until we have ≥5 waitlist sign-ups OR ≥3 paid audit customers asking for it (whichever first). This project tracks the demand-signal threshold, the spec, and the eventual buildout.",
    tags: ["isenberg", "ideabrowser", "subscription", "monitoring", "waitlist", "saas-tier"],
    docs: ["docs/audit-monitoring-99-tier-spec.md"],
  },
  {
    name: "Daedalus — Agent-Owned Platform Engineering",
    description:
      "Path to an autonomous platform-engineering persona (originally named Atlas, renamed Daedalus after the R125+8.7 Zombie Detector caught a name collision with the existing Atlas — Metrics & Reporting Analyst). Daedalus owns the labyrinth — infrastructure, deployments, schema, migrations — with AHB safety exclusions hard-coded into its allowlist (Icarus parable). Internal capability buildout that makes every Isenberg wedge cheaper to ship.",
    tags: ["isenberg", "ideabrowser", "daedalus", "persona", "platform-engineering", "internal"],
    docs: ["docs/daedalus-roadmap.md"],
  },
  {
    name: "Hardhire — OSHA Contractor Safety Grades (Isenberg IOTD 2026-05-24)",
    description:
      "Fresh wedge candidate from Greg Isenberg's Idea Browser Idea of the Day, 2026-05-24. Concept: an A–F safety grade for homeowners hiring contractors, pulled live from OSHA's federal violation database (fall protection, electrical permit history, trench collapses). Five-star reviews don't surface federal violations; this does. Free government data + thin UI wrapper. Mapped to ideabrowser.com/idea/osha-violation-lookup-for-contractor-hiring-decisions. Status: idea-stage — needs ICP validation, monetization model, and a build-vs-buy decision before promotion to active wedge.",
    tags: ["isenberg", "ideabrowser", "iotd", "hardhire", "osha", "contractors", "idea-stage"],
    docs: [],
  },
];

async function createProject(spec: PlanSpec) {
  const tenant = await storage.getTenant(TENANT_ID);
  const tenantName = tenant?.name || `tenant-${TENANT_ID}`;

  const tagLiteral = `{${spec.tags
    .map((t) => `"${t.replace(/"/g, '\\"')}"`)
    .join(",")}}`;

  const insertResult = await db.execute(sql`
    INSERT INTO projects (name, description, status, customer_name, customer_email, tags, tenant_id)
    VALUES (
      ${spec.name},
      ${spec.description},
      'active',
      ${spec.customerName || null},
      ${spec.customerEmail || null},
      ${tagLiteral}::text[],
      ${TENANT_ID}
    )
    RETURNING id, name, drive_folder_id, drive_folder_url
  `);
  const insertRows = (insertResult as any).rows || insertResult;
  const project = Array.isArray(insertRows) ? insertRows[0] : insertRows;
  console.log(`\n[seed] ✓ Created project #${project.id}: "${project.name}"`);

  let driveFolderId: string | null = null;
  let driveFolderUrl: string | null = null;
  try {
    const folder = await ensureProjectFolder(
      project.id,
      spec.name,
      TENANT_ID,
      tenantName
    );
    driveFolderId = folder.id;
    driveFolderUrl = folder.url;
    await db.execute(sql`
      UPDATE projects
      SET drive_folder_id = ${driveFolderId}, drive_folder_url = ${driveFolderUrl}
      WHERE id = ${project.id} AND tenant_id = ${TENANT_ID}
    `);
    console.log(`[seed]   Drive folder: ${driveFolderUrl}`);
  } catch (err: any) {
    console.warn(`[seed]   Drive folder creation failed: ${err.message}`);
  }

  for (const docPath of spec.docs) {
    const absPath = path.resolve(docPath);
    if (!fs.existsSync(absPath)) {
      console.warn(`[seed]   SKIP missing doc: ${docPath}`);
      continue;
    }
    const fileName = path.basename(docPath);
    const fileSize = fs.statSync(absPath).size;
    let fileUrl: string | null = null;
    try {
      if (driveFolderId) {
        const drive = await uploadAndShare({
          filePath: absPath,
          fileName,
          mimeType: "text/markdown",
          folderLabel: `Projects/${spec.name}`,
          description: `Source plan doc for project #${project.id}`,
          parentFolderId: driveFolderId,
          share: true,
        });
        fileUrl = drive.viewUrl;
      }
    } catch (err: any) {
      console.warn(`[seed]   Drive upload failed for ${fileName}: ${err.message}`);
    }

    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
      VALUES (
        ${project.id},
        ${fileName},
        ${docPath},
        ${fileUrl},
        ${"text/markdown"},
        ${fileSize},
        ${"seed-isenberg-projects"}
      )
    `);
    console.log(
      `[seed]   + file: ${fileName} (${fileSize} bytes)${fileUrl ? ` → ${fileUrl}` : " (local only)"}`
    );
  }

  return {
    id: project.id,
    name: spec.name,
    driveFolderUrl,
    fileCount: spec.docs.length,
  };
}

(async () => {
  console.log(`[seed] Creating ${PLANS.length} Isenberg/ideabrowser projects in tenant ${TENANT_ID}…`);
  const results: any[] = [];
  for (const spec of PLANS) {
    try {
      results.push(await createProject(spec));
    } catch (err: any) {
      console.error(`[seed] ✗ Failed "${spec.name}": ${err.message}`);
      results.push({ name: spec.name, error: err.message });
    }
  }

  console.log("\n========== SUMMARY ==========");
  for (const r of results) {
    if (r.error) {
      console.log(`✗ ${r.name} — ${r.error}`);
    } else {
      console.log(
        `✓ #${r.id} ${r.name} — ${r.fileCount} file(s)${r.driveFolderUrl ? ` — Drive: ${r.driveFolderUrl}` : ""}`
      );
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error("[seed] FATAL:", err);
  process.exit(1);
});
