const DEFAULT_LIMIT = 12_000;

/**
 * Keep enough startup context to identify the command while prioritizing the
 * final status/error lines emitted after long, noisy maintenance runs.
 */
export function retainDiagnosticOutput(output: string, limit = DEFAULT_LIMIT): string {
  if (limit <= 0) return "";
  if (output.length <= limit) return output;

  const marker = "\n\n… middle omitted; final diagnostics preserved …\n\n";
  if (marker.length >= limit) return output.slice(-limit);

  const available = limit - marker.length;
  const headSize = Math.max(1, Math.floor(available * 0.2));
  const tailSize = available - headSize;
  return `${output.slice(0, headSize)}${marker}${output.slice(-tailSize)}`;
}