import { createHash } from "node:crypto";
import { isIP } from "node:net";

const LIMITS = {
  title: 240,
  name: 120,
  description: 1_200,
  value: 240,
  sources: 8,
  tutorials: 12,
  tasks: 12,
  taskFields: 16,
  unsupportedTasks: 12,
} as const;

type SourceRef = {
  name: string;
  sourceUrl: string;
  license?: string;
};

type TutorialRef = {
  name: string;
  sourceUrl: string;
  expectedArtifacts: string[];
};

type SupportedTask = {
  name: string;
  objective: string;
  requiredInputs: string[];
  expectedOutputs: string[];
};

type EnvironmentContract = {
  runtime?: string;
  dependencies: string[];
  hardware?: string;
  networkAccess?: string;
  estimatedCost?: string;
};

export type PaperExecutionManifest = {
  paper: {
    title: string;
    sourceUrl: string;
    version?: string;
  };
  repository?: {
    sourceUrl: string;
    revision?: string;
  };
  datasets: SourceRef[];
  tutorials: TutorialRef[];
  supportedTasks: SupportedTask[];
  unsupportedTasks: string[];
  environment: EnvironmentContract;
  independentEvaluator?: string;
};

export type PaperExecutionCapsule = {
  schemaVersion: 1;
  framework: "paper_execution_capsule";
  capsuleId: string;
  reportOnly: true;
  autonomyChanged: false;
  authorityEffect: "none";
  scientificValidation: "not_established";
  summary: {
    sources: number;
    supportedTasks: number;
    unsupportedTasks: number;
    plannedReproductionChecks: number;
    plannedNovelTaskChecks: number;
  };
  sourceContract: {
    paper: PaperExecutionManifest["paper"];
    repository: PaperExecutionManifest["repository"] | null;
    datasets: SourceRef[];
    tutorials: TutorialRef[];
  };
  taskContract: {
    supported: SupportedTask[];
    unsupported: string[];
  };
  environmentContract: EnvironmentContract;
  reproducibilityPlan: {
    tutorialChecks: Array<{
      name: string;
      sourceUrl: string;
      expectedArtifacts: string[];
      status: "planned_unexecuted";
    }>;
    novelTaskChecks: Array<{
      task: string;
      requiredEvidence: string[];
      status: "planned_unexecuted";
    }>;
    negativeChecks: Array<{
      requestClass: string;
      expectedBehavior: "refuse_as_unsupported";
      status: "planned_unexecuted";
    }>;
  };
  provenance: Array<{
    sourceId: string;
    kind: "paper" | "repository" | "dataset" | "tutorial";
    name: string;
    sourceUrl: string;
    license: string | null;
    verification: "caller_supplied_unverified";
  }>;
  evidenceGaps: string[];
  limitations: string[];
};

export class PaperExecutionCapsuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperExecutionCapsuleValidationError";
  }
}

