export function parseProposalDiff(codeDiff: string): { oldCode: string; newCode: string } | null {
  if (!codeDiff || typeof codeDiff !== "string") return null;
  const oldMatch = codeDiff.match(/<<<OLD_CODE>>>([\s\S]*?)<<<\/OLD_CODE>>>/);
  const newMatch = codeDiff.match(/<<<NEW_CODE>>>([\s\S]*?)<<<\/NEW_CODE>>>/);
  if (oldMatch && newMatch) {
    return { oldCode: oldMatch[1].trim(), newCode: newMatch[1].trim() };
  }
  const lines = codeDiff.split("\n");
  const oldStart = lines.findIndex(l => l.startsWith("- OLD CODE:"));
  const newStart = lines.findIndex(l => l.startsWith("+ NEW CODE:"));
  if (oldStart === -1 || newStart === -1 || newStart <= oldStart) return null;
  return {
    oldCode: lines.slice(oldStart + 1, newStart).join("\n").trim(),
    newCode: lines.slice(newStart + 1).join("\n").trim(),
  };
}

export function findExactMatch(fileContent: string, searchCode: string): string | null {
  if (fileContent.includes(searchCode)) return searchCode;

  const searchNorm = searchCode.replace(/\s+/g, " ").trim();
  const lines = fileContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (let len = 1; len <= Math.min(50, lines.length - i); len++) {
      const chunk = lines.slice(i, i + len).join("\n");
      if (chunk.replace(/\s+/g, " ").trim() === searchNorm) {
        return chunk;
      }
    }
  }
  return null;
}
