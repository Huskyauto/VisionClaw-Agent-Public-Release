// Verifies attachInstantPlayUrls auto-populates watch_url/download_url on
// any tool whose result has a local media file_path. Uses generate_audio
// (fast: TTS a short phrase) so we don't have to wait for video render.

async function main() {
  const { executeTool } = await import("../server/tools");
  console.log("Calling generate_audio with a short phrase...");
  const result: any = await executeTool("generate_audio", {
    text: "Test of the instant play attachment helper.",
    voice: "alloy",
    voice_provider: "openai",
    _tenantId: 1,
  });

  console.log("\n=== RESULT (top-level keys) ===");
  console.log(Object.keys(result || {}));
  console.log("\n=== watch_url ===", result?.watch_url || "(missing)");
  console.log("=== download_url ===", result?.download_url || "(missing)");
  console.log("=== file_path ===", result?.file_path || "(missing)");
  console.log("=== instructions ===\n" + (result?.instructions || "(missing)"));

  if (result?.watch_url) {
    console.log("\n=== HEAD test ===");
    const head = await fetch(result.watch_url.replace("/watch/", "/v/"), { method: "HEAD" });
    console.log(`HEAD → ${head.status}, CT=${head.headers.get("content-type")}, CL=${head.headers.get("content-length")}, AR=${head.headers.get("accept-ranges")}`);
    console.log("\n=== /watch/ test ===");
    const w = await fetch(result.watch_url);
    const html = await w.text();
    console.log(`GET → ${w.status} (${html.length} bytes), has <audio>=${html.includes("<audio")}`);
  }

  console.log(result?.watch_url ? "\nPASS — watch_url auto-attached" : "\nFAIL — watch_url missing");
  process.exit(result?.watch_url ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