function fail(message: string): never {
  throw new PaperExecutionCapsuleValidationError(message);
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${field} must contain plain data`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set)) {
    fail(`${field} must not contain accessor properties`);
  }
  return value as Record<string, unknown>;
}

function plainArray(value: unknown, field: string, maxItems: number): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${field} must contain plain data`);
  }
  if (value.length > maxItems) fail(`${field} exceeds ${maxItems} items`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set)) {
    fail(`${field} must not contain accessor properties`);
  }
  const ownKeys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
  if (ownKeys.some((key) => {
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= 0xffffffff ||
      String(index) !== key;
  })) {
    fail(`${field} must not contain named properties`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, String(index))) {
      fail(`${field} must not contain sparse entries`);
    }
  }
  return value;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${field} contains unknown field: ${unknown.sort()[0]}`);
}

function boundedText(
  value: unknown,
  field: string,
  max: number,
  options: { optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string") fail(`${field} must be a string`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    fail(`${field} contains control characters`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(`${field} must not be empty`);
  if (normalized.length > max) fail(`${field} exceeds ${max} characters`);
  return normalized;
}

function boundedStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  itemMax: number = LIMITS.value,
  options: { min?: number } = {},
): string[] {
  const items = plainArray(value, field, maxItems);
  if (items.length < (options.min ?? 0)) fail(`${field} must not be empty`);
  const normalized = items.map((item, index) =>
    boundedText(item, `${field}[${index}]`, itemMax) as string);
  if (new Set(normalized).size !== normalized.length) fail(`${field} contains duplicate items`);
  return normalized.sort(stableCompare);
}

function isUnsafeIpLiteral(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const octets = hostname.split(".").map(Number);
    return octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      octets[0] >= 224;
  }
  if (version === 6) {
    const lower = hostname.toLowerCase();
    const mappedSuffix = lower.match(/^::ffff:(.+)$/)?.[1];
    if (mappedSuffix) {
      if (isIP(mappedSuffix) === 4) return isUnsafeIpLiteral(mappedSuffix);
      const words = mappedSuffix.split(":");
      if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
        const high = Number.parseInt(words[0], 16);
        const low = Number.parseInt(words[1], 16);
        const mappedIpv4 = [
          high >>> 8,
          high & 0xff,
          low >>> 8,
          low & 0xff,
        ].join(".");
        return isUnsafeIpLiteral(mappedIpv4);
      }
      return true;
    }
    return lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb");
  }
  return false;
}

function safeSourceUrl(value: unknown, field: string): string {
  const raw = boundedText(value, field, 2_048) as string;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail(`${field} must be a valid URL`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (parsed.protocol !== "https:") fail(`${field} must use HTTPS`);
  if (parsed.username || parsed.password || parsed.hash || parsed.port) {
    fail(`${field} must not contain credentials, fragments, or ports`);
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    isUnsafeIpLiteral(hostname)
  ) {
    fail(`${field} uses an unsafe host`);
  }
  return parsed.toString();
}

function parseSourceRef(value: unknown, field: string): SourceRef {
  const row = objectRecord(value, field);
  exactKeys(row, ["name", "sourceUrl", "license"], field);
  const license = boundedText(row.license, `${field}.license`, LIMITS.value, { optional: true });
  return {
    name: boundedText(row.name, `${field}.name`, LIMITS.name) as string,
    sourceUrl: safeSourceUrl(row.sourceUrl, `${field}.sourceUrl`),
    ...(license ? { license } : {}),
  };
}

function parseTutorial(value: unknown, field: string): TutorialRef {
  const row = objectRecord(value, field);
  exactKeys(row, ["name", "sourceUrl", "expectedArtifacts"], field);
  return {
    name: boundedText(row.name, `${field}.name`, LIMITS.name) as string,
    sourceUrl: safeSourceUrl(row.sourceUrl, `${field}.sourceUrl`),
    expectedArtifacts: boundedStringArray(
      row.expectedArtifacts,
      `${field}.expectedArtifacts`,
      LIMITS.taskFields,
      LIMITS.value,
      { min: 1 },
    ),
  };
}

function parseTask(value: unknown, field: string): SupportedTask {
  const row = objectRecord(value, field);
  exactKeys(row, ["name", "objective", "requiredInputs", "expectedOutputs"], field);
  return {
    name: boundedText(row.name, `${field}.name`, LIMITS.name) as string,
    objective: boundedText(row.objective, `${field}.objective`, LIMITS.description) as string,
    requiredInputs: boundedStringArray(
      row.requiredInputs,
      `${field}.requiredInputs`,
      LIMITS.taskFields,
      LIMITS.value,
      { min: 1 },
    ),
    expectedOutputs: boundedStringArray(
      row.expectedOutputs,
      `${field}.expectedOutputs`,
      LIMITS.taskFields,
      LIMITS.value,
      { min: 1 },
    ),
  };
}

function sortObjects<T>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    stableCompare(canonicalJson(left), canonicalJson(right)));
}

function parseObjectArray<T>(
  value: unknown,
  field: string,
  maxItems: number,
  parser: (item: unknown, field: string) => T,
  options: { min?: number } = {},
): T[] {
  const items = plainArray(value, field, maxItems);
  if (items.length < (options.min ?? 0)) fail(`${field} must not be empty`);
  const parsed = items.map((item, index) => parser(item, `${field}[${index}]`));
  const serialized = parsed.map(canonicalJson);
  if (new Set(serialized).size !== serialized.length) fail(`${field} contains duplicate items`);
  return sortObjects(parsed);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
}

export function parsePaperExecutionManifest(value: unknown): PaperExecutionManifest {
  const manifest = objectRecord(value, "manifest");
  exactKeys(manifest, [
    "paper",
    "repository",
    "datasets",
    "tutorials",
    "supportedTasks",
    "unsupportedTasks",
    "environment",
    "independentEvaluator",
  ], "manifest");

  const paper = objectRecord(manifest.paper, "manifest.paper");
  exactKeys(paper, ["title", "sourceUrl", "version"], "manifest.paper");
  const version = boundedText(
    paper.version,
    "manifest.paper.version",
    LIMITS.value,
    { optional: true },
  );

  let repository: PaperExecutionManifest["repository"];
  if (manifest.repository !== undefined) {
    const row = objectRecord(manifest.repository, "manifest.repository");
    exactKeys(row, ["sourceUrl", "revision"], "manifest.repository");
    const revision = boundedText(
      row.revision,
      "manifest.repository.revision",
      LIMITS.value,
      { optional: true },
    );
    repository = {
      sourceUrl: safeSourceUrl(row.sourceUrl, "manifest.repository.sourceUrl"),
      ...(revision ? { revision } : {}),
    };
  }

  const environment = objectRecord(manifest.environment, "manifest.environment");
  exactKeys(
    environment,
    ["runtime", "dependencies", "hardware", "networkAccess", "estimatedCost"],
    "manifest.environment",
  );

  const optionalEnvironmentField = (key: string) =>
    boundedText(environment[key], `manifest.environment.${key}`, LIMITS.value, { optional: true });

  const independentEvaluator = boundedText(
    manifest.independentEvaluator,
    "manifest.independentEvaluator",
    LIMITS.description,
    { optional: true },
  );

  return {
    paper: {
      title: boundedText(paper.title, "manifest.paper.title", LIMITS.title) as string,
      sourceUrl: safeSourceUrl(paper.sourceUrl, "manifest.paper.sourceUrl"),
      ...(version ? { version } : {}),
    },
    ...(repository ? { repository } : {}),
    datasets: parseObjectArray(
      manifest.datasets,
      "manifest.datasets",
      LIMITS.sources,
      parseSourceRef,
    ),
    tutorials: parseObjectArray(
      manifest.tutorials,
      "manifest.tutorials",
      LIMITS.tutorials,
      parseTutorial,
      { min: 1 },
    ),
    supportedTasks: parseObjectArray(
      manifest.supportedTasks,
      "manifest.supportedTasks",
      LIMITS.tasks,
      parseTask,
      { min: 1 },
    ),
    unsupportedTasks: boundedStringArray(
      manifest.unsupportedTasks,
      "manifest.unsupportedTasks",
      LIMITS.unsupportedTasks,
      LIMITS.description,
      { min: 1 },
    ),
    environment: {
      dependencies: boundedStringArray(
        environment.dependencies,
        "manifest.environment.dependencies",
        LIMITS.taskFields,
        LIMITS.value,
      ),
      ...(optionalEnvironmentField("runtime") ? {
        runtime: optionalEnvironmentField("runtime"),
      } : {}),
      ...(optionalEnvironmentField("hardware") ? {
        hardware: optionalEnvironmentField("hardware"),
      } : {}),
      ...(optionalEnvironmentField("networkAccess") ? {
        networkAccess: optionalEnvironmentField("networkAccess"),
      } : {}),
      ...(optionalEnvironmentField("estimatedCost") ? {
        estimatedCost: optionalEnvironmentField("estimatedCost"),
      } : {}),
    },
    ...(independentEvaluator ? { independentEvaluator } : {}),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function provenanceFor(manifest: PaperExecutionManifest): PaperExecutionCapsule["provenance"] {
  const rows: PaperExecutionCapsule["provenance"] = [{
    kind: "paper",
    name: manifest.paper.title,
    sourceUrl: manifest.paper.sourceUrl,
    license: null,
    verification: "caller_supplied_unverified",
    sourceId: "",
  }];
  if (manifest.repository) {
    rows.push({
      kind: "repository",
      name: "Associated repository",
      sourceUrl: manifest.repository.sourceUrl,
      license: null,
      verification: "caller_supplied_unverified",
      sourceId: "",
    });
  }
  for (const dataset of manifest.datasets) {
    rows.push({
      kind: "dataset",
      name: dataset.name,
      sourceUrl: dataset.sourceUrl,
      license: dataset.license ?? null,
      verification: "caller_supplied_unverified",
      sourceId: "",
    });
  }
  for (const tutorial of manifest.tutorials) {
    rows.push({
      kind: "tutorial",
      name: tutorial.name,
      sourceUrl: tutorial.sourceUrl,
      license: null,
      verification: "caller_supplied_unverified",
      sourceId: "",
    });
  }
  return sortObjects(rows.map((row) => ({
    ...row,
    sourceId: `src_${sha256(canonicalJson({ ...row, sourceId: undefined })).slice(0, 16)}`,
  })));
}

function evidenceGaps(manifest: PaperExecutionManifest): string[] {
  const gaps = [
    "source_reachability_unverified",
    "source_content_unverified",
    "scientific_correctness_unverified",
    "independent_expected_result_unverified",
    "execution_not_performed",
    "reproducibility_not_observed",
  ];
  if (!manifest.paper.version) gaps.push("paper_version_missing");
  if (!manifest.repository) gaps.push("repository_missing");
  if (manifest.repository && !manifest.repository.revision) gaps.push("repository_revision_missing");
  if (manifest.datasets.some((dataset) => !dataset.license)) gaps.push("dataset_license_missing");
  if (!manifest.environment.runtime) gaps.push("runtime_missing");
  if (manifest.environment.dependencies.length === 0) gaps.push("dependency_manifest_missing");
  if (!manifest.environment.hardware) gaps.push("hardware_requirement_missing");
  if (!manifest.environment.networkAccess) gaps.push("network_requirement_missing");
  if (!manifest.environment.estimatedCost) gaps.push("execution_cost_missing");
  if (!manifest.independentEvaluator) gaps.push("independent_evaluator_missing");
  return gaps.sort(stableCompare);
}

export function compilePaperExecutionCapsule(value: unknown): PaperExecutionCapsule {
  const manifest = parsePaperExecutionManifest(value);
  const capsuleId = `pec_${sha256(canonicalJson(manifest)).slice(0, 24)}`;
  const provenance = provenanceFor(manifest);

  return {
    schemaVersion: 1,
    framework: "paper_execution_capsule",
    capsuleId,
    reportOnly: true,
    autonomyChanged: false,
    authorityEffect: "none",
    scientificValidation: "not_established",
    summary: {
      sources: provenance.length,
      supportedTasks: manifest.supportedTasks.length,
      unsupportedTasks: manifest.unsupportedTasks.length,
      plannedReproductionChecks: manifest.tutorials.length,
      plannedNovelTaskChecks: manifest.supportedTasks.length,
    },
    sourceContract: {
      paper: manifest.paper,
      repository: manifest.repository ?? null,
      datasets: manifest.datasets,
      tutorials: manifest.tutorials,
    },
    taskContract: {
      supported: manifest.supportedTasks,
      unsupported: manifest.unsupportedTasks,
    },
    environmentContract: manifest.environment,
    reproducibilityPlan: {
      tutorialChecks: manifest.tutorials.map((tutorial) => ({
        name: tutorial.name,
        sourceUrl: tutorial.sourceUrl,
        expectedArtifacts: tutorial.expectedArtifacts,
        status: "planned_unexecuted",
      })),
      novelTaskChecks: manifest.supportedTasks.map((task) => ({
        task: task.name,
        requiredEvidence: [
          "independent expected result",
          "complete execution log",
          "artifact hashes",
          "environment identity",
        ],
        status: "planned_unexecuted",
      })),
      negativeChecks: manifest.unsupportedTasks.map((requestClass) => ({
        requestClass,
        expectedBehavior: "refuse_as_unsupported",
        status: "planned_unexecuted",
      })),
    },
    provenance,
    evidenceGaps: evidenceGaps(manifest),
    limitations: [
      "This report does not fetch, clone, install, execute, test, register, connect, or publish any source or tool.",
      "Caller-supplied URLs and metadata are structurally validated but their contents and reachability are unverified.",
      "A planned reproducibility check is not evidence that the original result was reproduced.",
      "Successful code execution would not by itself establish scientific correctness, causality, safety, or external validity.",
      "This capsule grants no approval, policy, spending, routing, tool, MCP, publication, or execution authority.",
    ],
  };
}