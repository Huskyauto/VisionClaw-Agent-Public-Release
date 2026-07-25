import { replitOpenai } from "./providers";
import { executeTool } from "./tools";

import { logSilentCatch } from "./lib/silent-catch";
export interface ResearchSource {
  url?: string;
  title: string;
  snippet: string;
  reliability: "high" | "medium" | "low";
}

export interface ResearchReport {
  query: string;
  answer: string;
  sources: ResearchSource[];
  confidence: "high" | "medium" | "low";
  followUpQuestions: string[];
  executionTimeMs: number;
}

async function generateSearchQueries(question: string): Promise<string[]> {
  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: `Generate 2-3 focused search queries to research this question. Return ONLY a JSON array of strings. Diversify angles — don't just rephrase the same query.` },
        { role: "user", content: question },
      ],
      max_completion_tokens: 150,
      temperature: 0.3,
    });
    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.filter((q: any) => typeof q === "string").slice(0, 3);
    }
  } catch (_silentErr) { logSilentCatch("server/research-pipeline.ts", _silentErr); }
  return [question];
}

async function searchAndGather(queries: string[]): Promise<{ searchResults: any[]; fetchedContent: string[] }> {
  const searchResults: any[] = [];
  const fetchedContent: string[] = [];

  for (const query of queries) {
    try {
      const result = await executeTool("web_search", { query });
      if (result && !result.error) {
        searchResults.push({ query, result });
      }
    } catch (_silentErr) { logSilentCatch("server/research-pipeline.ts", _silentErr); }
  }

  const urlsToFetch: string[] = [];
  for (const sr of searchResults) {
    const resultStr = JSON.stringify(sr.result);
    const urlMatches = resultStr.match(/https?:\/\/[^\s"'<>\]]+/g) || [];
    for (const url of urlMatches) {
      if (!url.includes("google.com/search") && !url.includes("bing.com") && urlsToFetch.length < 3) {
        urlsToFetch.push(url);
      }
    }
  }

  const fetchPromises = urlsToFetch.slice(0, 3).map(async (url) => {
    try {
      const result = await executeTool("web_fetch", { url });
      if (result && !result.error) {
        const content = typeof result === "string" ? result : JSON.stringify(result);
        return content.slice(0, 3000);
      }
    } catch (_silentErr) { logSilentCatch("server/research-pipeline.ts", _silentErr); }
    return null;
  });

  const fetched = await Promise.all(fetchPromises);
  fetchedContent.push(...fetched.filter((f): f is string => f !== null));

  return { searchResults, fetchedContent };
}

export async function deepResearch(question: string, depth: "quick" | "standard" | "thorough" = "standard"): Promise<ResearchReport> {
  const start = Date.now();

  const queryCount = depth === "quick" ? 1 : depth === "thorough" ? 3 : 2;
  const allQueries = await generateSearchQueries(question);
  const queries = allQueries.slice(0, queryCount);

  const { searchResults, fetchedContent } = await searchAndGather(queries);

  const searchContext = searchResults.map(sr =>
    `[Search: "${sr.query}"]\n${JSON.stringify(sr.result).slice(0, 2000)}`
  ).join("\n\n");

  const fetchContext = fetchedContent.map((c, i) =>
    `[Source ${i + 1}]\n${c}`
  ).join("\n\n");

  const synthesisPrompt = `You are a research analyst. Synthesize the following search results and source content into a comprehensive answer.

Research question: ${question}

Search Results:
${searchContext || "(no search results)"}

Source Content:
${fetchContext || "(no additional sources fetched)"}

Respond with ONLY valid JSON:
{
  "answer": "comprehensive answer with specific facts, numbers, and details",
  "sources": [{"title": "source name", "snippet": "key finding from this source", "reliability": "high|medium|low"}],
  "confidence": "high|medium|low",
  "followUpQuestions": ["question 1", "question 2"]
}`;

  try {
    const model = depth === "thorough" ? "gpt-4.1" : "gemini-2.5-flash";
    const resp = await replitOpenai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a thorough research analyst. Always cite specific facts and provide actionable insights." },
        { role: "user", content: synthesisPrompt },
      ],
      max_completion_tokens: 16384,
      temperature: 0.2,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        query: question,
        answer: parsed.answer || "Research completed but could not synthesize a clear answer.",
        sources: (parsed.sources || []).map((s: any) => ({
          title: s.title || "Unknown",
          snippet: s.snippet || "",
          url: s.url,
          reliability: s.reliability || "medium",
        })),
        confidence: parsed.confidence || "medium",
        followUpQuestions: parsed.followUpQuestions || [],
        executionTimeMs: Date.now() - start,
      };
    }

    return {
      query: question,
      answer: text || "Research completed but synthesis failed.",
      sources: [],
      confidence: "low",
      followUpQuestions: [],
      executionTimeMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      query: question,
      answer: `Research failed: ${err.message}`,
      sources: searchResults.map(sr => ({
        title: `Search: ${sr.query}`,
        snippet: JSON.stringify(sr.result).slice(0, 200),
        reliability: "low" as const,
      })),
      confidence: "low",
      followUpQuestions: [],
      executionTimeMs: Date.now() - start,
    };
  }
}
