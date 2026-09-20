import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

async function getReplitConnectorToken(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;
  if (!hostname || !xReplitToken) throw new Error("Replit connector env missing");
  const r = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=google-drive`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
  );
  const j: any = await r.json();
  const item = j.items?.[0];
  const tok = item?.settings?.access_token || item?.settings?.oauth?.credentials?.access_token;
  if (!tok) throw new Error("No google-drive access_token from connector: " + JSON.stringify(j).slice(0, 300));
  return tok;
}

async function main() {
  const driveIds = ["17YL_vuSBAFjDdetnGkBl1_c_3xBexgJo", "1wAKQIFUFu80bkX0wKMBNYIaRzApeEIbe"];
  const accessToken = await getReplitConnectorToken();
  const PUBLIC_VIDEOS_DIR = path.resolve(process.cwd(), "public", "videos");
  fs.mkdirSync(PUBLIC_VIDEOS_DIR, { recursive: true });
  const baseUrl = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  console.log("Base URL:", baseUrl);

  const results: any[] = [];
  for (const id of driveIds) {
    const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!dl.ok) { console.error(`Drive download ${id} → ${dl.status}: ${await dl.text()}`); continue; }
    const buf = Buffer.from(await dl.arrayBuffer());
    const tok = crypto.randomBytes(16).toString("hex");
    const publicName = `${tok}.mp4`;
    const dest = path.join(PUBLIC_VIDEOS_DIR, publicName);
    fs.writeFileSync(dest, buf);
    results.push({
      driveId: id,
      bytes: buf.length,
      watchUrl: `${baseUrl}/watch/${publicName}`,
      mediaUrl: `${baseUrl}/v/${publicName}`,
    });
  }

  console.log("\n=== HEALED ===");
  for (const r of results) console.log(JSON.stringify(r, null, 2));

  if (results.length > 0) {
    console.log("\n=== TESTING /v/ ===");
    const head = await fetch(results[0].mediaUrl, { method: "HEAD" });
    console.log(`HEAD → ${head.status}, CT=${head.headers.get("content-type")}, CL=${head.headers.get("content-length")}, AR=${head.headers.get("accept-ranges")}`);
    const rng = await fetch(results[0].mediaUrl, { headers: { Range: "bytes=0-99" } });
    console.log(`Range 0-99 → ${rng.status}, CR=${rng.headers.get("content-range")}, CL=${rng.headers.get("content-length")}`);

    console.log("\n=== TESTING /watch/ ===");
    const w = await fetch(results[0].watchUrl);
    const html = await w.text();
    console.log(`GET → ${w.status} (${html.length} bytes)`);
    console.log("Has <video>:", html.includes("<video"));
    console.log("Has /v/ link:", html.includes("/v/"));

    console.log("\n=== LINKS FOR BOB (tap on phone) ===");
    results.forEach((r, i) => console.log(`\nFile ${i + 1}: ${r.watchUrl}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
