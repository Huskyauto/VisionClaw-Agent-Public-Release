type ExecutedTool = {
  name: string;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: unknown;
};

type FelixDurableDeliveryInput = {
  personaId?: number | null;
  responseContent: string;
  executedTools: ExecutedTool[];
};

const DRIVE_URL = /https:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>]+/gi;
const FILE_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|csv|md|txt|html?|zip|mp3|wav|mp4|mov|png|jpe?g|webp)\b/i;
const DELIVERABLE_WORD = /\b(?:deliverable|finished|completed|created|generated|saved|uploaded|output|artifact)\b/i;
const ARTIFACT_KEYS = new Set([
  "artifact",
  "artifacts",
  "file",
  "files",
  "path",
  "localpath",
  "outputpath",
  "filepath",
  "filename",
  "finalfilepath",
  "artifactpath",
  "deliverablepath",
]);
const STRONG_ARTIFACT_KEYS = new Set(["artifact", "artifacts", "outputpath", "finalfilepath", "artifactpath", "deliverablepath"]);
const BROAD_ARTIFACT_KEYS = new Set(["file", "files", "path", "localpath", "filepath", "filename"]);

function resultText(tool: ExecutedTool): string {
  const value = tool.output ?? tool.result;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function resultValue(tool: ExecutedTool): unknown {
  const value = tool.output ?? tool.result;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function driveUrls(text: string): string[] {
  return [...text.matchAll(DRIVE_URL)].map((match) => match[0].replace(/[),.;!?]+$/g, ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function structuredResultClaimsFile(value: unknown, key = "", depth = 0, inheritedCompletion = false): boolean {
  if (depth > 6) return false;
  if (typeof value === "string") {
    const normalizedKey = key.toLowerCase();
    return FILE_EXTENSION.test(value) &&
      (STRONG_ARTIFACT_KEYS.has(normalizedKey) || (inheritedCompletion && BROAD_ARTIFACT_KEYS.has(normalizedKey)));
  }
  if (Array.isArray(value)) {
    return value.some((item) => structuredResultClaimsFile(item, key, depth + 1, inheritedCompletion));
  }
  if (!isRecord(value)) return false;
  const roleValues = ["role", "type", "kind", "purpose", "origin"]
    .map((field) => value[field])
    .filter((field): field is string => typeof field === "string")
    .join(" ");
  if (/\b(?:downloaded[_ -]?source|source|input|reference|attachment)\b/i.test(roleValues)) return false;
  const status = typeof value.status === "string" ? value.status : "";
  const localCompletion = inheritedCompletion ||
    value.success === true ||
    value.ready === true ||
    value.completed === true ||
    /\b(?:success|completed|finished|ready)\b/i.test(status) ||
    /\b(?:output|artifact|deliverable|final)\b/i.test(roleValues) ||
    key === "artifact" ||
    key === "artifacts";
  return Object.entries(value).some(([childKey, child]) => {
    if (typeof child === "string" && FILE_EXTENSION.test(child)) {
      const normalizedKey = childKey.toLowerCase();
      if (STRONG_ARTIFACT_KEYS.has(normalizedKey)) return true;
      if (BROAD_ARTIFACT_KEYS.has(normalizedKey) && localCompletion) return true;
    }
    return structuredResultClaimsFile(child, childKey, depth + 1, localCompletion);
  });
}

function delegatedResultClaimsFile(tool: ExecutedTool): boolean {
  const value = resultValue(tool);
  if (structuredResultClaimsFile(value)) return true;
  const text = resultText(tool);
  return FILE_EXTENSION.test(text) && DELIVERABLE_WORD.test(text);
}

function artifactNames(value: unknown, key = "", depth = 0): Set<string> {
  const names = new Set<string>();
  if (depth > 6) return names;
  if (typeof value === "string") {
    if (ARTIFACT_KEYS.has(key.toLowerCase())) {
      for (const match of value.matchAll(/[A-Za-z0-9._-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|md|txt|html?|zip|mp3|wav|mp4|mov|png|jpe?g|webp)\b/gi)) {
        names.add(match[0].toLowerCase());
      }
    }
    return names;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      for (const name of artifactNames(item, key, depth + 1)) names.add(name);
    }
    return names;
  }
  if (!isRecord(value)) return names;
  for (const [childKey, child] of Object.entries(value)) {
    for (const name of artifactNames(child, childKey, depth + 1)) names.add(name);
  }
  return names;
}

function textArtifactNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9._-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|md|txt|html?|zip|mp3|wav|mp4|mov|png|jpe?g|webp)\b/gi)) {
    names.add(match[0].toLowerCase());
  }
  return names;
}

