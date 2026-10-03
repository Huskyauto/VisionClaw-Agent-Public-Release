import { authFetch } from "./queryClient";

export interface UploadResult {
  url: string;
  filename: string;
  type: string;
  size: number;
  storageKey?: string | null;
  driveUrl?: string | null;
}

// Files at or above this size go straight to the base64 path on the first
// attempt. The Replit deployment proxy occasionally drops large multipart
// uploads on mobile networks before they reach Node, surfacing as a
// "Failed to fetch" TypeError on the client. Base64 JSON uploads use a
// different code path on the proxy and are reliable.
const BASE64_FIRST_THRESHOLD = 4 * 1024 * 1024; // 4 MB
const MAX_BASE64_SIZE = 45 * 1024 * 1024;        // server limit is 50 MB JSON; leave headroom for base64 overhead

async function fileToBase64(file: File): Promise<string> {
  // Avoid FileReader (it loads as data URL and slices off the prefix awkwardly).
  // Convert via ArrayBuffer in chunks to keep memory pressure manageable on mobile.
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as any);
  }
  return btoa(binary);
}

async function uploadViaBase64(file: File): Promise<UploadResult> {
  if (file.size > MAX_BASE64_SIZE) {
    throw new Error(`File too large for base64 fallback (${(file.size / 1024 / 1024).toFixed(1)} MB; max ~45 MB)`);
  }
  const data = await fileToBase64(file);
  const res = await authFetch("/api/upload-base64", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

async function uploadViaMultipart(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function uploadFile(file: File): Promise<UploadResult> {
  // For larger files, skip multipart entirely — proxy is more likely to drop them.
  if (file.size >= BASE64_FIRST_THRESHOLD) {
    try {
      return await uploadViaBase64(file);
    } catch (err) {
      // If base64 path fails (e.g. file too large), give multipart a chance.
      console.warn("[upload] base64 path failed, retrying multipart:", (err as Error).message);
      return await uploadViaMultipart(file);
    }
  }

  // Smaller files: try multipart first, fall back to base64 on network failure.
  try {
    return await uploadViaMultipart(file);
  } catch (err) {
    const msg = (err as Error).message || "";
    const isNetworkFailure =
      err instanceof TypeError ||                  // "Failed to fetch"
      /failed to fetch|network|load failed/i.test(msg);
    if (!isNetworkFailure) throw err;
    console.warn("[upload] multipart network failure, retrying via base64:", msg);
    return await uploadViaBase64(file);
  }
}
