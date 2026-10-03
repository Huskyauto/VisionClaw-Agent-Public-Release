const RESULT_MARKER = "PROPOSAL_VERIFY_RESULT:";

async function main(): Promise<void> {
  const [proposalArg, tenantArg, ...extra] = process.argv.slice(2);
  const proposalId = Number(proposalArg);
  const tenantId = Number(tenantArg);
  if (extra.length || !Number.isSafeInteger(proposalId) || proposalId <= 0
    || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    process.exitCode = 2;
    return;
  }

  let result: import("../server/proposal-verifier").VerifyResult;
  try {
    const { verifyProposalById } = await import("../server/proposal-verifier");
    const { withTenantContext } = await import("../server/lib/tenant-context");
    result = await withTenantContext(
      { tenantId, source: "background-job" },
      () => verifyProposalById(proposalId, tenantId),
    );
  } catch {
    // Parent treats any missing protocol result/nonzero exit as indeterminate.
    // Do not print database errors, tokens, or proposal data to inherited logs.
    process.exitCode = 1;
    return;
  }

  try {
    // Verification resolves only after its persistence work completes. Close
    // the now-idle pool so this one-shot child exits naturally and promptly.
    const { pool } = await import("../server/db");
    await pool.end();
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