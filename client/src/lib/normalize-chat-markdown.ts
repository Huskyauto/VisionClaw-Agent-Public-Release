export function normalizeAssistantMarkdown(markdown: string): string {
  let activeFence: { marker: "`" | "~"; length: number } | null = null;

  return markdown
    .split("\n")
    .map((line) => {
      const fenceRun = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
      if (fenceRun) {
        const marker = fenceRun[0] as "`" | "~";
        if (!activeFence) {
          activeFence = { marker, length: fenceRun.length };
        } else if (activeFence.marker === marker && fenceRun.length >= activeFence.length) {
          activeFence = null;
        }
        return line;
      }
      if (activeFence) return line;

      return line.replace(
        /^(\s*\*\*(?:What this means, plainly|Best next move|Current honest status)\*\*)(?=[\p{L}\p{N}-])/iu,
        "$1 ",
      );
    })
    .join("\n");
}