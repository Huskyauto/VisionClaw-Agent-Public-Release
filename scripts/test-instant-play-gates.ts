// Negative-path tests for the R74.13z-quint+10c security gates on
// attachInstantPlayUrls. Imports the REAL isInstantPlayPathSafe() (now exported)
// so we don't drift from production logic.
//
// Coverage:
//   A) Tool NOT in PRODUCT_OUTPUT_TOOLS → must skip (gate1).
//   F) Allowlisted tool, safe root → must publish (gate1+gate2 happy path).
//   B-N) isInstantPlayPathSafe direct unit cases.

import { promises as fs } from "fs";
import path from "path";

async function ensureFile(relPath: string): Promise<string> {
  const abs = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from([0xFF, 0xFB, 0x90, 0x00])); // mp3 frame header
  return abs;
}

async function main() {
  const { executeTool, isInstantPlayPathSafe } = await import("../server/tools");

  console.log("\n=== TEST A: gate1 — non-allowlisted tool (read_file) reading a media file ===");
  const mediaInScratch = await ensureFile("project-assets/test_gate_A.mp3");
  const r_a: any = await executeTool("read_file", { path: mediaInScratch, _tenantId: 1 });
  const a_skipped = !r_a?.watch_url;
  console.log(`  read_file result keys: ${Object.keys(r_a || {}).slice(0, 10).join(",")}`);
  console.log(`  watch_url present? ${!!r_a?.watch_url} (expect: NO — gate1 should skip)`);
  console.log(`  ${a_skipped ? "PASS" : "FAIL"}`);

  console.log("\n=== TEST F: happy path — allowlisted tool, safe root ===");
  const r_f: any = await executeTool("generate_audio", {
    text: "Gate F test.",
    voice: "alloy",
    voice_provider: "openai",
    _tenantId: 1,
  });
  const f_published = !!r_f?.watch_url;
  console.log(`  generate_audio watch_url: ${r_f?.watch_url || "(missing)"}`);
  console.log(`  ${f_published ? "PASS" : "FAIL"}`);

  await fs.unlink(mediaInScratch).catch(() => {});

  console.log("\n=== TEST B-N: isInstantPlayPathSafe (REAL exported function) ===");
  const cases: Array<[string, string, boolean]> = [
    ["B (server/)", "server/private.mp4", false],
    ["C (.local/)", ".local/secrets.mp3", false],
    ["D (attached_assets/)", "attached_assets/upload.mov", false],
    ["E (absolute /etc/)", "/etc/passwd.mp3", false],
    ["E2 (absolute outside cwd)", "/var/log/foo.mp4", false],
    ["safe project-assets/", "project-assets/x.mp4", true],
    ["safe uploads/", "uploads/1/x.mp3", true],
    ["safe public/videos/", "public/videos/abc.mp4", true],
    ["safe deliverables/", "deliverables/y.mov", true],
    ["safe absolute under cwd", path.join(process.cwd(), "project-assets/z.mp4"), true],
    ["traversal escape blocked", "project-assets/../server/secret.mp4", false],
    ["empty", "", false],
    ["bare filename", "video.mp4", false],
    // Multi-segment allow root — was the architect-flagged regression.
    ["tmp/playwright-mcp-output/foo.mp4", "tmp/playwright-mcp-output/foo.mp4", true],
    ["tmp/playwright-mcp-output/sub/foo.mp4", "tmp/playwright-mcp-output/sub/foo.mp4", true],
    ["tmp/other still denied", "tmp/random.mp4", false],
    ["tmp alone denied", "tmp", false],
    // Confusable: forbidden root deeper in the path doesn't auto-allow.
    ["uploads/../server/leak.mp4 (traversal under safe root)", "uploads/../server/leak.mp4", false],
    // /tmp absolute outside workspace
    ["absolute /tmp/playwright-mcp-output/foo.mp4 (outside cwd)", "/tmp/playwright-mcp-output/foo.mp4", false],
  ];

  let allOk = true;
  for (const [label, p, expected] of cases) {
    const got = isInstantPlayPathSafe(p);
    const ok = got === expected;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: safe(${JSON.stringify(p)}) = ${got} (expected ${expected})`);
  }

  // === Opt-in cases (gate1 bypass via _publishInstantPlay) ===
  // We can't easily fabricate a non-allowlisted tool that returns a media path
  // without monkey-patching the registry, so this is a simulated assertion via
  // direct attachInstantPlayUrls — but that's not exported. Instead, document
  // the expected behavior in the gate1 read_file test above (which uses a SAFE
  // path but no opt-in → must skip), and the gate2 happy-path test in F.

  const overall = a_skipped && f_published && allOk;
  console.log(`\n=== OVERALL: ${overall ? "PASS" : "FAIL"} ===`);
  process.exit(overall ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
