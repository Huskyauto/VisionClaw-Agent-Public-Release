import { reportDiagnostic } from "./safe-diagnostic";

/** Fixed public hosts, no credentials, redirects, synthesis API or paid fallback. */
export async function juryPublicSearch(query: string, fetchFn: typeof fetch = fetch) {
  if (typeof query !== "string" || !query.trim() || query.length > 300) {
    return { success: false, error: "Public query must be 1–300 characters", results: [] };
  }
  const signal = AbortSignal.timeout(5000);
  const read = async (url: string): Promise<string> => {
    const r = await fetchFn(url, { signal, redirect: "manual",
      headers: { Accept: "application/rss+xml,application/json", "User-Agent": "Mozilla/5.0" } });
    if (!r.ok || !r.body) throw new Error("Public source unavailable");
    const reader = r.body.getReader();
    let bytes = 0, content = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 96_000) { await reader.cancel(); throw new Error("Public source exceeds bounded response"); }
        content += decoder.decode(value, { stream: true });
      }
      return content + decoder.decode();
    } finally { reader.releaseLock(); }
  };
  const clean = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const results: { source: string; content: string; url: string; text: string }[] = [];
  try {
    const xml = await read(`https://www.bing.com/search?${new URLSearchParams({ q: query, format: "rss" })}`);
    for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const field = (name: string) => clean(item[1].match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? "");
      const url = field("link");
      if (/^https?:\/\//.test(url)) results.push({ url, text: field("description").slice(0, 650), source: field("title").slice(0, 180),
        content: `${field("description").slice(0, 650)} — ${url}` });
      if (results.length >= 4) break;
    }
  } catch {
    if (!signal.aborted) reportDiagnostic("[jury-public-search] Primary public search failed; using only the free fallback");
  }
  if (!results.length && !signal.aborted) {
    try {
      const body = JSON.parse(await read(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({
        action: "query", list: "search", srsearch: query, format: "json", srlimit: "3", utf8: "",
      })}`));
      for (const row of body?.query?.search ?? []) {
        if (typeof row.title === "string" && typeof row.snippet === "string") results.push({
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.title)}`, text: clean(row.snippet).slice(0, 650),
          source: row.title.slice(0, 180), content: `${clean(row.snippet).slice(0, 650)} — https://en.wikipedia.org/wiki/${encodeURIComponent(row.title)}`,
        });
      }
    } catch {
      if (!signal.aborted) reportDiagnostic("[jury-public-search] Free fallback failed; no verified public evidence");
    }
  }
  return { success: results.length > 0, query, provider: "public-no-paid-fallback",
    resultCount: results.length, results, ...(results.length ? {} : { error: "Public search unavailable; demand unknown" }) };
}
