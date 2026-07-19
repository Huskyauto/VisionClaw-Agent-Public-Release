/**
 * Tools-layer-split S24 — middleware extraction, phase 5 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of `attachProductVerification` out of `executeTool`
 * (server/tools.ts) — ZERO behavior change. Runs local-disk + Drive-upload +
 * per-tool sanity checks over a deliverable tool's result and grafts a
 * `_productVerification` report onto it (fail-closed REVIEW_NEEDED when no
 * checks could run). The `PRODUCT_OUTPUT_TOOLS.has(name)` gate that decides
 * whether to call this stays at the executeTool callsite (unchanged).
 *
 * Pure aside from `fs` (used to stat local artifacts); no app-graph deps, so no
 * dynamic import is needed here. The module carries no static edge back into
 * server/tools.ts (acyclicity invariant —
 * data/feature-contracts/tools-layer-split/spec.md).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import fs from "node:fs";

export function attachProductVerification(toolName: string, result: any): any {
  if (!result || result.error) return result;
  const verification: any = { tool: toolName, timestamp: new Date().toISOString(), checks: [] };

  const fPath = result.filePath || result.file_path || result.outputPath || result.path || result.localPath;
  // R98.14 +sec-2 follow-up: many deliverable tools return a `localPath` that is
  // a URL-form path (e.g. "/uploads/foo.pdf" or "/v/<id>") describing where the
  // file is REACHABLE, not where it lives on disk — the actual artifact has
  // been uploaded to Drive and possibly persisted to the DB, not the local FS.
  // Reporting "Output file not found at /uploads/foo.pdf" as a FAIL when a
  // valid drive_url + fileId already exist misled both Felix (he'd try to
  // redo a successful delivery) and the golden-path replay (false regressions).
  // Fix: only run the local-disk check when the path looks like a real local
  // path (absolute /home, relative ./..., or a known local prefix), AND
  // downgrade FAIL to INFO when a successful Drive/cloud link also exists.
  const looksLikeRealLocalPath = (p: string): boolean => {
    if (!p) return false;
    if (p.startsWith("/uploads/") || p.startsWith("/v/") || p.startsWith("/watch/") || p.startsWith("/d/") || p.startsWith("/api/")) return false; // URL-form, not disk
    if (p.startsWith("/") || p.startsWith("./") || p.startsWith("../") || /^[a-zA-Z]:/.test(p)) return true;
    if (p.startsWith("project-assets/") || p.startsWith("attached_assets/") || p.startsWith("data/") || p.startsWith("uploads/")) return true;
    return false;
  };
  const hasCloudDelivery = !!(result.drive_url || result.driveUrl || result.viewUrl || result.downloadUrl || result.fileId || result.googleDrive);
  if (fPath && typeof fPath === "string" && looksLikeRealLocalPath(fPath)) {
    try {
      if (fs.existsSync(fPath)) {
        const stats = fs.statSync(fPath);
        if (stats.size < 100) {
          verification.checks.push({ check: "file_size", status: "WARNING", message: `Output file is suspiciously small (${stats.size} bytes) — may be empty or corrupt` });
        } else {
          verification.checks.push({ check: "file_size", status: "OK", message: `File exists: ${stats.size} bytes` });
        }
      } else if (hasCloudDelivery) {
        verification.checks.push({ check: "file_exists", status: "INFO", message: `Local file not present at ${fPath}, but cloud delivery succeeded — artifact lives in Drive/DB.` });
      } else {
        verification.checks.push({ check: "file_exists", status: "FAIL", message: `Output file not found at ${fPath}` });
      }
    } catch {
      verification.checks.push({ check: "file_exists", status: "UNKNOWN", message: "Could not verify local file" });
    }
  }

  const driveLink = result.drive_url || result.driveUrl || result.shareableLink || result.downloadUrl
    || result.viewUrl || result.googleDrive?.shareableLink || result.googleDrive?.viewUrl
    || result.googleDrive?.downloadUrl;
  if (driveLink && typeof driveLink === "string") {
    if (!driveLink.includes("failed")) {
      verification.checks.push({ check: "drive_upload", status: "OK", message: `Uploaded to Drive: ${driveLink.slice(0, 80)}` });
    } else {
      verification.checks.push({ check: "drive_upload", status: "WARNING", message: "Drive upload may have failed — verify link works" });
    }
  }

  if (toolName === "send_email") {
    if (result.success || result.messageId || result.id) {
      verification.checks.push({ check: "email_sent", status: "OK", message: `Email delivered (ID: ${result.messageId || result.id || 'confirmed'})` });
    } else {
      verification.checks.push({ check: "email_sent", status: "WARNING", message: "Email send status uncertain — verify delivery" });
    }
  }

  if (toolName === "produce_video" || toolName === "create_slideshow_video" || toolName === "mpeg_produce" || toolName === "mpeg_produce_parallel") {
    if (result.size_bytes && result.size_bytes < 5000) {
      verification.checks.push({ check: "video_size", status: "WARNING", message: `Video is very small (${result.size_bytes} bytes) — may be corrupt or incomplete` });
    } else if (result.size_bytes) {
      verification.checks.push({ check: "video_size", status: "OK", message: `Video size: ${(result.size_bytes / 1024 / 1024).toFixed(1)} MB` });
    }
    if (result.steps) {
      const failedSteps = result.steps.filter((s: string) => s.includes("❌") || s.includes("⚠️"));
      if (failedSteps.length > 0) {
        verification.checks.push({ check: "production_steps", status: "WARNING", message: `${failedSteps.length} step(s) had issues: ${failedSteps.join("; ").slice(0, 200)}` });
      }
    }
  }

  if (toolName === "generate_audio") {
    if (result.duration && result.duration < 0.5) {
      verification.checks.push({ check: "audio_duration", status: "WARNING", message: `Audio is very short (${result.duration}s) — may be incomplete` });
    } else if (result.duration) {
      verification.checks.push({ check: "audio_duration", status: "OK", message: `Audio duration: ${result.duration}s` });
    }
  }

  if (toolName === "create_pdf" || toolName === "create_styled_report" || toolName === "create_document" || toolName === "create_spreadsheet") {
    if (result.pageCount === 0 || result.pages === 0) {
      verification.checks.push({ check: "content", status: "WARNING", message: "Document appears to have 0 pages — may be empty" });
    }
  }

  const hasWarnings = verification.checks.some((c: any) => c.status === "WARNING" || c.status === "FAIL");
  if (verification.checks.length === 0) {
    verification.overallStatus = "REVIEW_NEEDED";
    verification.instruction = "No verification checks could be performed on this output. Manually confirm the deliverable is complete before sharing with the user.";
    console.warn(`[product-qa] ${toolName}: no checks ran — fail-closed, flagging for manual review`);
  } else if (hasWarnings) {
    verification.overallStatus = "REVIEW_NEEDED";
    verification.instruction = "IMPORTANT: Review the warnings above before delivering this to the user. Be transparent about any issues found.";
    console.warn(`[product-qa] ${toolName}: verification found issues — ${verification.checks.filter((c: any) => c.status !== "OK").map((c: any) => c.message).join("; ")}`);
  } else {
    verification.overallStatus = "PASSED";
    console.log(`[product-qa] ${toolName}: all ${verification.checks.length} verification checks passed`);
  }

  result._productVerification = verification;
  return result;
}
