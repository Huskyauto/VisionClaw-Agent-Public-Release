/**
 * spawn-env-guard.ts — loader-hijack denylist for child_process spawns.
 *
 * Ported pattern from ruvnet/ruflo `ruflo-aidefence` ADR-095 defense-in-depth
 * pairing (2026). Adding any of these env vars to a child process is
 * functionally remote code execution: the dynamic linker (ld.so / dyld) or
 * the Node loader will load attacker-controlled shared libraries / modules /
 * flags into the new process BEFORE any of our code runs.
 *
 * Two surfaces:
 *   - `assertSafeSpawnEnv(env, ctx)` — throws if any denylisted key is present
 *     (fail-closed; for caller-supplied env objects).
 *   - `sanitizeSpawnEnv(env)` — returns a shallow copy with denylisted keys
 *     stripped (lossy; for environments where we want to inherit `process.env`
 *     but defensively scrub it).
 *
 * Note: VC's `server/claude-runner.ts:buildSafeEnv()` already uses an
 * ENV_ALLOWLIST, which is the strongest form of this protection. The helpers
 * here are for spawn sites that pass `env` as a delta on top of `process.env`
 * (the default child_process behavior) — `server/research-engine.ts` proposal
 * compile + `scripts/*` spawns being the obvious surface.
 *
 * If `NODE_PATH` ever needs to be on an allowlist (npx legitimately uses it),
 * pin it to the project-controlled path; never inherit it from process.env.
 */

export const LOADER_HIJACK_DENYLIST: readonly string[] = Object.freeze([
  // ELF (Linux) dynamic linker hijacks
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  // Mach-O (macOS) dynamic linker hijacks
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "DYLD_FORCE_FLAT_NAMESPACE",
  // Node.js loader / module-search hijacks
  "NODE_OPTIONS",
  "NODE_PATH",
  // Mixed-runtime module-path hijacks (R125+13.19+sec1, architect HIGH).
  // VC is Node-first but shells out to npx/git/ffmpeg/lsof and may invoke
  // Python/Perl/Ruby/Lua tools via skills. Strip these defensively so a
  // single misclassified child can't silently load attacker-controlled libs.
  "PERL5LIB", "PERLLIB", "PERL5OPT",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
  "RUBYLIB", "RUBYOPT",
  "GEM_PATH", "GEM_HOME",
  "LUA_PATH", "LUA_CPATH",
  "BUN_OPTIONS", "BUN_INSTALL",
  "DENO_DIR", "DENO_INSTALL_ROOT",
]);

const DENYLIST_SET = new Set(LOADER_HIJACK_DENYLIST);

/**
 * True if `key` is a loader-hijack vector. Catches the explicit denylist AND
 * ANY key prefixed `LD_` / `DYLD_` (case-insensitive) — the dynamic-linker
 * knob space is open-ended (e.g. DYLD_VERSIONED_LIBRARY_PATH, LD_PROFILE), so
 * an enumerated list is bypassable. Prefix-strip the whole namespace.
 */
export function isLoaderHijackKey(key: string): boolean {
  if (DENYLIST_SET.has(key)) return true;
  return /^(LD_|DYLD_)/i.test(key);
}

export class SpawnEnvHijackError extends Error {
  readonly hijackedKeys: string[];
  readonly context: string;
  constructor(hijackedKeys: string[], context: string) {
    super(
      `[spawn-env-guard] Refusing to spawn child process with loader-hijack env keys present: ${hijackedKeys.join(", ")} (context: ${context}). ` +
      `These keys (LD_*, DYLD_*, NODE_OPTIONS, NODE_PATH) let a caller load arbitrary code into the child before our code runs — functionally RCE. ` +
      `Use sanitizeSpawnEnv() or an explicit allowlist (see server/claude-runner.ts buildSafeEnv).`
    );
    this.name = "SpawnEnvHijackError";
    this.hijackedKeys = hijackedKeys;
    this.context = context;
  }
}

/**
 * Fail-closed check: throws SpawnEnvHijackError if any denylisted key is
 * present in `env`. Pass the env object you're about to hand to
 * child_process.spawn / spawnSync / execFile (NOT execSync with a shell
 * string — those have a different threat model). `ctx` should be a short
 * identifier of the call site, e.g. "research-engine:proposal-compile".
 */
export function assertSafeSpawnEnv(
  env: NodeJS.ProcessEnv | undefined | null,
  ctx: string,
): void {
  if (!env) return;
  const hit = Object.keys(env).filter((k) => isLoaderHijackKey(k));
  if (hit.length > 0) {
    throw new SpawnEnvHijackError(hit, ctx);
  }
}

/**
 * Returns a shallow copy of `env` (defaulting to `process.env`) with every
 * denylisted key removed. Use when the caller wants to inherit the parent
 * environment but defensively scrub loader-hijack vectors first.
 *
 * Pairs naturally with `process.env`:
 *   const cleanEnv = sanitizeSpawnEnv(process.env);
 *   spawnSync(cmd, args, { env: cleanEnv, shell: false });
 */
export function sanitizeSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (isLoaderHijackKey(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Reports whether any denylisted key is present in `env`. Useful for telemetry
 * or test assertions without throwing.
 */
export function detectLoaderHijackKeys(
  env: NodeJS.ProcessEnv | undefined | null,
): string[] {
  if (!env) return [];
  return Object.keys(env).filter((k) => isLoaderHijackKey(k));
}
