# Review request: a cross-process "production priority" file lock

**Is the residual concurrency edge acceptable, or is there a simple primitive I'm missing?**

## Context

Node.js / TypeScript on Linux (Replit). I have ~6 independent node processes (separate scheduled workflows). One is a **producer** (a weekly video render). When the producer is running, the other 5 **maintenance** jobs must stand down and wait, then resume. They don't share memory, so I coordinate via a single lockfile.

**The one non-negotiable property: FAIL OPEN.** A permanently-wedged maintenance system is far worse than transient contention. So staleness is detected two ways (TTL expiry AND a dead-pid probe), waiters cap their wait then proceed, and any fs/parse error is treated as "no lock held → proceed." There must be NO path that blocks forever.

**Deployment reality:** the only acquirer is ONE weekly scheduled job, so concurrent producers essentially never happen. Locks are never refreshed in-place (TTL is fixed at acquire time). My internal code-review agent nonetheless keeps constructing deeper concurrent-producer interleavings that can momentarily lose single-owner exclusivity.

## Helpers

```ts
const LOCK_PATH = path.join(LOCK_DIR, "production-priority.lock");
interface LockData { label: string; pid: number; token: string; startedAt: number; expiresAt: number; }

function readLock(): LockData | null {
  try {
    const d = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as LockData;
    if (!d || typeof d.expiresAt !== "number" || typeof d.pid !== "number") return null;
    return d;
  } catch { return null; } // missing/corrupt => not held (fail open)
}
function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e?.code === "EPERM"; } // EPERM=alive, ESRCH=dead
}
function isProductionActive(): boolean {
  const d = readLock();
  if (!d) return false;
  if (Date.now() > d.expiresAt) return false;   // TTL backstop
  if (!pidAlive(d.pid)) return false;            // holder died
  return true;
}
```

## Acquire (the code under review)

```ts
const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const data: LockData = { label, pid: process.pid, token, startedAt: Date.now(), expiresAt: Date.now()+ttlMs };

let owns = false, standAside = false;
for (let attempt = 0; attempt < 6 && !owns && !standAside; attempt++) {
  // 1) create fresh — atomic create-if-absent
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    try { fs.writeFileSync(fd, JSON.stringify(data), "utf8"); } finally { fs.closeSync(fd); }
    owns = true; break;
  } catch (e: any) {
    if (e?.code !== "EEXIST") { /* proceed unlocked, fail open */ return () => {}; }
  }
  // 2) a lock exists & is genuinely active → stand aside, never own/free another's lock
  if (isProductionActive()) { standAside = true; break; }
  // 3) stale/dead/corrupt → atomically CLAIM it via rename (single winner; losers get ENOENT)
  const claimPath = `${LOCK_PATH}.claim.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try { fs.renameSync(LOCK_PATH, claimPath); }
  catch { continue; } // someone else claimed/freed it — re-contend
  // verify what we claimed really was stale
  let claimedActive = false;
  try {
    const c = JSON.parse(fs.readFileSync(claimPath, "utf8")) as LockData;
    claimedActive = !!c && typeof c.expiresAt==="number" && Date.now()<=c.expiresAt
                 && typeof c.pid==="number" && pidAlive(c.pid);
  } catch {}
  if (claimedActive) {
    // we accidentally moved a now-FRESH lock (a producer raced one in during the gap).
    // restore ONLY if slot still free (conditional wx, never an unconditional move/clobber)
    let restored = false;
    try {
      const rfd = fs.openSync(LOCK_PATH, "wx");
      try { fs.writeFileSync(rfd, fs.readFileSync(claimPath)); } finally { fs.closeSync(rfd); }
      restored = true;
    } catch { /* a newer holder already owns the slot → leave intact */ }
    if (restored) { try { fs.unlinkSync(claimPath); } catch {} } // only discard if restored
    standAside = true; break;
  }
  try { fs.unlinkSync(claimPath); } catch {} // stale discarded; loop to re-contend wx
}
if (standAside) return () => {};
if (!owns) { /* exhausted retries → proceed unlocked, fail open */ return () => {}; }

let released = false;
const release = () => {
  if (released) return; released = true;
  try { const cur = readLock(); if (cur && cur.token === token) fs.unlinkSync(LOCK_PATH); } catch {}
};
process.once("exit", release); // + SIGINT/SIGTERM hooks
return release;
```

## The residual race my reviewer flagged

(Requires 3 concurrent producers A/B/C — which can't happen with one weekly job.)

1. A sees stale, enters claim path.
2. B wins stale takeover, creates fresh active lock `LB` at `LOCK_PATH`.
3. A does `rename(LOCK_PATH→claimPath)`, moving `LB` off-path.
4. C wins `open(wx)`, creates `LC` at `LOCK_PATH`.
5. A's restore gets `EEXIST` (LC present), so A leaves `claimPath` (holding LB's bytes). Net: B's representation is orphaned at a private path; `LC` is authoritative. B's own `release()` token-mismatches `LC` → no-op. So if B finishes *after* `LC`, fine; but B's lock is effectively lost — maintenance could resume relative to B early.

Every failure here is in the **fail-open direction** (maintenance resumes early = transient contention, never a wedge).

## My questions

1. Given the deployment (single weekly producer, locks never refreshed in-place, fail-open prioritized over wedge), is accepting this residual the right engineering call — or am I over/under-thinking it?
2. Is there a **plain-`fs`** (no native addons) protocol that gives true single-owner exclusivity AND fail-open staleness? Or is a real CAS primitive (`flock` via a tiny native dep / an O_EXCL generation-file scheme) genuinely required?
3. If you'd add a generation/CAS scheme, sketch the minimal version — I want the smallest change that makes exclusivity provable without sacrificing fail-open.
