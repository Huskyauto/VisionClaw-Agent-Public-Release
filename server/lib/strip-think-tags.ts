export function stripThinkTags(text: string): string {
  return text
    .replace(/^<!-- auto_route:\{[\s\S]*?\} -->\n?/, "")
    .replace(/^<!-- tools:\[[\s\S]*?\] -->\n?/, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .trim();
}
