import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFelixDurableDelivery } from "../../server/lib/felix-durable-delivery-gate";

test("blocks Felix from declaring a local-only write complete", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "The finished report is saved.",
    executedTools: [{
      name: "write_file",
      result: { error: "File was written locally but is not durable", path: "deliverables/report.md" },
    }],
  });
  assert.match(issue || "", /Google Drive/i);
});

test("accepts Felix's write when the current turn contains its Drive receipt", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "The finished report is saved: https://drive.google.com/file/d/current/view",
    executedTools: [{
      name: "write_file",
      result: {
        success: true,
        path: "deliverables/report.md",
        upload_success: true,
        drive_url: "https://drive.google.com/file/d/current/view",
      },
    }],
  });
  assert.equal(issue, null);
});

test("blocks a delegated local deliverable without a Drive receipt", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Agent Blueprint finished the business plan.",
    executedTools: [{
      name: "delegate_task",
      result: "Saved finished deliverable to /home/runner/workspace/deliverables/business-plan.md",
    }],
  });
  assert.match(issue || "", /delegated/i);
});

test("accepts a delegated deliverable with a current-turn Drive link", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Agent Blueprint finished the plan: https://drive.google.com/file/d/current/view",
    executedTools: [
      {
        name: "delegate_task",
        result: "Finished business-plan.md at /tmp/business-plan.md",
      },
      {
        name: "write_file",
        input: { path: "deliverables/business-plan.md" },
        result: {
          success: true,
          upload_success: true,
          path: "deliverables/business-plan.md",
          drive_url: "https://drive.google.com/file/d/current/view",
        },
      },
    ],
  });
  assert.equal(issue, null);
});

test("detects structured delegated artifact results", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Agent Blueprint finished the plan.",
    executedTools: [{
      name: "delegate_task",
      result: { status: "success", ready: true, artifact: { outputPath: "/tmp/business-plan.pdf" } },
    }],
  });
  assert.match(issue || "", /delegated/i);
});

test("rejects failed or stale-link results as Drive receipts", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Done: https://drive.google.com/file/d/old/view",
    executedTools: [{
      name: "write_file",
      result: {
        success: false,
        error: "new upload failed; previous link was https://drive.google.com/file/d/old/view",
        path: "deliverables/new-report.md",
      },
    }],
  });
  assert.match(issue || "", /Google Drive/i);
});

test("requires the final response to contain the exact current-turn receipt URL", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Done: https://drive.google.com/file/d/old/view",
    executedTools: [{
      name: "write_file",
      result: {
        success: true,
        upload_success: true,
        drive_url: "https://drive.google.com/file/d/new/view",
        path: "deliverables/new-report.md",
      },
    }],
  });
  assert.match(issue || "", /current.*Drive|Drive.*link/i);
});

test("does not mistake a downloaded research source for a delegated product", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "The source review is complete.",
    executedTools: [{
      name: "delegate_task",
      result: "Downloaded source report.pdf and extracted three cited findings.",
    }],
  });
  assert.equal(issue, null);
});

test("does not trust a delegate's uncorrelated Drive-link claim", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Done: https://drive.google.com/file/d/old/view",
    executedTools: [{
      name: "delegate_task",
      result: "Finished new-plan.pdf and uploaded it to Google Drive: https://drive.google.com/file/d/old/view",
    }],
  });
  assert.match(issue || "", /delegated/i);
});

test("rejects a later trusted upload for a different delegated artifact", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Done: https://drive.google.com/file/d/other/view",
    executedTools: [
      { name: "delegate_task", result: { status: "success", path: "/tmp/business-plan.pdf" } },
      {
        name: "write_file",
        input: { path: "deliverables/other-report.pdf" },
        result: {
          success: true,
          upload_success: true,
          path: "deliverables/other-report.pdf",
          drive_url: "https://drive.google.com/file/d/other/view",
        },
      },
    ],
  });
  assert.match(issue || "", /delegated/i);
});

test("normalizes terminal punctuation on receipt URLs", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Done: https://drive.google.com/file/d/current/view",
    executedTools: [{
      name: "write_file",
      result: {
        success: true,
        upload_success: true,
        path: "deliverables/report.md",
        message: "Uploaded: https://drive.google.com/file/d/current/view).",
      },
    }],
  });
  assert.equal(issue, null);
});

