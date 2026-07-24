/**
 * One-off / reusable: fetch a single named photo from Bob's BWB Drive drop-folder
 * and save it locally so it can be slotted into a recap scene as a real image.
 *
 * Usage:
 *   PHOTO_NAME=connie-therese-dinner.jpg npx tsx scripts/fetch-bwb-photo.ts
 *   PHOTO_NAME=foo.jpg DEST=data/youtube/photos/foo.jpg npx tsx scripts/fetch-bwb-photo.ts
 *
 * Exit codes: 0 = downloaded, 2 = not found, 3 = bad config, 1 = other failure.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { driveJson, driveRequest } from "../server/google-drive";
import { BWB_DRIVE_FOLDER_ID } from "./lib/drive-discover";

const PHOTO_ROOT = path.resolve("data/youtube/photos");

/**
 * Resolve a download destination, bounded to PHOTO_ROOT. Rejects absolute paths
 * and any `..` traversal that would escape the allowlisted root. Returns the
 * absolute path on success, or null if the candidate escapes the root.
 */
export function resolveDest(candidate: string): string | null {
  // Strip any directory components from a bare PHOTO_NAME-derived default is not
  // needed (it's already basename); for an operator-supplied DEST we resolve and
  // verify containment under PHOTO_ROOT.
  const abs = path.resolve(PHOTO_ROOT, candidate);
  const rel = path.relative(PHOTO_ROOT, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

async function main() {
  const rawPhotoName = (process.env.PHOTO_NAME || "").trim();
  if (!rawPhotoName) {
    console.error("[fetch-bwb-photo] PHOTO_NAME env var is required (exact filename in the Drive folder).");
    process.exit(3);
  }
  // The Drive lookup uses the exact name; the local write uses basename-only so a
  // crafted PHOTO_NAME can't steer the write outside PHOTO_ROOT.
  const photoName = rawPhotoName;
  const safeName = path.basename(rawPhotoName);
  const folderId = process.env.BWB_DRIVE_FOLDER_ID || BWB_DRIVE_FOLDER_ID;
  const destCandidate = (process.env.DEST || safeName).trim();
  const dest = resolveDest(destCandidate);
  if (!dest) {
    console.error(`[fetch-bwb-photo] DEST "${destCandidate}" escapes the allowed root ${PHOTO_ROOT}. Use a path under data/youtube/photos.`);
    process.exit(3);
  }

  const q = `'${folderId}' in parents and trashed=false and name='${photoName.replace(/'/g, "\\'")}'`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
  const ep =
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
    `&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const data = await driveJson(ep);
  const files: any[] = data.files || [];
  if (files.length === 0) {
    console.error(`[fetch-bwb-photo] No file named "${photoName}" in folder ${folderId}. Check the name (lowercase, hyphens) and that the upload finished.`);
    process.exit(2);
  }
  // Newest match wins if there are dupes.
  files.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
  const f = files[0];
  console.log(`[fetch-bwb-photo] match: ${f.name} (${f.mimeType}, id ${f.id})`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const resp = await driveRequest(`/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`);
  if (!resp.ok || !resp.body) {
    console.error(`[fetch-bwb-photo] download failed: ${resp.status} ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(dest));
  const bytes = fs.statSync(dest).size;
  if (bytes <= 0) {
    console.error("[fetch-bwb-photo] downloaded file is empty");
    process.exit(1);
  }
  console.log(`[fetch-bwb-photo] saved ${bytes} bytes → ${dest}`);
}

const isEntrypoint =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((e) => {
    console.error("[fetch-bwb-photo] error:", e?.message || e);
    process.exit(1);
  });
}
