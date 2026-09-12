import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_STARTUP_UPLOAD_RESTORE_BYTES,
  shouldRestoreStartupUpload,
} from "../../server/lib/upload-restore-budget";

test("startup upload restoration refuses the file that would exceed its disk budget", () => {
  const remaining = MAX_STARTUP_UPLOAD_RESTORE_BYTES - 1;
  const oversizedBase64 = Buffer.alloc(2).toString("base64");

  assert.deepEqual(shouldRestoreStartupUpload(remaining, oversizedBase64), {
    restore: false,
    bytes: 2,
  });
});