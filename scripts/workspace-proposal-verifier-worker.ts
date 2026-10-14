/**
 * Verification-only workspace consumer. No production DB connection, source
 * application, model call, merge, or publish capability.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { fetch as safeFetch } from "undici";
import { ssrfSafeUrl, pinnedDispatcher } from "../server/lib/ssrf-jail";
import { readEffectiveVerifierMemory } from "../server/lib/verifier-memory-source";
import { canStartVerifierWorker } from "../server/lib/bounded-verifier-worker";
import { stageVerifierSource } from "../server/lib/workspace-verifier-source";
import {
  signWorkspaceRequest, validateWorkspaceSnapshot, WORKSPACE_VERIFIER_PREFIX,
  MAX_WORKSPACE_VERIFIER_BYTES, type WorkspaceProposalSnapshot,
} from "../server/lib/workspace-verifier-contract";
import { verifyWorkspaceSnapshotIsolated } from "../server/lib/proposal-verifier-process";
import type { VerifyResult } from "../server/proposal-verifier";

export interface WorkspaceTickDependencies {
  ready(): boolean;
  claim(requestId: string): Promise<{ state: string; snapshot?: WorkspaceProposalSnapshot }>;
  stage(hash: string): { root: string; cleanup(): void };
  verify(snapshot: WorkspaceProposalSnapshot, root: string): Promise<VerifyResult>;
  settle(input: { snapshot: WorkspaceProposalSnapshot; result?: VerifyResult; deferred?: string }): Promise<unknown>;
  stopping(): boolean;
}

export async function runWorkspaceVerificationTick(deps: WorkspaceTickDependencies): Promise<string> {
  if (!deps.ready()) return "waiting_for_memory";
  const claimed = await deps.claim(randomUUID());
  if (claimed.state !== "claimed") return claimed.state;
  const snapshot = validateWorkspaceSnapshot(claimed.snapshot);
  let staged: ReturnType<WorkspaceTickDependencies["stage"]>;
  try { staged = deps.stage(snapshot.contextSha256); } catch {
    await deps.settle({ snapshot, deferred: "source" });
    return "source_deferred";
  }
  try {
    let result: VerifyResult;
    try { result = await deps.verify(snapshot, staged.root); } catch {
      await deps.settle({ snapshot, deferred: deps.stopping() ? "shutdown" : "indeterminate" });
      return "execution_deferred";
    }
    await deps.settle({ snapshot, result });
    return `verified_${result.status}`;
  } finally { staged.cleanup(); }
}

async function main(): Promise<void> {
  if (process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED !== "1") throw new Error("Workspace verification disabled");
  const key = process.env.REPAIR_HANDOFF_HMAC_KEY ?? "";
  const origin = new URL(process.env.PROPOSAL_VERIFIER_ORIGIN_URL ?? "");
  if (key.length < 16 || origin.protocol !== "https:" || origin.username || origin.password
    || origin.port || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Workspace verifier provisioning unavailable");
  }
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  const request = async (action: "claim" | "settle", value: unknown) => {
    const pathname = `${WORKSPACE_VERIFIER_PREFIX}/${action}`;
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_WORKSPACE_VERIFIER_BYTES) throw new Error("Request too large");
    // Same request identity/outcome on one bounded retry; never retry new work
    // after an ambiguous acknowledgement.
    for (let attempt = 0; attempt < 2; attempt++) {
      const safe = await ssrfSafeUrl(new URL(pathname, origin).toString());
      if (!safe.ok) throw new Error("Unsafe verifier origin");
      const dispatcher = pinnedDispatcher(safe.addresses);
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 15_000);
      try {
        const timestamp = Date.now();
        const response = await safeFetch(safe.url, {
          method: "POST", redirect: "error", dispatcher,
          signal: action === "claim" ? AbortSignal.any([timeout.signal, stop.signal]) : timeout.signal,
          headers: {
            "content-type": "application/json",
            "x-verifier-timestamp": String(timestamp),
            "x-verifier-signature": signWorkspaceRequest(key, pathname, body, timestamp),
          },
          body,
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) throw new Error("awaiting_publication");
          throw new Error("handoff_unavailable");
        }
        let bytes = 0;
        const parts: Uint8Array[] = [];
        if (!response.body) throw new Error("Empty handoff response");
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > MAX_WORKSPACE_VERIFIER_BYTES) throw new Error("Response too large");
          parts.push(chunk);
        }
        return JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch (error) {
        if (error instanceof Error && error.message === "awaiting_publication") throw error;
        if (action === "claim" && stop.signal.aborted) throw new Error("handoff_stopped");
        if (attempt === 1) throw new Error("handoff_unavailable");
      } finally {
        clearTimeout(timer);
        await dispatcher.destroy();
      }
    }
    throw new Error("handoff_unavailable");
  };
  let lastState = "";
  while (!stop.signal.aborted && process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED === "1") {
    let state: string;
    try {
      state = await runWorkspaceVerificationTick({
        ready: () => canStartVerifierWorker(readEffectiveVerifierMemory(), process.memoryUsage().rss),
        claim: id => request("claim", { requestId: id }),
        stage: hash => stageVerifierSource(process.cwd(), hash),
        verify: (snapshot, root) => verifyWorkspaceSnapshotIsolated(snapshot, root, stop.signal),
        settle: input => request("settle", input),
        stopping: () => stop.signal.aborted,
      });
    } catch (error) {
      state = error instanceof Error && error.message === "awaiting_publication"
        ? "awaiting_publication" : "handoff_unavailable";
    }
    if (state !== lastState) {
      console.info(`[workspace-verifier] state=${state}`);
      lastState = state;
    }
    if (!stop.signal.aborted) await sleep(60_000, undefined, { signal: stop.signal }).catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    console.error("[workspace-verifier] stopped; check flag, origin, key provisioning and compiler assets");
    process.exitCode = 1;
  });
}
