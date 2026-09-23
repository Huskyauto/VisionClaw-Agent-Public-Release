export interface DeliveryReceiptRecord {
  status: string | null;
  emailSent: boolean | null;
  driveFileId: string | null;
  shareableLink: string | null;
  downloadLink: string | null;
  folderLink: string | null;
}

export interface DeliveryArtifactRecord {
  status: string | null;
  driveFileId: string | null;
}

function validateDurabilityEvidence(
  delivery: DeliveryReceiptRecord,
  artifacts: DeliveryArtifactRecord[],
  expectedDriveFileId: string,
): string | null {
  if (!delivery.driveFileId || delivery.driveFileId !== expectedDriveFileId) {
    return "Sidecar Drive file does not match the persisted delivery receipt";
  }
  if (!delivery.shareableLink || !delivery.downloadLink || !delivery.folderLink) {
    return "Persisted delivery links are incomplete";
  }
  if (
    artifacts.length === 0 ||
    artifacts.some((artifact) => artifact.status !== "durable") ||
    !artifacts.some((artifact) => artifact.driveFileId === expectedDriveFileId)
  ) {
    return "Delivery artifacts are missing, non-durable, or do not match the Drive receipt";
  }
  return null;
}

export function validateCompletedArtifactReceipt(
  delivery: DeliveryReceiptRecord,
  artifacts: DeliveryArtifactRecord[],
  expectedDriveFileId: string,
): string | null {
  if (delivery.status !== "completed") {
    return "Delivery is not completed";
  }
  return validateDurabilityEvidence(delivery, artifacts, expectedDriveFileId);
}

export function validateCompletedEmailReceipt(
  delivery: DeliveryReceiptRecord,
  artifacts: DeliveryArtifactRecord[],
  expectedDriveFileId: string,
): string | null {
  if (delivery.status !== "completed" || delivery.emailSent !== true) {
    return "Delivery is not completed with a persisted email receipt";
  }
  return validateDurabilityEvidence(delivery, artifacts, expectedDriveFileId);
}