/**
 * Built With Bob — robust batch photo fetcher for the weekly recap.
 *
 * Bob downloads photos (anniversary dinners, family, events, screenshots…) and
 * drops them into his BWB Google Drive drop-folder, then tells Felix the
 * filenames. This module finds each named asset ROBUSTLY and downloads it to
 * disk so the recap planner can slot it into the best-fitting scene.
 *
 * Why this exists separately from scripts/fetch-bwb-photo.ts: that CLI does an
 * EXACT single-name Drive query (`name='...'`), top-folder only, no HEIC. Real
 * phone photos are `IMG_4821.HEIC` in a subfolder with mixed case — so the
 * exact query returns nothing and the recap silently fell back to a generated
 * image. This fetcher is tolerant: it enumerates the folder + one level of
 * subfolders, matches case-insensitively (stem/contains/token fallback, in
 * ./bwb-photo-match), converts HEIC→JPG via ImageMagick, and FAILS LOUD
 * (listing what WAS found) when a named photo can't be located — never a silent
 * substitution.
 *
 * The pure matcher + env parser live in ./bwb-photo-match (no Drive/DB imports)
 * so they're unit-testable; they're re-exported here for callers' convenience.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { driveJson, driveRequest } from "../../server/google-drive";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import { BWB_DRIVE_FOLDER_ID } from "./drive-discover";
import { pickBestPhotoMatch, parseExtraPhotosEnv, type PhotoSpec } from "./bwb-photo-match";

export { pickBestPhotoMatch, parseExtraPhotosEnv, type PhotoSpec };

const DEFAULT_DEST_DIR = path.resolve("data/youtube/photos");
const FOLDER_MIME = "application/vnd.google-apps.folder";
const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif",
]);
const HEIC_EXTS = new Set([".heic", ".heif"]);

export interface FetchedPhoto {
  /** The spec name Bob supplied (the planner references photos by this). */
  name: string;
  hint?: string;
  /** Absolute local path of the downloaded (and, for HEIC, converted) image. */
  localPath: string;
  /** The actual Drive filename that matched (may differ from `name`). */
  driveName: string;
}

