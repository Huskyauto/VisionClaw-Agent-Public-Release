import { authFetch } from "./queryClient";

export interface UploadResult {
  url: string;
  filename: string;
  type: string;
  size: number;
  storageKey?: string | null;
  driveUrl?: string | null;
}

export async function uploadFile(file: File): Promise<UploadResult> {
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
