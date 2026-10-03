import { logSilentCatch } from "./lib/silent-catch";

export function parseInlineToolCalls(text: string): any[] {
  const results: any[] = [];

  const jsonRegex = /\b(?:browse|browser)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let match;
  while ((match = jsonRegex.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[1].replace(/'/g, '"'));
      results.push({
        id: `inline_browser_${Date.now()}_${results.length}`,
        type: "function",
        function: { name: "browser", arguments: JSON.stringify(args) },
      });
    } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }
  }

  if (results.length === 0) {
    const kwRegex = /\b(?:browse|browser)\s+((?:action|url|selector|text|tabIndex|fullPage|script|ms|profile|returnBase64)\s*=\s*\S+(?:\s+(?:action|url|selector|text|tabIndex|fullPage|script|ms|profile|returnBase64)\s*=\s*\S+)*)/gi;
    while ((match = kwRegex.exec(text)) !== null) {
      const pairs = match[1];
      const args: Record<string, any> = {};
      const pairRegex = /(action|url|selector|text|tabIndex|fullPage|script|ms|profile|returnBase64)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|(\S+))/gi;
      let pm;
      while ((pm = pairRegex.exec(pairs)) !== null) {
        const key = pm[1];
        const val = pm[2] ?? pm[3] ?? pm[4];
        if (key === "tabIndex" || key === "ms") args[key] = Number(val);
        else if (key === "fullPage" || key === "returnBase64") args[key] = val === "true";
        else args[key] = val;
      }
      if (args.action) {
        results.push({
          id: `inline_browser_${Date.now()}_${results.length}`,
          type: "function",
          function: { name: "browser", arguments: JSON.stringify(args) },
        });
      }
    }
  }

  return results;
}

function normalizeDsmlMarkup(text: string): string {
  return text
    .replace(/｜/g, "|")
    .replace(/\|\s*DSML\s*\|/g, "")
    .replace(/<\s+/g, "<")
    .replace(/\s+>/g, ">")
    .replace(/<\s*\/\s*/g, "</");
}

export interface ToolMarkupStreamFilter {
  readonly sawToolMarkup: boolean;
  push(chunk: string): string;
  flush(): string;
}

export function createToolMarkupStreamFilter(): ToolMarkupStreamFilter {
  const maxPartialTagLength = 96;
  const toolMarkupStart = /<(?:\|\s*DSML\s*\|)?\s*(?:tool_calls?|function_calls?|invoke\b|tool_call\b)/i;
  let pending = "";
  let suppressing = false;
  let sawToolMarkup = false;

  return {
    get sawToolMarkup() {
      return sawToolMarkup;
    },
    push(chunk: string) {
      if (!chunk || suppressing) return "";
      pending += chunk;
      const normalized = pending.replace(/｜/g, "|");
      const match = toolMarkupStart.exec(normalized);
      if (match?.index !== undefined) {
        const safe = pending.slice(0, match.index);
        pending = "";
        suppressing = true;
        sawToolMarkup = true;
        return safe;
      }
      const lastOpen = pending.lastIndexOf("<");
      if (lastOpen === -1 || pending.indexOf(">", lastOpen) !== -1) {
        const safe = pending;
        pending = "";
        return safe;
      }
      const safe = pending.slice(0, lastOpen);
      pending = pending.slice(lastOpen);
      if (pending.length > maxPartialTagLength) {
        const overflow = pending.slice(0, pending.length - maxPartialTagLength);
        pending = pending.slice(-maxPartialTagLength);
        return safe + overflow;
      }
      return safe;
    },
    flush() {
      if (suppressing) return "";
      const safe = pending;
      pending = "";
      return safe;
    },
  };
}

export function stripXmlToolCallMarkup(text: string): string {
  return normalizeDsmlMarkup(text)
    .replace(/<tool_calls?>[\s\S]*?<\/tool_calls?>/gi, "")
    .replace(/<function_calls?>[\s\S]*?<\/(?:antml:)?function_calls?>/gi, "")
    .replace(/<invoke\s+name=["'][^"']*["'][^>]*>[\s\S]*?<\/(?:antml:)?invoke>/gi, "")
    .replace(/<\/?parameter\b[^>]*>/gi, "")
    .trim();
}

export function parseXmlToolCalls(text: string): any[] {
  const results: any[] = [];
  const cleaned = normalizeDsmlMarkup(text);

  const invokePatterns = [
    /<invoke\s+name="([^"]+)">([\s\S]*?)<\/antml:invoke>/g,
    /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g,
    /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/g,
  ];

  for (const regex of invokePatterns) {
    let match;
    while ((match = regex.exec(cleaned)) !== null) {
      const toolName = match[1];
      const body = match[2];
      const args: Record<string, string> = {};
      const paramRegex = /<(?:antml:)?parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:antml:)?parameter>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(body)) !== null) {
        let val = paramMatch[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val === "true") args[paramMatch[1]] = true as any;
        else if (val === "false") args[paramMatch[1]] = false as any;
        else if (/^\d+$/.test(val)) args[paramMatch[1]] = Number(val) as any;
        else args[paramMatch[1]] = val;
      }
      results.push({
        id: `xml_${toolName}_${Date.now()}_${results.length}`,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(args),
        },
      });
    }
    if (results.length > 0) break;
  }
  return results;
}