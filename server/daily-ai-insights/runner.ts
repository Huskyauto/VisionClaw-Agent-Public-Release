import { AGENTS, LIMITS, ROOT, VERSION, localSlot, parseReport, sha, type Report } from "./core";
import { discover, emptyCursor } from "./intake";
import { assertOwner, createStore, type ReviewStore, type SavedReview } from "./store";
import { createDrive, type ReviewDrive } from "./drive";
import { collectEvidence, readCapabilities, renderReview, sectionExcerptLimit, sourceUrls, synthesize,
  type Capability, type Evidence } from "./review";
import { isProductionRuntime } from "../lib/runtime-env";

interface Options { smoke?: boolean; scheduled?: boolean }
interface Dependencies {
  store?: ReviewStore; drive?: ReviewDrive; now?: () => Date;
  evidence?: (urls: string[]) => Promise<Evidence[]>;
  capabilities?: () => Promise<Capability[]>; synthesize?: typeof synthesize;
}

export async function runReview(tenant: number, opts: Options = {}, deps: Dependencies = {}) {
  assertOwner(tenant);
  const slot = localSlot(deps.now?.() ?? new Date());
  if (opts.scheduled && (!isProductionRuntime() || !slot.due)) return { status: "not_due" };
  if (!opts.scheduled && !opts.smoke) throw new Error("Manual research runs are not enabled; use the bounded smoke");
  const store = deps.store ?? createStore(tenant, opts.smoke);
  const token = await store.claim(slot.day);
  if (!token) return { status: "paused_or_already_admitted" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.minutes * 60_000);
  timer.unref();
  const check = async () => {
    controller.signal.throwIfAborted();
    await store.check(token);
  };
  let stage = "drive_connection";
  try {
    const drive = deps.drive ?? await createDrive(tenant, controller.signal, work => store.effect(token, work));
    const deliverPrepared = async (id: number) => {
      const prepared = await store.review(id);
      if (!prepared.folderId) {
        stage = "date_folder";
        prepared.folderId = await drive.dateFolder(prepared.day);
        await store.attachDelivery(token, id, { folderId: prepared.folderId });
      }
      if (!prepared.outputId) {
        stage = "allocate_output";
        prepared.outputId = await drive.allocate();
        await store.attachDelivery(token, id, { outputId: prepared.outputId });
      }
      stage = "upload_readback";
      await check();
      await drive.deliver(prepared);
      await check();
      await store.complete(token, id);
      return { status: prepared.status, reviewId: id, outputId: prepared.outputId };
    };
    const state = await store.read();
    if (state.active?.reviewId) {
      return { ...await deliverPrepared(state.active.reviewId), recovered: true };
    }
    stage = "discovery";
    const cursor = state.cursor;
    if (!cursor.folders.length && !cursor.pending.length) {
      const next = emptyCursor(); next.sweep = cursor.sweep + 1;
      Object.assign(cursor, next);
    }
    await discover(cursor, async (...args) => { await check(); return drive.list(...args); },
      LIMITS.pages, async () => store.save(token, { cursor }));

    const warnings: string[] = (cursor.gaps ?? []).map(gap =>
      `${gap.id}: listing coverage gap (${gap.reason}); stale continuation retired, no report marked processed`);
    const reports: Report[] = [];
    let bytes = 0, reads = 0;
    const streamed = { remaining: LIMITS.bytes };
    // Examine only the initial queue, so a deferred entry cannot spin this run.
    const pending = [...cursor.pending];
    for (const f of pending) {
      await check();
      const prior = state.inventory[f.id];
      // Drive's checksum is byte-derived, not a filename/mtime shortcut.
      if (prior?.checksum && f.md5Checksum === prior.checksum) {
        cursor.pending = cursor.pending.filter(p => p.id !== f.id);
        continue;
      }
      if (reads >= LIMITS.reports || bytes >= LIMITS.bytes || streamed.remaining <= 0) break;
      reads++;
      try {
        stage = "report_read_parse";
        const before = streamed.remaining;
        const text = await drive.read(f, Math.min(LIMITS.bytes - bytes, before), streamed);
        if (Buffer.byteLength(text) > LIMITS.bytes - bytes) throw new Error("Combined text budget exceeded");
        // Injectable transports also obey the host budget even if they do not stream.
        if (streamed.remaining === before) streamed.remaining -= Buffer.byteLength(text);
        bytes += Buffer.byteLength(text);
        const r = parseReport(f, text);
        if (state.uncertainInputs?.some(p => p.digest === r.digest)) {
          warnings.push(`${f.id}: prior synthesis outcome uncertain; identical bytes will not be automatically retried`);
          cursor.pending = cursor.pending.filter(p => p.id !== f.id);
          continue;
        }
        // Always verify actual bytes if provider checksum did not prove a match.
        if (prior?.digest === r.digest) {
          cursor.pending = cursor.pending.filter(p => p.id !== f.id);
          continue;
        }
        if (prior && prior.digest !== r.digest) warnings.push(`${f.id}: changed bytes under an existing file ID; previous review ${prior.reviewId} retained`);
        reports.push(r);
      } catch (e) {
        // No processed receipt is written. Removing from this sweep prevents
        // one bad report starving the backlog; subsequent sweeps rediscover it.
        const message = e instanceof Error ? e.message : "";
        const category = message.startsWith("Google Drive HTTP") ? message :
          /budget|bounds/i.test(message) ? "text budget exceeded" :
          /metadata conflict/i.test(message) ? "filename/protocol/revision conflict" :
          /ancestry|outside|changed/i.test(message) ? "scope or file identity changed" : "malformed or unreadable report";
        warnings.push(`${f.id}: ${category}; not processed and will be rediscovered`);
        cursor.pending = cursor.pending.filter(p => p.id !== f.id);
      }
    }
    const conflicts = new Set<string>();
    for (const r of reports) {
      const peers = reports.filter(p => p.id !== r.id && p.reportId === r.reportId && p.revision === r.revision);
      const previous = Object.entries(state.inventory).filter(([id, p]) =>
        id !== r.id && p.reportId === r.reportId && p.revision === r.revision);
      if (peers.some(p => p.digest !== r.digest) || previous.some(([, p]) => p.digest !== r.digest)) conflicts.add(r.id);
    }
    for (const id of conflicts) {
      warnings.push(`${id}: conflicting file IDs claim the same report/revision with different bytes; no promotion or processed receipt`);
      cursor.pending = cursor.pending.filter(p => p.id !== id);
    }
    const eligible = reports.filter(r => !conflicts.has(r.id));
    for (const report of eligible.filter(report => report.status !== "complete")) {
      warnings.push(`Contributor coverage: ${report.id} research status ${report.status}; incomplete research is not a complete advisory review`);
    }
    const unique = eligible.filter((r, i, all) => all.findIndex(p => p.digest === r.digest) === i);
    for (const r of unique) {
      if (r.sections.some(s => s.length > sectionExcerptLimit(unique.length))) {
        warnings.push(`${r.id}: synthesis saw bounded section excerpts; omitted text is not verified`);
      }
    }
    await store.save(token, { cursor, errors: warnings.slice(0, 100) });
    const selectedIds = new Set(eligible.map(report => report.id));
    const residual = cursor.pending.filter(file => !selectedIds.has(file.id));
    if (residual.length || cursor.folders.length) {
      warnings.push(`Backlog: ${residual.length} known files and ${cursor.folders.length} listing continuations; sweep ${cursor.sweep} incomplete`);
    }
    // Contributor availability covers retained receipts too, not only today's newly changed inputs.
    const available = [...Object.values(state.inventory), ...eligible].filter(r => r.date === slot.day).map(r => r.agent);
    const missing = AGENTS.filter(agent => !available.includes(agent));
    let evidence: Evidence[] = [], capabilities: Capability[] = [];
    let synthesis: Awaited<ReturnType<typeof synthesize>> = {
      sections: Array.from({ length: 5 }, () => opts.smoke
        ? "Transport-only smoke: no news claim or research conclusion was evaluated."
        : "No new valid report was available in this bounded pass. No fresh verified development is asserted."),
      candidates: [], deferred: [],
    };
    if (unique.length && !opts.smoke) {
      await check();
      stage = "source_evidence";
      evidence = await (deps.evidence ?? collectEvidence)(sourceUrls(unique));
      if (!evidence.some(e => e.digest)) warnings.push("No cited source was retrieved successfully; report claims remain unverified");
      stage = "existing_capabilities";
      capabilities = await (deps.capabilities ?? readCapabilities)();
      await check();
      await store.reserveModel(token, eligible.map(r => ({ id: r.id, digest: r.digest })));
      stage = "synthesis";
      synthesis = await (deps.synthesize ?? synthesize)(tenant, unique, evidence, capabilities, controller.signal,
        work => store.effect(token, async () => { controller.signal.throwIfAborted(); return work(); }));
      synthesis.candidates = synthesis.candidates.map(c => ({
        ...c, evidenceHash: sha(JSON.stringify({ candidate: c.evidenceHash,
          root: ROOT, version: VERSION, inputs: eligible.map(r => ({ id: r.id, digest: r.digest, revision: r.revision, protocol: r.protocol })) })),
      }));
      warnings.push(...synthesis.deferred);
    }
    const markdown = renderReview({
      day: slot.day, reports: eligible, evidence, capabilities, ...synthesis, missing, warnings, smoke: !!opts.smoke,
    });
    await check();
    // Persist paid/completed intellectual work BEFORE any folder/API allocation.
    stage = "prepare_review";
    const saved: SavedReview = {
      day: slot.day, markdown, digest: sha(markdown), outputId: "", folderId: "",
      inputs: eligible.map(r => ({
        id: r.id, name: r.name, digest: r.digest, checksum: r.checksum, protocol: r.protocol,
        reportId: r.reportId, revision: r.revision, date: r.date, agent: r.agent,
      })),
      evidence, candidates: synthesis.candidates, missing,
      status: opts.smoke ? "smoke_verified" : !eligible.length ? warnings.length ? "input_errors_or_backlog" : "no_new_reports" :
        warnings.length || missing.length || evidence.some(e => !e.digest) ? "partial" : "reviewed_advisory",
      liveScheduled: !!opts.scheduled && isProductionRuntime(), smoke: !!opts.smoke,
    };
    const reviewId = await store.prepare(token, saved);
    return { ...await deliverPrepared(reviewId), root: ROOT, version: VERSION };
  } catch (e) {
    // Store only a bounded diagnostic, not provider response bodies/credentials.
    const message = e instanceof Error ? e.message : "";
    const known = /^(Google Drive HTTP \d+|Output byte read-back failed|Output identity\/parent mismatch|Daily insights paused or lease lost|Synthesis admission already consumed|Conflicting date folders|Drive response exceeded byte budget)$/.test(message);
    const category = known ? message : e instanceof SyntaxError ? "invalid_json_or_synthesis" :
      e instanceof Error && e.name === "ZodError" ? "synthesis_contract_rejected" :
      controller.signal.aborted ? "run_deadline_or_abort" :
      typeof (e as any)?.status === "number" ? `upstream_http_${Number((e as any).status)}` : "operation_failed";
    await store.fail(token, `${stage}: ${category}; diagnostic ${sha(message).slice(0, 12)}; prepared review retained when available`);
    throw e;
  } finally { clearTimeout(timer); controller.abort(); }
}
