import { runWithPreparationDeadline } from "./preparation-deadline";

export class ModelAccessValidationUnavailableError extends Error {
  readonly code = "MODEL_ACCESS_VALIDATION_UNAVAILABLE";

  constructor(cause: unknown) {
    super("Model access could not be verified. Please try again.");
    this.name = "ModelAccessValidationUnavailableError";
    this.cause = cause;
  }
}

export async function selectTenantValidatedModel(options: {
  requestedModel: string;
  tenantId: number;
  timeoutMs: number;
  parentSignal?: AbortSignal;
  fallbackModel?: string;
  platformAdminVerified?: boolean;
  validate: (modelId: string, tenantId: number, platformAdminVerified?: boolean) => Promise<boolean>;
}): Promise<string> {
  if (options.requestedModel === "auto") return "auto";

  try {
    const allowed = await runWithPreparationDeadline(
      () => options.validate(
        options.requestedModel,
        options.tenantId,
        options.platformAdminVerified === true,
      ),
      {
        label: "model access validation",
        timeoutMs: options.timeoutMs,
        parentSignal: options.parentSignal,
      },
    );
    return allowed ? options.requestedModel : (options.fallbackModel ?? "gpt-5.6-sol");
  } catch (error) {
    if (options.parentSignal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    throw new ModelAccessValidationUnavailableError(error);
  }
}