interface DriveCandidate {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

function isImageFile(c: DriveCandidate): boolean {
  if (typeof c.mimeType === "string" && c.mimeType.startsWith("image/")) return true;
  // HEIC and some camera exports arrive as application/octet-stream — fall back
  // to the extension so they aren't skipped.
  return IMAGE_EXTS.has(path.extname(c.name || "").toLowerCase());
}

async function listFolderChildren(folderId: string): Promise<DriveCandidate[]> {
  const out: DriveCandidate[] = [];
  let pageToken: string | undefined;
  do {
    const q = `'${folderId}' in parents and trashed=false`;
    const fields = "nextPageToken,files(id,name,mimeType,modifiedTime)";
    const ep =
      `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
      `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = await driveJson(ep);
    for (const f of (data.files || []) as DriveCandidate[]) out.push(f);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Collect candidate image files from the BWB folder AND one level of
 * subfolders (covers a "photos" subfolder), newest-first. Bounded to a handful
 * of subfolders so a pathological tree can't fan out unboundedly.
 */
async function collectImageCandidates(folderId: string): Promise<DriveCandidate[]> {
  const top = await listFolderChildren(folderId);
  const images: DriveCandidate[] = top.filter((c) => c.mimeType !== FOLDER_MIME && isImageFile(c));
  const subfolders = top.filter((c) => c.mimeType === FOLDER_MIME).slice(0, 25);
  for (const sub of subfolders) {
    try {
      const kids = await listFolderChildren(sub.id);
      for (const k of kids) if (k.mimeType !== FOLDER_MIME && isImageFile(k)) images.push(k);
    } catch {
      // A single unreadable subfolder must not abort the whole fetch.
    }
  }
  images.sort((a, b) => new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime());
  return images;
}

/** Download a Drive file by id to `dest`. Throws on a non-OK response or empty body. */
async function downloadDriveFile(fileId: string, dest: string): Promise<number> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const resp = await driveRequest(
    `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  if (!resp.ok || !resp.body) {
    const detail = (await resp.text().catch(() => "")).slice(0, 200);
    throw new Error(`download failed: ${resp.status} ${detail}`);
  }
  await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(dest));
  const bytes = fs.statSync(dest).size;
  if (bytes <= 0) throw new Error("downloaded file is empty");
  return bytes;
}

/**
 * Convert a HEIC/HEIF file to JPG via ImageMagick (`magick`/`convert`, both on
 * PATH in this env). Returns the new .jpg path. Throws if conversion fails — a
 * HEIC can't be baked into a 1080p slide, so a silent skip would reintroduce
 * the generic-image fallback this whole feature exists to kill.
 */
function convertHeicToJpg(heicPath: string): string {
  const jpgPath = heicPath.replace(/\.(heic|heif)$/i, "") + ".jpg";
  for (const bin of ["magick", "convert"]) {
    const r = spawnSync(bin, [heicPath, jpgPath], { encoding: "utf8", env: sanitizeSpawnEnv(process.env) });
    if (r.status === 0 && fs.existsSync(jpgPath) && fs.statSync(jpgPath).size > 0) {
      try { fs.unlinkSync(heicPath); } catch { /* best-effort cleanup */ }
      return jpgPath;
    }
  }
  throw new Error(
    `HEIC→JPG conversion failed for ${path.basename(heicPath)} ` +
      `(ImageMagick magick/convert). Re-export the photo as JPG or PNG and re-drop it.`,
  );
}

/**
 * Fetch every named photo from Bob's BWB Drive folder to local disk, converting
 * HEIC→JPG. FAILS LOUD when any spec can't be matched (listing the image names
 * that WERE found, so Bob can correct a typo) — never a silent substitution.
 */
export async function fetchBwbPhotos(
  specs: PhotoSpec[],
  opts?: { folderId?: string; destDir?: string },
): Promise<FetchedPhoto[]> {
  const clean = (specs || []).filter((s) => s && typeof s.name === "string" && s.name.trim());
  if (!clean.length) return [];
  const folderId = (opts?.folderId || process.env.BWB_DRIVE_FOLDER_ID || BWB_DRIVE_FOLDER_ID || "").trim();
  if (!folderId) throw new Error("fetchBwbPhotos: no BWB Drive folder id configured (BWB_DRIVE_FOLDER_ID).");
  const destDir = opts?.destDir ? path.resolve(opts.destDir) : DEFAULT_DEST_DIR;

  const candidates = await collectImageCandidates(folderId);
  if (!candidates.length) {
    throw new Error(
      `fetchBwbPhotos: no image files found in the BWB Drive folder (${folderId}) or its subfolders. ` +
        `Confirm the photos finished uploading.`,
    );
  }

  const results: FetchedPhoto[] = [];
  const unmatched: string[] = [];
  for (const spec of clean) {
    const idx = pickBestPhotoMatch(spec.name, candidates);
    if (idx === -1) {
      unmatched.push(spec.name);
      continue;
    }
    const match = candidates[idx];
    // Make the local filename UNIQUE per Drive file id so two different photos
    // that share a basename across folders (IMG_4821.HEIC in two subfolders)
    // can't overwrite each other — a silent wrong-image substitution.
    const ext = path.extname(match.name);
    const stem = path.basename(match.name, ext).replace(/[^\w.\- ]+/g, "_") || "photo";
    const idSuffix = match.id.replace(/[^\w]+/g, "").slice(-8) || "0";
    const safeBase = `${stem}-${idSuffix}${ext.toLowerCase()}`;
    let dest = path.join(destDir, safeBase);
    const bytes = await downloadDriveFile(match.id, dest);
    if (HEIC_EXTS.has(path.extname(dest).toLowerCase())) dest = convertHeicToJpg(dest);
    console.log(`[bwb-photo-fetch] matched "${spec.name}" → ${match.name} (${bytes} bytes) → ${dest}`);
    results.push({ name: spec.name, hint: spec.hint, localPath: dest, driveName: match.name });
  }

  if (unmatched.length) {
    const available = candidates.slice(0, 30).map((c) => c.name).join(", ");
    throw new Error(
      `Could not find photo(s) named: ${unmatched.join(", ")} in the BWB Drive folder. ` +
        `Available images: ${available}${candidates.length > 30 ? ", …" : ""}. ` +
        `Check the spelling (case doesn't matter) and that the upload finished.`,
    );
  }
  return results;
}
