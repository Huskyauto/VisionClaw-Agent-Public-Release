/** Presentation-only subdivision. Never repair JSON, alter a fact/reference,
 * infer a citation, discard a field, or rewrite the retained provider response.
 * The complete semantic/evidence validator must still accept the result. */
export function subdivideCompilationAdvisories(input: unknown): unknown {
  const report = input as any;
  if (!Array.isArray(report?.sections) || report.sections.length !== 6) return input;
  return { ...report, sections: report.sections.map((section: any) => {
    if (!Array.isArray(section?.blocks) || section.blocks.length > 24) return section;
    const blocks = section.blocks.flatMap((block: any) => {
      if (!block || !["recommendation", "assumption"].includes(block.type) ||
          typeof block.text !== "string" || block.text.length <= 3000 ||
          block.text.length > 90_000 ||
          Object.keys(block).some(key => !["type", "text", "sourceIds"].includes(key)) ||
          !Array.isArray(block.sourceIds) || block.sourceIds.length > 30 ||
          block.sourceIds.some((id: unknown) => typeof id !== "string")) return [block];
      const parts: string[] = [];
      let remaining: string = block.text;
      while (remaining.length > 3000) {
        // Keep every separator on its original side of the boundary. Never
        // split a UTF-16 surrogate pair or leave an invalid tiny final block.
        const max = Math.min(3000, remaining.length - 10);
        let at = max;
        for (let i = max; i >= Math.max(10, max - 400); i--)
          if (/\s/.test(remaining[i - 1])) { at = i; break; }
        if (/[\uD800-\uDBFF]/.test(remaining[at - 1])) at--;
        const part = remaining.slice(0, at);
        remaining = remaining.slice(at);
        if (part.trim().length < 10 || remaining.trim().length < 10) return [block];
        parts.push(part);
      }
      parts.push(remaining);
      if (parts.join("") !== block.text) throw new Error("Compilation layout preservation failed");
      return parts.map(text => ({ ...block, text, sourceIds: [...block.sourceIds] }));
    });
    // If subdivision cannot fit the section contract, leave it invalid so
    // ordinary bounded correction receives the failure. Never drop content.
    return blocks.length > 24 ? section : { ...section, blocks };
  }) };
}
