import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PreparationDeadlineExceededError,
  runWithPreparationDeadline,
} from "../../server/lib/preparation-deadline";
import {
  createCompletionWithTimeout,
  StreamCreateTimeoutError,
} from "../../server/lib/stream-create-timeout";
import {
  ModelAccessValidationUnavailableError,
  selectTenantValidatedModel,
} from "../../server/lib/tenant-model-access";

const routesSource = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
const chatSource = fs.readFileSync(path.resolve("client/src/pages/chat.tsx"), "utf8");

describe("Felix preparation latency contract", () => {
  it("never initializes a model client after tenant entitlement validation times out", async () => {
    let clientInitializations = 0;

    await assert.rejects(
      async () => {
        const model = await selectTenantValidatedModel({
          requestedModel: "tenant-private-model",
          tenantId: 42,
          timeoutMs: 20,
          validate: () => new Promise<boolean>(() => {}),
        });
        clientInitializations += 1;
        return model;
      },
      (error: unknown) => error instanceof ModelAccessValidationUnavailableError,
    );

    assert.equal(clientInitializations, 0, "an unverifiable model must never reach client initialization");
  });

  it("passes verified platform-admin authority into model validation", async () => {
    let observedAdmin = false;
    const model = await selectTenantValidatedModel({
      requestedModel: "claude-fable-5-1",
      tenantId: 1,
      platformAdminVerified: true,
      timeoutMs: 100,
      validate: async (_modelId, _tenantId, platformAdminVerified) => {
        observedAdmin = platformAdminVerified === true;
        return observedAdmin;
      },
    });

    assert.equal(model, "claude-fable-5-1");
    assert.equal(observedAdmin, true);
  });

  it("publishes immediate, timed preparation phases through first action", () => {
    const phases = [
      'sendStatus("connecting")',
      'sendStatus("loading_context")',
      'sendStatus("routing")',
      'sendStatus("preparing")',
      'sendStatus("starting")',
    ];
    let previous = -1;
    for (const phase of phases) {
      const next = routesSource.indexOf(phase);
      assert.ok(next > previous, `${phase} must appear in preparation order`);
      previous = next;
    }
    assert.match(routesSource, /type: "status", phase, elapsedMs/);
    assert.match(chatSource, /starting_without_optional_context: "Starting without delayed optional context…"/);
  });

  it("bounds ordinary text context reads with empty safe fallbacks", () => {
    assert.match(routesSource, /const CONTEXT_LOAD_TIMEOUT_MS = parseTimeoutMs/);
    assert.match(routesSource, /runContextLoad\("memory context"[\s\S]*?\{ data: \[\], total: 0, hasMore: false \}/);
    assert.match(routesSource, /runContextLoad\("enabled skills"[\s\S]*?, \[\]\)/);
    assert.match(routesSource, /runContextLoad\("knowledge context"[\s\S]*?\{ data: \[\], total: 0, hasMore: false \}/);
    assert.match(routesSource, /label: "prompt context"[\s\S]*?PROMPT_CONTEXT_TIMEOUT_MS/);
    assert.match(routesSource, /label: "project context"[\s\S]*?PROJECT_CONTEXT_TIMEOUT_MS/);
    const defaultMs = (name: string) => {
      const match = routesSource.match(new RegExp(`const ${name} = parseTimeoutMs\\([^,]+, ([\\d_]+)\\)`));
      assert.ok(match, `${name} default must remain explicit`);
      return Number(match[1].replaceAll("_", ""));
    };
    const fixedModelFirstRequestBudget =
      defaultMs("CONTEXT_LOAD_TIMEOUT_MS")
      + defaultMs("MODEL_CLIENT_INIT_TIMEOUT_MS")
      + defaultMs("PROMPT_CONTEXT_TIMEOUT_MS")
      + defaultMs("MODEL_CLIENT_INIT_TIMEOUT_MS");
    assert.ok(
      fixedModelFirstRequestBudget <= 15_000,
      `ordinary fixed-model preparation budget is ${fixedModelFirstRequestBudget}ms`,
    );
  });

  it("keeps screenshots on the validated image path without document extraction", () => {
    assert.match(routesSource, /const imageAtts = atts\.filter\(\(a\) => a\.type\.startsWith\("image\/"\)\)/);
    assert.match(routesSource, /realPath\.startsWith\(uploadsReal \+ path\.sep\)/);
    assert.match(routesSource, /const MAX_INLINE_IMAGE_BYTES = 8 \* 1024 \* 1024/);
    assert.match(routesSource, /imageBytes <= MAX_INLINE_IMAGE_BYTES/);
    assert.match(routesSource, /restoredBytes <= MAX_INLINE_IMAGE_BYTES/);
    assert.match(routesSource, /parts\.push\(\{ type: "image_url", image_url: \{ url: imgUrl \} \}\)/);
    assert.doesNotMatch(
      routesSource,
      /if \(f\.type\.startsWith\("image\/"\)\)[\s\S]{0,200}extract(?:PdfText|TextFromFile)/,
    );
  });

  it("bounds PDF, DOCX, Google Doc, and mixed attachment work concurrently", () => {
    assert.match(routesSource, /PDF extraction for \$\{f\.name \|\| "attachment"\}/);
    assert.match(routesSource, /extractTextFromFile\(docPath, fExt \|\| "\.docx"\)/);
    assert.match(routesSource, /Google Doc fetch for \$\{f\.name \|\| "attachment"\}/);
    assert.match(routesSource, /fetch\(`https:\/\/www\.googleapis\.com\/drive\/v3\/files\/\$\{docId\}\/export\?mimeType=text\/plain`, \{[\s\S]*?signal,/);
    assert.match(routesSource, /const attachmentTasks = new Map<string, Promise<void>>\(\)/);
    assert.match(routesSource, /await Promise\.all\(attachmentTasks\.values\(\)\)/);
    assert.match(routesSource, /const inlineGoogleDocTasks = new Map<string, Promise<void>>\(\)/);
    assert.match(routesSource, /do not claim to have read it/);
    assert.match(routesSource, /resolveValidatedUploadPath/);
    assert.match(routesSource, /PDF parser loading/);
    assert.match(routesSource, /Drive export HTTP \$\{(?:gdocResp|resp)\.status\}/);
  });

  it("releases each delayed attachment class at the deadline", async () => {
    const kinds = ["PDF", "DOCX", "Google Doc", "mixed attachment"];
    const startedAt = Date.now();
    const outcomes = await Promise.allSettled(
      kinds.map((kind) =>
        runWithPreparationDeadline(
          () => new Promise<never>(() => {}),
          { timeoutMs: 20, label: kind },
        ),
      ),
    );
    assert.ok(Date.now() - startedAt < 250, "attachment deadlines must run concurrently");
    for (const [index, outcome] of outcomes.entries()) {
      assert.equal(outcome.status, "rejected");
      assert.ok(outcome.status === "rejected" && outcome.reason instanceof PreparationDeadlineExceededError);
      assert.equal((outcome as PromiseRejectedResult).reason.label, kinds[index]);
    }
  });

  it("aborts a delayed provider creation and leaves failover possible", async () => {
    const shared = new AbortController();
    let providerSignalAborted = false;
    await assert.rejects(
      createCompletionWithTimeout(
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              providerSignalAborted = true;
              reject(new Error("provider cancelled"));
            }, { once: true });
          }),
        shared.signal,
        20,
        "delayed-provider",
      ),
      (error: unknown) => {
        assert.ok(error instanceof StreamCreateTimeoutError);
        assert.equal((error as StreamCreateTimeoutError).modelId, "delayed-provider");
        return true;
      },
    );
    assert.equal(providerSignalAborted, true);
    assert.equal(shared.signal.aborted, false, "local timeout must not poison the shared failover signal");

    assert.doesNotMatch(routesSource, /await activeClient\.chat\.completions\.create\(/);
    assert.match(routesSource, /createCompletionWithTimeout\([\s\S]*?STREAM_CREATE_TIMEOUT_MS/);
  });
});