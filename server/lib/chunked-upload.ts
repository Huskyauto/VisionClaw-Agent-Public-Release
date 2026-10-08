import fs from "node:fs/promises";
import path from "node:path";

export type ChunkedUploadState = {
  fileName: string;
  fileSize: number;
  chunks: Map<number, string>;
  totalChunks: number;
  tenantId: number;
  bytesReceived?: number;
  assembling?: boolean;
};

export class ChunkedUploadError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "ChunkedUploadError";
  }
}

export async function assembleOwnedChunkedUpload({
  uploadId,
  tenantId,
  uploads,
  uploadsDir,
}: {
  uploadId: string;
  tenantId: number | null;
  uploads: Map<string, ChunkedUploadState>;
  uploadsDir: string;
}): Promise<{ filePath: string; fileName: string }> {
  if (!Number.isInteger(tenantId) || tenantId! <= 0) {
    throw new ChunkedUploadError("Authentication required", 401);
  }

  const upload = uploads.get(uploadId);
  if (!upload) throw new ChunkedUploadError("Invalid upload ID", 400);
  if (upload.tenantId !== tenantId) {
    throw new ChunkedUploadError("Upload does not belong to this tenant", 403);
  }
  if (upload.assembling) throw new ChunkedUploadError("Upload is already being assembled", 409);
  if (upload.chunks.size !== upload.totalChunks) {
    throw new ChunkedUploadError(`Missing chunks: got ${upload.chunks.size}/${upload.totalChunks}`, 400);
  }
  upload.assembling = true;

  const assembledPath = path.join(
    uploadsDir,
    `${uploadId}-assembled${path.extname(upload.fileName).toLowerCase()}`,
  );
  let created = false;
  let output: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    output = await fs.open(assembledPath, "wx");
    created = true;
    let bytesWritten = 0;
    for (let i = 0; i < upload.totalChunks; i++) {
      const chunkPath = upload.chunks.get(i);
      if (!chunkPath) throw new ChunkedUploadError(`Missing chunk ${i}`, 400);
      const part = await fs.readFile(chunkPath);
      bytesWritten += part.length;
      if (bytesWritten > upload.fileSize) throw new ChunkedUploadError("Assembled size does not match declared file size", 400);
      await output.writeFile(part);
    }
    if (bytesWritten !== upload.fileSize) {
      throw new ChunkedUploadError("Assembled size does not match declared file size", 400);
    }
    await output.close();
    output = undefined;

    for (const chunkPath of upload.chunks.values()) {
      try {
        await fs.unlink(chunkPath);
      } catch (error) {
        // Preserve successful completion if temporary-file cleanup is unavailable.
        console.warn("[chunk-upload] temporary chunk cleanup failed", error instanceof Error ? error.name : "unknown");
      }
    }
    if (uploads.get(uploadId) === upload) uploads.delete(uploadId);
    return { filePath: assembledPath, fileName: upload.fileName };
  } catch (error) {
    if (output) {
      try { await output.close(); } catch (closeError) {
        console.warn("[chunk-upload] output close failed", closeError instanceof Error ? closeError.name : "unknown");
      }
    }
    if (created) {
      try {
        await fs.unlink(assembledPath);
      } catch (cleanupError) {
        // Keep the original assembly error; incomplete upload state remains available.
        console.warn("[chunk-upload] incomplete output cleanup failed", cleanupError instanceof Error ? cleanupError.name : "unknown");
      }
    }
    throw error;
  } finally {
    if (uploads.get(uploadId) === upload) upload.assembling = false;
  }
}