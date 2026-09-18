/**
 * Tools-layer-split S24 — middleware extraction, phase 4 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the instant-play layer out of `executeTool`
 * (server/tools.ts) — ZERO behavior change. Synchronously publishes any
 * local-media tool result to the public instant-play route and attaches
 * watch_url/download_url + a presentation hint the calling agent reads top-down.
 * Idempotent: if a tool already set watch_url (produce_video does) we don't
 * overwrite. Two-gate safety preserved verbatim:
 *   GATE 1 — tool is a customer-deliverable (in PRODUCT_OUTPUT_TOOLS) OR the
 *            caller opts in via params._publishInstantPlay === true.
 *   GATE 2 — file path resolves under an allowed customer-deliverable root and
 *            NOT under any forbidden internal/source/secret root.
 *
 * `isInstantPlayPathSafe` stays EXPORTED (server/tools.ts re-exports it) because
 * scripts/test-instant-play-gates.ts imports it via `import("../server/tools")`.
 *
 * App-graph deps (`instant-play` publisher, `tool-registry` allowlist) are
 * pulled via call-time dynamic imports that mirror the previous lazy loads and
 * keep this module free of a static edge into the app graph (acyclicity
 * invariant — data/feature-contracts/tools-layer-split/spec.md). The
 * PRODUCT_OUTPUT_TOOLS allowlist is deterministic from the registry, so
 * computing it lazily-memoized on first call is behavior-identical to the prior
 * module-load-time `getProductOutputTools()`.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import path from "node:path";

const MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg|aac)$/i;
// Roots that are SAFE to publish from. Order matters only for readability.
const INSTANT_PLAY_ALLOWED_ROOTS = [
  "project-assets",
  "deliverables",
  "exports",
  "public",
  "uploads",
  "tmp/playwright-mcp-output",
];
// Roots that MUST NEVER be published (internal/source/secret/cache).
const INSTANT_PLAY_FORBIDDEN_ROOTS = [
  ".local", ".agents", ".cache", ".replit", ".env",
  "attached_assets", "server", "client", "shared", "scripts",
  "node_modules", "data", "logs", "stress-test-output",
];

// Lazily-memoized customer-deliverable allowlist. Deterministic from the
// registry, so first-call computation is behavior-identical to the prior
// module-load-time const in tools.ts — and dynamic-importing tool-registry
// here keeps the acyclicity invariant.
let _productOutputTools: Set<string> | null = null;
async function getProductOutputToolSet(): Promise<Set<string>> {
  if (_productOutputTools) return _productOutputTools;
  const { getProductOutputTools } = await import("../../tool-registry");
  _productOutputTools = getProductOutputTools();
  return _productOutputTools;
}

export function isInstantPlayPathSafe(absOrRel: string): boolean {
  // Resolve to an absolute path FIRST so any `..` traversal segments are
  // collapsed BEFORE we inspect the leading segment. Without resolve(),
  // `project-assets/../server/secret.mp4` would still appear to start with
  // a safe root. After resolve() it becomes `/cwd/server/secret.mp4`, which
  // path.relative reduces to `server/secret.mp4`, correctly forbidden.
  const cwd = process.cwd();
  let abs: string;
  let rel: string;
  try {
    abs = path.isAbsolute(absOrRel) ? path.resolve(absOrRel) : path.resolve(cwd, absOrRel);
    rel = path.relative(cwd, abs);
  } catch { return false; }
  // Reject anything that escapes the workspace (relative starts with ..).
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (rel.length === 0) return false;
  const segs = rel.split(path.sep).filter(Boolean);
  if (segs.length === 0) return false;
  const head = segs[0];
  // Forbidden first wins.
  if (INSTANT_PLAY_FORBIDDEN_ROOTS.includes(head)) return false;
  // Allow if any safe root prefix matches the leading segments. This handles
  // both single-segment entries (e.g. "project-assets") and multi-segment
  // prefixes (e.g. "tmp/playwright-mcp-output") so the MCP screenshot tool's
  // scratch dir can be published while the rest of /tmp stays denied.
  for (const root of INSTANT_PLAY_ALLOWED_ROOTS) {
    const rootSegs = root.split("/").filter(Boolean);
    if (rootSegs.length === 0) continue;
    if (rootSegs.length > segs.length) continue;
    let match = true;
    for (let i = 0; i < rootSegs.length; i++) {
      if (segs[i] !== rootSegs[i]) { match = false; break; }
    }
    if (match) return true;
  }
  // /tmp paths: only the playwright-mcp-output subroot is allowed (handled above).
  if (head === "tmp") return false;
  // Default DENY for anything else (e.g. random /home/runner paths, sibling
  // workspaces, /var/, /etc/, etc.). Customer-facing tools always write under
  // one of the allowlisted roots.
  return false;
}

export async function attachInstantPlayUrls(toolName: string, result: any, params?: Record<string, any>): Promise<any> {
  try {
    if (!result || typeof result !== "object" || Array.isArray(result)) return result;
    if (result.error) return result;
    // Already populated by the tool itself (e.g. produce_video) — preserve.
    if (result.watch_url) return result;
    const filePath: string | undefined =
      result.file_path || result.filePath || result.local_path || result.localPath || result.output_path || result.outputPath;
    if (!filePath || typeof filePath !== "string") return result;
    if (!MEDIA_EXT_RE.test(filePath)) return result;

    // GATE 1: tool must be a customer-deliverable, OR explicit per-call opt-in.
    const isCustomerDeliverable = (await getProductOutputToolSet()).has(toolName);
    const explicitOptIn = params?._publishInstantPlay === true;
    if (!isCustomerDeliverable && !explicitOptIn) {
      console.log(`[instant-play] gate1 skip ${toolName}: not in PRODUCT_OUTPUT_TOOLS and no _publishInstantPlay opt-in`);
      return result;
    }
    // GATE 2: file path must be under a safe root (no .local/, server/, etc.).
    if (!isInstantPlayPathSafe(filePath)) {
      console.log(`[instant-play] gate2 skip ${toolName}: filePath "${filePath.slice(0, 120)}" not under an allowed customer-deliverable root`);
      return result;
    }

    // R74.13z-quint+10c (architect-fix): use the async sibling so we don't
    // block the Node event loop while a 50-500MB video is copied byte-for-byte.
    // Existence check is folded into publishMediaForInstantPlayAsync via fs.promises.stat.
    const { publishMediaForInstantPlayAsync } = await import("../../instant-play");
    const ip = await publishMediaForInstantPlayAsync({ filePath });
    if (!ip) return result;

    result.watch_url = ip.watchUrl;
    result.download_url = `${ip.mediaUrl}?dl=1`;

    // Build / merge a clear presentation hint. If the tool already wrote an
    // `instructions` field (produce_video does), prepend our line so the
    // watch URL is what the agent reads first. Otherwise create one.
    const hintLines = [
      `Watch instantly: ${result.watch_url}`,
      `Download to your device: ${result.download_url}`,
    ];
    if (result.drive_url) hintLines.push(`Open in Google Drive: ${result.drive_url}`);
    const hint = `Media ready. Present these to the end user in this exact priority order (DO NOT swap or omit the watch link, and DO NOT use the Drive link as the primary — Drive previews can take 5-30+ minutes to start playing):\n  1. ${hintLines[0]}\n  2. ${hintLines[1]}${hintLines[2] ? `\n  3. ${hintLines[2]}` : ""}`;
    if (typeof result.instructions === "string" && result.instructions.length > 0) {
      // Already had instructions (e.g. produce_video). Don't double-write —
      // produce_video already builds a good one with our URLs.
    } else {
      result.instructions = hint;
    }
    console.log(`[instant-play] auto-attached watch_url to ${toolName} result → ${ip.watchUrl}`);
  } catch (err: any) {
    // Never let this break a tool result.
    console.warn(`[instant-play] attachInstantPlayUrls(${toolName}) failed: ${err?.message || err}`);
  }
  return result;
}
