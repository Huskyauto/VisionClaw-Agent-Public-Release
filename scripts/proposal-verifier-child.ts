const RESULT_MARKER = "PROPOSAL_VERIFY_RESULT:";

async function main(): Promise<void> {
  const [proposalArg, tenantArg, strictArg, workspaceArg, ...extra] = process.argv.slice(2);
  const proposalId = Number(proposalArg);
  const tenantId = Number(tenantArg);
  if (extra.length || (strictArg !== undefined && strictArg !== "--strict-source-base")
    || (workspaceArg !== undefined && workspaceArg !== "--workspace-snapshot")
    || !Number.isSafeInteger(proposalId) || proposalId <= 0
    || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    process.exitCode = 2;
    return;
  }

  let result: import("../server/proposal-verifier").VerifyResult;
  try {
    let snapshot: import("../server/lib/workspace-verifier-contract").WorkspaceProposalSnapshot | undefined;
    if (workspaceArg) {
      const { readFileSync, lstatSync } = await import("node:fs");
      const { validateWorkspaceSnapshot, MAX_WORKSPACE_VERIFIER_BYTES } = await import("../server/lib/workspace-verifier-contract");
      const file = ".workspace-verifier-request.json";
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WORKSPACE_VERIFIER_BYTES) throw new Error("Invalid snapshot file");
      snapshot = validateWorkspaceSnapshot(JSON.parse(readFileSync(file, "utf8")));
      const { captureVerifierSource } = await import("../server/lib/workspace-verifier-source");
      if (captureVerifierSource().hash !== snapshot.contextSha256) throw new Error("Staged source mismatch");
    }
    const { verifyProposalById } = await import("../server/proposal-verifier");
    const { withTenantContext } = await import("../server/lib/tenant-context");
    result = await withTenantContext(
      { tenantId, source: "background-job" },
      () => verifyProposalById(proposalId, tenantId, { strictSourceBase: strictArg === "--strict-source-base", snapshot }),
    );
    if (snapshot) {
      const { captureVerifierSource } = await import("../server/lib/workspace-verifier-source");
      if (captureVerifierSource().hash !== snapshot.contextSha256) throw new Error("Staged source changed");
    }
  } catch {
    // Parent treats any missing protocol result/nonzero exit as indeterminate.
    // Do not print database errors, tokens, or proposal data to inherited logs.
    process.exitCode = 1;
    return;
  }

  try {
    // Verification resolves only after its persistence work completes. Close
    // the now-idle pool so this one-shot child exits naturally and promptly.
    if (!workspaceArg) {
      const { pool } = await import("../server/db");
      await pool.end();
    }
  } catch {
    process.exitCode = 1;
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  process.exitCode = 1;
});