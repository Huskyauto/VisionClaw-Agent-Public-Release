import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { digestReleaseInputs, releaseInputPaths, validReleasePath } from "./targeted-release-check";
import { computeTenantAuditEvidenceHash } from "./tenant-audit-evidence-hash";

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const findingKey = (f: any) => JSON.stringify([f?.file, f?.line ?? null, f?.severity, f?.issue]);

/** Includes membership, additions, deletions and tooling, not just the audited server tree. */
export function incrementalSourceDigest(root: string): string {
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const files = releaseInputPaths([
    ...git("ls-files", "-z"), ...git("ls-files", "--others", "--exclude-standard", "-z"),
  ], []);
  return digestReleaseInputs(files.map(file => {
    if (!validReleasePath(file)) throw Error("unsafe release input");
    const full = path.resolve(root, file);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(full); }
    catch (error: any) {
      if (error.code === "ENOENT") return { path: file, content: null };
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(full) !== full ||
        stat.size > 10 * 1024 * 1024) throw Error(`unsafe release input: ${file}`);
    return { path: file, content: fs.readFileSync(full).toString("base64") };
  }));
}

type Inputs = {
  receipt: any; report: any; closure: any; release: any;
  currentSource: string; baselineHash: string; reportHash: string; closureHash: string; releaseHash: string;
};

/** Operator evidence, not a signature, autonomous approval, or publish permission. */
export function validateIncrementalReview(i: Inputs): void {
  const r = i.receipt;
  if (r?.version !== 1 || r?.status !== "APPROVED" ||
      r?.policyApproval !== "owner-approved-baseline-plus-independent-review" ||
      typeof r?.reviewer !== "string" || !r.reviewer.trim() ||
      !Array.isArray(r?.unresolved) || r.unresolved.length ||
      !Array.isArray(r?.reviewedResolutions)) throw Error("independent review is missing, incomplete or unresolved");
  for (const [field, actual] of Object.entries({
    currentSource: i.currentSource, baselineHash: i.baselineHash, reportHash: i.reportHash,
    closureHash: i.closureHash, releaseHash: i.releaseHash,
  })) {
    if (!/^[a-f0-9]{64}$/.test(actual) || r[field] !== actual) throw Error(`stale or missing ${field}`);
  }
  if (i.baselineHash !== i.report.evidenceHash ||
      i.closure?.baseline?.evidenceHash !== i.baselineHash ||
      i.closure?.baseline?.reportSha256 !== i.reportHash)
    throw Error("baseline source does not reproduce original audit evidence");
  const retained = i.report.severeDispositions.filter((f: any) =>
    f.disposition === "kept" || f.disposition === "deferred-real-risk");
  const expected = new Set(retained.map(findingKey));
  const resolutions = i.closure?.resolutions;
  if (!Array.isArray(resolutions) || resolutions.length !== retained.length ||
      r.reviewedResolutions.length !== retained.length) throw Error("incomplete finding accounting");
  const seen = new Set<string>();
  for (const item of resolutions) {
    const key = findingKey(item.original);
    if (!expected.has(key) || seen.has(key) ||
        !["fixed", "false_positive"].includes(item.proposedResolution) ||
        typeof item.rationale !== "string" || !item.rationale.trim())
      throw Error("invalid or unresolved finding resolution");
    seen.add(key);
    const matches = r.reviewedResolutions.filter((v: any) => v.key === key);
    if (matches.length !== 1 || matches[0].resolution !== item.proposedResolution ||
        matches[0].verdict !== "ACCEPTED") throw Error("finding lacks exact independent acceptance");
  }
  if (i.release?.status !== "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED" ||
      i.release?.sourceStable !== true || i.release?.scopeMembershipStable !== true ||
      !Array.isArray(i.release?.checks) || i.release.checks.length === 0 ||
      i.release.checks.some((c: any) => c.passed !== true))
    throw Error("automated release evidence is incomplete");
  if (i.release?.source?.digest !== i.currentSource)
    throw Error("automated release report source digest does not match accepted current source");
  const required = [
    "regressions", "typecheck", "surface-preflight", "domain-preflight", "build",
    "portable-install", "publish-typecheck",
  ];
  if (i.release.scope?.areas?.includes("payments")) required.push("mission-lifecycle");
  if (i.release.scope?.areas?.includes("muse-s2-integration")) required.push("muse-s2-integration");
  if (required.some(name => i.release.checks.filter((c: any) => c.name === name && c.passed === true).length !== 1))
    throw Error("required automated check is missing or duplicated");
  if (!Array.isArray(r.supplementalChecks) || !r.supplementalChecks.length ||
      r.supplementalChecks.some((c: any) => c?.passed !== true ||
        typeof c?.command !== "string" || typeof c?.logSha256 !== "string"))
    throw Error("supplemental gate verification is missing");
}

export function verifyIncrementalReadiness(root: string, report: any, reportBytes: Buffer): void {
  const dir = path.join(root, ".local/republication-triage");
  const read = (file: string) => {
    const full = path.join(dir, file);
    if (!fs.lstatSync(full).isFile() || fs.realpathSync(full) !== full) throw Error("unsafe evidence file");
    return fs.readFileSync(full);
  };
  const receipt = JSON.parse(read("acceptance.json").toString());
  const closureBytes = read("closure.json");
  if (!validReleasePath(receipt.releaseReportPath) ||
      !/^\.local\/release-checks\/run-[A-Za-z0-9]+\/report\.json$/.test(receipt.releaseReportPath))
    throw Error("invalid automated release report path");
  const releaseBytes = fs.readFileSync(path.join(root, receipt.releaseReportPath));
  const reviewBytes = read("independent-review.md");
  if (receipt.reviewSha256 !== sha256(reviewBytes)) throw Error("independent review record changed");
  for (const c of receipt.supplementalChecks || []) {
    if (!validReleasePath(c.logPath) || !c.logPath.startsWith(".local/republication-triage/") ||
        sha256(fs.readFileSync(path.join(root, c.logPath))) !== c.logSha256)
      throw Error("supplemental verification log changed");
  }
  validateIncrementalReview({
    receipt, report, closure: JSON.parse(closureBytes.toString()), release: JSON.parse(releaseBytes.toString()),
    currentSource: incrementalSourceDigest(root),
    baselineHash: computeTenantAuditEvidenceHash(path.join(root, "generated-artifacts/republish-audit-baseline")),
    reportHash: sha256(reportBytes), closureHash: sha256(closureBytes), releaseHash: sha256(releaseBytes),
  });
}
