import {
  appendLoopOutcome,
  type AppendLoopOutcomeInput,
} from "./loop-portfolio-store";

type EmitDependencies = {
  append?: (input: AppendLoopOutcomeInput) => Promise<any>;
  warn?: (message: string) => void;
};

async function appendWithRuntimeDb(input: AppendLoopOutcomeInput): Promise<any> {
  const { pool } = await import("../db");
  return appendLoopOutcome(pool, input);
}

export async function emitLoopOutcomeBestEffort(
  input: AppendLoopOutcomeInput,
  dependencies: EmitDependencies = {},
): Promise<any | null> {
  const append = dependencies.append ?? appendWithRuntimeDb;
  const warn = dependencies.warn ?? ((message: string) => console.warn(message));
  try {
    return await append(input);
  } catch (error) {
    warn(`[loop-portfolio] outcome telemetry failed open: ${(error as Error).message}`);
    return null;
  }
}