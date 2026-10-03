export function buildCustomToolArgsSetup(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => `args[${JSON.stringify(key)}] = ${JSON.stringify(value)};`)
    .join("\n");
}