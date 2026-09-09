/**
 * Extract the most useful human-facing reason from a render child's output.
 * stderr and stdout may be concatenated out of chronological order, so prefer
 * explicit failures over a harmless final progress line.
 */
export function renderFailureReason(output: string): string {
  const explicit = output.match(/(?:\[gh-render\] )?FAIL:\s*([^\n]+)/);
  if (explicit) return explicit[1].trim();

  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const isNoise = (line: string) =>
    /^Node\.js v\d/.test(line) ||
    /^\s*at\s/.test(line) ||
    /^node:internal\//.test(line) ||
    line === "^" ||
    /^\d+$/.test(line);
  const meaningful = lines.filter((line) => !isNoise(line));
  const errorLine = meaningful.find((line) =>
    /\b(Error|Exception|failed|failure|ENOENT|EACCES|EIO|ENOMEM|ETIMEDOUT|Cannot find|not found|refus|denied|killed|fatal)\b/i.test(line),
  );
  if (errorLine) return errorLine.slice(0, 300);
  return (meaningful[meaningful.length - 1] || lines[lines.length - 1] || "").slice(0, 300);
}