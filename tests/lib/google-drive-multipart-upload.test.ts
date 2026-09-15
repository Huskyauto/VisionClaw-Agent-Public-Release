import test from "node:test";
import assert from "node:assert/strict";
import { buildDriveMultipartUploadBody, ensureRecoveredDriveFileSharing } from "../../server/google-drive";

test("Google Drive multipart upload preserves binary media bytes without base64 transfer encoding", () => {
  const payload = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x41, 0x80]);
  const body = buildDriveMultipartUploadBody({
    boundary: "test-boundary",
    metadata: { name: "binary.pdf", parents: ["folder-id"] },
    mimeType: "application/pdf",
    fileBuffer: payload,
  });

  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.indexOf(payload), body.lastIndexOf(payload), "payload must appear as one raw media part");
  assert.doesNotMatch(body.toString("latin1"), /Content-Transfer-Encoding:\s*base64/i);
  assert.match(body.toString("latin1"), /Content-Type: application\/pdf\r\n\r\n/);
  assert.match(body.toString("latin1"), /--test-boundary--\r\n$/);
});

test("Google Drive multipart upload rejects MIME values that could inject headers", () => {
  for (const mimeType of [
    "\r\napplication/pdf",
    "application/pdf\r\n",
    "application/pdf;\r\ncharset=UTF-8",
    "application/pdf; charset=\r\nUTF-8",
    "application/pdf; profile=\"safe\r\nvalue\"",
  ]) {
    assert.throws(() => buildDriveMultipartUploadBody({
      boundary: "test-boundary",
      metadata: { name: "binary.pdf" },
      mimeType,
      fileBuffer: Buffer.from("safe bytes"),
    }), /mime type is invalid/i, mimeType);
  }
});

test("Google Drive multipart upload accepts standard vendor MIME parameters", () => {
  const body = buildDriveMultipartUploadBody({
    boundary: "test-boundary",
    metadata: { name: "report.json" },
    mimeType: "application/vnd.example.widget+json; charset=UTF-8; profile=\"customer copy\"",
    fileBuffer: Buffer.from("{}"),
  });

  assert.match(
    body.toString("utf8"),
    /Content-Type: application\/vnd\.example\.widget\+json; charset=UTF-8; profile="customer copy"\r\n\r\n/,
  );
});

test("recovered Drive files verify existing access, repair it when missing, and fail closed on repair failure", async () => {
  let shareCalls = 0;
  const repaired = await ensureRecoveredDriveFileSharing(
    { fileId: "file-id", viewUrl: "old-view", downloadUrl: "old-download" },
    true,
    {
      verifyPublicAccess: async () => ({ verified: false, reason: "missing-anyone-reader" }),
      makeShareable: async () => {
        shareCalls++;
        return { success: true, webViewLink: "new-view", directDownloadLink: "new-download" };
      },
    },
  );
  assert.deepEqual(repaired, {
    success: true,
    file: { fileId: "file-id", viewUrl: "new-view", downloadUrl: "new-download" },
  });
  assert.equal(shareCalls, 1);

  const alreadyShared = await ensureRecoveredDriveFileSharing(
    { fileId: "file-id" },
    true,
    {
      verifyPublicAccess: async () => ({ verified: true, reason: "anyone-reader" }),
      makeShareable: async () => {
        throw new Error("must not repair an already-public file");
      },
    },
  );
  assert.equal(alreadyShared.success, true);

  const failed = await ensureRecoveredDriveFileSharing(
    { fileId: "file-id" },
    true,
    {
      verifyPublicAccess: async () => ({ verified: false, reason: "missing-anyone-reader" }),
      makeShareable: async () => ({ success: false, error: "Drive denied permission" }),
    },
  );
  assert.deepEqual(failed, {
    success: false,
    error: "Drive recovery found a file but sharing could not be verified: Drive denied permission",
  });
});