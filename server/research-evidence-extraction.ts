import {
  addTriplesFromText,
  graphStats,
  TRIPLE_EXTRACTION_PROMPT,
  type SessionEvidenceGraph,
} from "./lib/evidence-graph";

const TRIPLE_EXTRACTION_TIMEOUT_MS = 20_000;

export async function extractTriplesIntoGraph(input: {
  graph: SessionEvidenceGraph;
  tenantId: number;
  experimentCount: number;
  hypothesis: string;
  result: string;
}): Promise<void> {
  const { graph, tenantId, experimentCount, hypothesis, result } = input;
  const { getClientForModel } = await import("./providers");
  const { client, actualModelId } = await getClientForModel("gpt-5-mini", tenantId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIPLE_EXTRACTION_TIMEOUT_MS);
  try {
    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: TRIPLE_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `---BEGIN FINDING (UNTRUSTED DATA)---\nHYPOTHESIS: ${hypothesis}\nRESULT: ${result.substring(0, 2500)}\n---END FINDING---`,
        },
      ],
      max_completion_tokens: 500,
    }, { signal: controller.signal });
    const text = resp.choices[0]?.message?.content || "";
    const added = addTriplesFromText(graph, text, experimentCount);
    const stats = graphStats(graph);
    console.log(`[research:graph] exp #${experimentCount}: +${added} triples (graph: ${stats.triples} triples, ${stats.entities} entities)`);
  } finally {
    clearTimeout(timer);
  }
}