test("accepts a failed local staging attempt after the same artifact is uploaded successfully", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Recovered and uploaded: https://drive.google.com/file/d/report/view",
    executedTools: [
      {
        name: "write_file",
        input: { path: "deliverables/report.pdf" },
        result: { error: "Drive unavailable", path: "deliverables/report.pdf" },
      },
      {
        name: "deliver_product",
        input: { filePath: "deliverables/report.pdf" },
        result: {
          success: true,
          linkVerified: true,
          driveFileId: "report",
          shareableLink: "https://drive.google.com/file/d/report/view",
        },
      },
    ],
  });
  assert.equal(issue, null);
});

test("requires a current receipt link for every finished artifact", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "First: https://drive.google.com/file/d/first/view",
    executedTools: [
      {
        name: "write_file",
        input: { path: "deliverables/first.pdf" },
        result: {
          success: true,
          upload_success: true,
          path: "deliverables/first.pdf",
          drive_url: "https://drive.google.com/file/d/first/view",
        },
      },
      {
        name: "write_file",
        input: { path: "deliverables/second.pdf" },
        result: {
          success: true,
          upload_success: true,
          path: "deliverables/second.pdf",
          drive_url: "https://drive.google.com/file/d/second/view",
        },
      },
    ],
  });
  assert.match(issue || "", /Drive.*link/i);
});

test("does not mistake structured downloaded source files for finished products", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "The source review is complete.",
    executedTools: [{
      name: "delegate_task",
      result: {
        status: "success",
        files: [{ path: "/tmp/source-report.pdf", role: "downloaded_source" }],
        summary: "Three cited findings.",
      },
    }],
  });
  assert.equal(issue, null);
});

test("detects completed nested file containers from delegated work", () => {
  for (const result of [
    { status: "success", files: ["/tmp/report.pdf"] },
    { success: true, file: { path: "/tmp/report.pdf" } },
  ]) {
    const issue = evaluateFelixDurableDelivery({
      personaId: 2,
      responseContent: "The report is finished.",
      executedTools: [{ name: "delegate_task", result }],
    });
    assert.match(issue || "", /delegated/i);
  }
});

test("requires each bundled artifact link when no verified Drive folder covers the bundle", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "First: https://drive.google.com/file/d/first/view",
    executedTools: [{
      name: "deliver_product",
      input: { filePath: "deliverables/bundle.zip" },
      result: {
        success: true,
        linkVerified: true,
        driveFileId: "bundle",
        shareableLink: "https://drive.google.com/file/d/bundle/view",
        bundleFiles: [
          {
            success: true,
            driveFileId: "first",
            fileName: "first.pdf",
            shareableLink: "https://drive.google.com/file/d/first/view",
          },
          {
            success: true,
            driveFileId: "second",
            fileName: "second.pdf",
            shareableLink: "https://drive.google.com/file/d/second/view",
          },
        ],
      },
    }],
  });
  assert.match(issue || "", /Drive.*link/i);
});

test("accepts one verified Drive folder link for a delivered bundle", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "Bundle folder: https://drive.google.com/drive/folders/current",
    executedTools: [{
      name: "deliver_product",
      input: { filePath: "deliverables/bundle.zip" },
      result: {
        success: true,
        linkVerified: true,
        driveFileId: "bundle",
        folderLink: "https://drive.google.com/drive/folders/current",
        bundleFiles: [
          { success: true, driveFileId: "first", fileName: "first.pdf" },
          { success: true, driveFileId: "second", fileName: "second.pdf" },
        ],
      },
    }],
  });
  assert.equal(issue, null);
});

test("does not require Drive for ordinary Felix research delegation", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 2,
    responseContent: "The research found three relevant sources.",
    executedTools: [{
      name: "delegate_task",
      result: "Research summary: source A, source B, source C.",
    }],
  });
  assert.equal(issue, null);
});

test("does not apply Felix's runtime rule to another persona", () => {
  const issue = evaluateFelixDurableDelivery({
    personaId: 5,
    responseContent: "Saved report.md locally.",
    executedTools: [{
      name: "write_file",
      result: { path: "deliverables/report.md" },
    }],
  });
  assert.equal(issue, null);
});