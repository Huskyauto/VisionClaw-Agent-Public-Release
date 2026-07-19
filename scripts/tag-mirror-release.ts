#!/usr/bin/env tsx
/**
 * Tag + Release the public mirror snapshot (Kimi-K3 review finding #5:
 * "no tags, no GitHub Releases — people can't git bisect or diff snapshots").
 *
 * For each mirror push this script:
 *   1. Derives the current R-round from replit.md (first Recent-rounds bullet),
 *      e.g. "R125+137.28" → tag "r125.137.28" / version "125.137.28".
 *   2. Points refs/tags/<tag> at the public repo's current main HEAD via the
 *      GitHub git-refs API (create, or force-update if the tag exists — a
 *      re-push of the same round moves the tag to the fixed snapshot).
 *   3. Creates (or updates) a GitHub Release for the tag with the round's
 *      one-liner from replit.md as the body.
 *
 * Operator contract: one-line runnable, no prompts, env-configured.
 *   GITHUB_PERSONAL_ACCESS_TOKEN_2  (required) — classic PAT, repo scope
 *   PUBLIC_REPO                     (default Huskyauto/VisionClaw-Agent-Public-Release)
 *   MIRROR_TAG                      (optional) — override the derived tag
 * Exit codes: 0 = tagged+released, 1 = config/derive failure, 2 = GitHub API failure.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// CLI contract: --dry-run (derive + log planned tag/release, NO GitHub writes)
// is the ONLY accepted flag. Any other flag is an operator error → exit 1
// (incident 2026-07-17: an unrecognized --dry-run was silently ignored and a
// LIVE tag+release shipped; unknown flags must never fall through to a live run).
const KNOWN_FLAGS = new Set(["--dry-run"]);
const cliArgs = process.argv.slice(2);
const unknown = cliArgs.filter((a) => !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
  console.error(`[tag-mirror-release] ✗ unknown flag(s): ${unknown.join(" ")} — accepted: --dry-run`);
  process.exit(1);
}
const DRY_RUN = cliArgs.includes("--dry-run");

const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || "";
const REPO = process.env.PUBLIC_REPO || "Huskyauto/VisionClaw-Agent-Public-Release";
const API = `https://api.github.com/repos/${REPO}`;

function fail(code: number, msg: string): never {
  console.error(`[tag-mirror-release] ✗ ${msg}`);
  process.exit(code);
}

function deriveRound(): { tag: string; heading: string; body: string } {
  if (process.env.MIRROR_TAG) {
    return { tag: process.env.MIRROR_TAG, heading: process.env.MIRROR_TAG, body: "Manual tag (MIRROR_TAG override)." };
  }
  const full = readFileSync(resolve(process.cwd(), "replit.md"), "utf8");
  // Anchor to the "Recent rounds" section so an earlier R-bullet elsewhere in the
  // file can never win (architect robustness caveat, R125+137.29).
  const anchor = full.indexOf("**Recent rounds");
  const md = anchor >= 0 ? full.slice(anchor) : full;
  // First bullet under "Recent rounds": - **R125+137.28** (date) — prose...
  const m = md.match(/^- \*\*(R[\d.+]+)\*\* \(([^)]+)\) — ([\s\S]*?)(?=\n- \*\*R|\n\n)/m);
  if (!m) fail(1, "could not derive current round from replit.md Recent rounds — set MIRROR_TAG to override");
  const round = m[1]; // e.g. R125+137.28
  const tag = "r" + round.slice(1).replace(/\+/g, ".");
  const body = `**${round}** (${m[2]})\n\n${m[3].trim()}\n\n_Sanitized public snapshot — see docs/schema-snapshot.sql for the diffable schema DDL of this release._`;
  return { tag, heading: `${round} — public mirror snapshot`, body };
}

async function gh(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "visionclaw-mirror-release",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, json };
}

async function main() {
  if (!TOKEN) fail(1, "GITHUB_PERSONAL_ACCESS_TOKEN_2 not set");
  const { tag, heading, body } = deriveRound();

  const head = await gh(`/git/ref/heads/main`);
  if (head.status !== 200 || !head.json?.object?.sha) fail(2, `cannot read main HEAD (HTTP ${head.status})`);
  const sha: string = head.json.object.sha;
  console.log(`[tag-mirror-release] ${REPO}@${sha.slice(0, 8)} → tag ${tag}`);

  if (DRY_RUN) {
    console.log(`[tag-mirror-release] DRY RUN — would tag ${tag} @ ${sha.slice(0, 8)} and create/update release "${heading}". No writes performed.`);
    return;
  }

  // Create or force-move the lightweight tag ref.
  const create = await gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }) });
  if (create.status === 201) {
    console.log(`[tag-mirror-release] ✓ tag ${tag} created`);
  } else if (create.status === 422) {
    const upd = await gh(`/git/refs/tags/${tag}`, { method: "PATCH", body: JSON.stringify({ sha, force: true }) });
    if (upd.status !== 200) fail(2, `tag exists but update failed (HTTP ${upd.status}): ${JSON.stringify(upd.json)}`);
    console.log(`[tag-mirror-release] ✓ tag ${tag} moved to current snapshot`);
  } else {
    fail(2, `tag create failed (HTTP ${create.status}): ${JSON.stringify(create.json)}`);
  }

  // Create or update the Release for this tag.
  const existing = await gh(`/releases/tags/${tag}`);
  if (existing.status === 200 && existing.json?.id) {
    const upd = await gh(`/releases/${existing.json.id}`, { method: "PATCH", body: JSON.stringify({ name: heading, body }) });
    if (upd.status !== 200) fail(2, `release update failed (HTTP ${upd.status})`);
    console.log(`[tag-mirror-release] ✓ release updated: ${upd.json?.html_url ?? tag}`);
  } else {
    const rel = await gh(`/releases`, {
      method: "POST",
      body: JSON.stringify({ tag_name: tag, name: heading, body, draft: false, prerelease: false }),
    });
    if (rel.status !== 201) fail(2, `release create failed (HTTP ${rel.status}): ${JSON.stringify(rel.json)}`);
    console.log(`[tag-mirror-release] ✓ release created: ${rel.json?.html_url ?? tag}`);
  }
}

main().catch((e) => fail(2, String(e?.message ?? e)));
