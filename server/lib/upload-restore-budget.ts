/**
 * Startup restoration is a best-effort cache warmup, never durable storage.
 * Keep the local deployment cache bounded so database-backed images cannot
 * exhaust the VM image or /tmp volume during boot.
 */
export const MAX_STARTUP_UPLOAD_RESTORE_BYTES = 32 * 1024 * 1024;
export const MAX_STARTUP_UPLOAD_RESTORE_FILES = 100;

export function shouldRestoreStartupUpload(
  restoredBytes: number,
  base64Data: string,
): { restore: boolean; bytes: number } {
  const bytes = Buffer.byteLength(base64Data, "base64");
  return {
    restore: restoredBytes >= 0 && bytes <= MAX_STARTUP_UPLOAD_RESTORE_BYTES - restoredBytes,
    bytes,
  };
}