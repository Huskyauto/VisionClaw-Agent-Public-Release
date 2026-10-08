import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { generateEmbedding, cosineSimilarity } from "../embeddings";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { withTenantContext } from "./tenant-context";
import { generateHypotheticalMemoryDetailed, HYDE_FEW_SHOT_EXAMPLES } from "./hyde";
import {
  aggregateHydeQuality,
  assertHydeGoldenSetIsHeldOut,
  assertHydeGoldenManifest,
  assertHydeSemanticSeparation,
  generateBoundedShadowEmbedding,
  HYDE_QUERY_CATEGORIES,
  scoreRetrievalQuality,
  type HydeQualityAggregate,
  type HydeQualityCaseResult,
  type HydeQueryCategory,
} from "./hyde-observability";

interface GoldenDocument { id: string; text: string }
interface GoldenCase { id: string; category: HydeQueryCategory; query: string; relevantIds: string[] }
interface GoldenCorpus {
  version: number;
  corpusId: string;
  frozen: boolean;
  documents: GoldenDocument[];
  cases: GoldenCase[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateCorpus(
  value: unknown,
  manifest: Parameters<typeof assertHydeGoldenManifest>[0]["manifest"],
): { documents: GoldenDocument[]; cases: GoldenCase[] } {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.documents) || !Array.isArray(value.cases)) {
    throw new Error("invalid HyDE golden corpus root");
  }
  const data = value as unknown as GoldenCorpus;
  const documents = data.documents;
  const cases = data.cases;
  const ids = new Set<string>();
  for (const doc of documents) {
    if (!doc || typeof doc.id !== "string" || !doc.id || typeof doc.text !== "string" || !doc.text) {
      throw new Error("invalid HyDE golden document");
    }
    if (ids.has(doc.id)) throw new Error(`duplicate HyDE golden document: ${doc.id}`);
    ids.add(doc.id);
  }
  for (const item of cases) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.query !== "string" ||
      !(HYDE_QUERY_CATEGORIES as readonly string[]).includes(item.category) ||
      !Array.isArray(item.relevantIds) ||
      item.relevantIds.length === 0 ||
      item.relevantIds.some((id) => !ids.has(id))
    ) throw new Error(`invalid HyDE golden case: ${item?.id ?? "unknown"}`);
  }
  if (cases.length < 8) throw new Error("HyDE golden corpus requires at least 8 cases");
  assertHydeGoldenManifest({
    corpusId: data.corpusId,
    actualSha256: createHash("sha256").update(canonicalJson(value)).digest("hex"),
    caseIds: cases.map((item) => item.id),
    manifest,
  });
  assertHydeGoldenSetIsHeldOut({
    corpusId: data.corpusId,
    frozen: data.frozen,
    documents,
    cases,
    promptExamples: HYDE_FEW_SHOT_EXAMPLES,
  });
  return { documents, cases };
}

export async function runHydeRetrievalGoldenEval(): Promise<{
  aggregate: HydeQualityAggregate;
  cases: HydeQualityCaseResult[];
}> {
  return withTenantContext({ tenantId: ADMIN_TENANT_ID, source: "cron" }, async () => {
    const path = resolve(process.cwd(), "data/eval/hyde-retrieval-golden.json");
    const manifestPath = resolve(process.cwd(), "data/eval/hyde-retrieval-golden.manifest.json");
    const [corpusValue, manifest] = await Promise.all([
      readFile(path, "utf8").then(JSON.parse),
      readFile(manifestPath, "utf8").then(JSON.parse),
    ]);
    const corpus = validateCorpus(corpusValue, manifest);
    const documentVectors = new Map<string, number[]>();
    for (const document of corpus.documents) {
      const result = await generateBoundedShadowEmbedding(
        document.text,
        (text, signal) => generateEmbedding(text, { signal }),
      );
      if (!result.embedding) {
        const failed = corpus.cases.map<HydeQualityCaseResult>((item) => ({
          id: item.id,
          category: item.category,
          evaluated: false,
          failure: `document_embedding_${result.reason ?? "failed"}`,
        }));
        return { aggregate: aggregateHydeQuality(failed), cases: failed };
      }
      documentVectors.set(document.id, result.embedding);
    }
    const promptVectors: Array<{ user: number[]; output: number[] }> = [];
    for (const example of HYDE_FEW_SHOT_EXAMPLES) {
      const user = await generateBoundedShadowEmbedding(
        example.user,
        (text, signal) => generateEmbedding(text, { signal }),
      );
      const output = await generateBoundedShadowEmbedding(
        example.output,
        (text, signal) => generateEmbedding(text, { signal }),
      );
      if (!user.embedding || !output.embedding) {
        const failed = corpus.cases.map<HydeQualityCaseResult>((item) => ({
          id: item.id,
          category: item.category,
          evaluated: false,
          failure: "prompt_example_embedding_failed",
        }));
        return { aggregate: aggregateHydeQuality(failed), cases: failed };
      }
      promptVectors.push({ user: user.embedding, output: output.embedding });
    }
    const results: HydeQualityCaseResult[] = [];
    for (const item of corpus.cases) {
      const raw = await generateBoundedShadowEmbedding(item.query, (text, signal) =>
        generateEmbedding(text, { signal }));
      if (!raw.embedding) {
        results.push({ id: item.id, category: item.category, evaluated: false, failure: "raw_query_embedding_failed" });
        continue;
      }
      assertHydeSemanticSeparation({
        caseId: item.id,
        queryToPromptUserSimilarities: promptVectors.map((example) =>
          cosineSimilarity(raw.embedding!, example.user)),
        targetToPromptOutputSimilarities: item.relevantIds.flatMap((id) =>
          promptVectors.map((example) => cosineSimilarity(documentVectors.get(id)!, example.output))),
      });
      const generation = await generateHypotheticalMemoryDetailed(item.query);
      if (!generation.text) {
        results.push({ id: item.id, category: item.category, evaluated: false, failure: `hyde_${generation.outcome}` });
        continue;
      }
      const hyde = await generateBoundedShadowEmbedding(generation.text, (text, signal) =>
        generateEmbedding(text, { signal }));
      if (!hyde.embedding) {
        results.push({ id: item.id, category: item.category, evaluated: false, failure: "hyde_embedding_failed" });
        continue;
      }
      const rank = (queryVector: number[]) => corpus.documents
        .map((document) => ({ id: document.id, score: cosineSimilarity(queryVector, documentVectors.get(document.id)!) }))
        .sort((a, b) => b.score - a.score)
        .map((row) => row.id);
      results.push({
        id: item.id,
        category: item.category,
        evaluated: true,
        raw: scoreRetrievalQuality(rank(raw.embedding), item.relevantIds),
        hyde: scoreRetrievalQuality(rank(hyde.embedding), item.relevantIds),
      });
    }
    return { aggregate: aggregateHydeQuality(results), cases: results };
  });
}