function toolArtifactNames(tool: ExecutedTool): Set<string> {
  const names = artifactNames({ input: tool.input, result: resultValue(tool) });
  for (const name of textArtifactNames(resultText(tool))) names.add(name);
  return names;
}

function directDriveReceipt(tool: ExecutedTool): { urls: string[]; names: Set<string>; requirements: string[][] } {
  const value = resultValue(tool);
  const empty = { urls: [], names: new Set<string>(), requirements: [] };
  if (!isRecord(value) || value.success !== true) return empty;
  if (tool.name === "write_file" && value.upload_success !== true) return empty;
  if (tool.name === "deliver_product" && (value.linkVerified !== true || typeof value.driveFileId !== "string")) return empty;
  const urls = driveUrls(resultText(tool));
  if (urls.length === 0) return empty;
  let requirements = [urls];
  if (tool.name === "deliver_product" && Array.isArray(value.bundleFiles) && value.bundleFiles.length > 0) {
    const folderUrls = typeof value.folderLink === "string" ? driveUrls(value.folderLink) : [];
    if (folderUrls.length > 0) {
      requirements = [folderUrls];
    } else {
      const bundleRequirements = value.bundleFiles.flatMap((file): string[][] => {
        if (!isRecord(file) || file.success !== true || typeof file.driveFileId !== "string") return [];
        const fileUrls = driveUrls(JSON.stringify(file));
        return fileUrls.length > 0 ? [fileUrls] : [];
      });
      if (bundleRequirements.length !== value.bundleFiles.length) return empty;
      requirements = bundleRequirements;
    }
  }
  return { urls, names: toolArtifactNames(tool), requirements };
}

/**
 * Felix may stage files locally, but a finished product is not complete until
 * the current turn contains its durable Google Drive receipt and the final
 * response gives that link to the user.
 */
export function evaluateFelixDurableDelivery(input: FelixDurableDeliveryInput): string | null {
  if (input.personaId !== 2) return null;

  const directFileTools = input.executedTools
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => tool.name === "write_file" || tool.name === "deliver_product");
  const directAttempts = directFileTools.map(({ tool, index }) => ({
    tool,
    index,
    names: toolArtifactNames(tool),
    receipt: directDriveReceipt(tool),
  }));
  const directReceipts = directAttempts
    .filter((attempt) => attempt.receipt.urls.length > 0)
    .map((attempt) => ({
      index: attempt.index,
      names: attempt.receipt.names,
      urls: attempt.receipt.urls,
      requirements: attempt.receipt.requirements,
    }));
  for (const attempt of directAttempts) {
    if (attempt.receipt.urls.length > 0) continue;
    const recovered = directReceipts.some((receipt) =>
      receipt.index > attempt.index &&
      [...attempt.names].some((name) => receipt.names.has(name))
    );
    if (!recovered) {
      return `FELIX DURABLE DELIVERY GATE FAILED — ${attempt.tool.name} produced or delivered a file without a current-turn Google Drive receipt. Local files are staging only. Upload the finished product to Google Drive, verify it, and include the Drive link before declaring completion.`;
    }
  }

  const delegatedFileTools = input.executedTools
    .map((tool, index) => ({ tool, index }))
    .filter(({ tool }) => tool.name === "delegate_task" && delegatedResultClaimsFile(tool));
  for (const { tool, index } of delegatedFileTools) {
    const delegatedNames = toolArtifactNames(tool);
    const matchingLaterReceipt = directReceipts.find((receipt) =>
      receipt.index > index &&
      [...delegatedNames].some((name) => receipt.names.has(name))
    );
    if (!matchingLaterReceipt) {
      return "FELIX DURABLE DELIVERY GATE FAILED — delegated work reported a finished file without a current-turn Google Drive receipt. Have the delegated product uploaded and verified in Google Drive before declaring it complete.";
    }
  }

  const producedFile = directFileTools.length > 0 || delegatedFileTools.length > 0;
  const receiptGroups = directReceipts.flatMap((receipt) => receipt.requirements);
  const omittedReceipt = receiptGroups.some((urls) =>
    !urls.some((url) => input.responseContent.includes(url))
  );
  if (producedFile && (receiptGroups.length === 0 || omittedReceipt)) {
    return "FELIX DURABLE DELIVERY GATE FAILED — the current turn produced a finished file, but the final response omitted its Google Drive link. Include the verified Drive view link so the product remains accessible for future use.";
  }

  return null;
}