import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TITLE =
  "Recursive Language Models (RLM) — Zhang/Kraska/Khattab, MIT CSAIL, arXiv:2512.24601v2 (Jan 2026)";

const CONTENT = `SOURCE: arXiv:2512.24601v2 — "Recursive Language Models" by Alex L. Zhang, Tim Kraska, Omar Khattab (MIT CSAIL), Jan 29 2026.
LOCAL PDF: attached_assets/2512.24601v2_1777420765844.pdf
CODE: https://github.com/alexzhang13/rlm

== Core idea ==
Long prompts should NOT be fed directly into the model's context window. Instead, the prompt is loaded as a variable inside an external REPL. The root LLM is given only constant-size metadata (length, prefix, suffix) and writes code that programmatically inspects, slices, and recursively invokes a sub-LLM on portions of the prompt. Final answer is set into a special variable.

== Algorithm 1 (the correct design) ==
1. state = InitREPL(prompt = P)
2. state.AddFunction(sub_RLM)
3. hist = [Metadata(state)]
4. loop:
     code = LLM(hist)
     state, stdout = REPL(state, code)
     hist += code + Metadata(stdout)
     if state.Final is set: return state.Final

== Three design choices that make RLMs work (vs. Algorithm 2 anti-pattern) ==
1. Symbolic handle to the prompt — the model never sees the full P, only inspects via slice/peek.
2. Output also lives as a REPL variable (Final) — bypasses the underlying model's output length cap.
3. Programmatic recursion — sub-calls happen INSIDE code (inside loops), enabling Ω(|P|) or Ω(|P|^2) work, not just a few verbal sub-tasks.

== Headline results (Table 1 of paper) ==
- BrowseComp+ (1K docs, 6M-11M tokens): RLM(GPT-5) = 91.3% vs base GPT-5 = 0% (context overflow). Cost $0.99 vs ~$2 extrapolated.
- LongBench-v2 CodeQA (23K-4.2M tokens): RLM(GPT-5) = 62% vs base = 24%, vs Summary agent = 58%.
- OOLONG (131K tokens): RLM(GPT-5) = 56.5% vs base = 44%, vs Summary agent = 46%.
- OOLONG-Pairs (32K tokens, quadratic complexity): RLM(GPT-5) = 58% vs base = 0.1%, vs Summary agent = 0.1%.
- Cost: comparable at p50; tail can spike on hard tasks. RLM(GPT-5) used GPT-5 as root + GPT-5-mini for sub-calls.
- Fine-tuned Qwen3-8B as RLM beats base Qwen3-8B by median +28.3% across 4 tasks using only 1000 training trajectories.

== Why context compaction (summary agent) is insufficient ==
Compaction presumes that some early-prompt details can be safely forgotten. False for tasks needing dense access throughout the prompt — exactly where VisionClaw chat over a full project history fails.

== VisionClaw integration map ==
1. Chat fallback: server/recursive-llm.ts wired as recovery path when streaming gpt-5 call fails or context exceeds threshold (~150K tokens). Implements Algorithm 1 in JS via Node vm sandbox: prompt + len/slice/chunkText/subLLM/setFinal/print bindings, max 8 root iterations, max 50 sub-calls, gpt-5 root + gpt-5-mini sub. Direct fix for the "network error" class on long Agent Blueprint conversations.
2. Autoresearch proposal generator (research_programs / research_experiments / research_evidence): currently producing 0 code proposals from 50-100+ experiments/wk per the wiring invariants. RLM-style decomposition over the experiment corpus could finally turn nightly research into shipped capability proposals.
3. Felix loop and chief-of-staff long-horizon planning: RLM enables true full-history synthesis instead of compacted summaries.
4. Semantic memory (memory_entries + agent_knowledge with HNSW pgvector): COMPLEMENTARY, not a replacement. Vector search finds the haystack; RLM walks it.

== When NOT to use ==
- Short user chats — direct call wins on cost and latency.
- Single-fact lookups — vector retrieval is cheaper.
- Tool-burst orchestration — already solved by job-worker spool.

== Cost discipline ==
- Bounded loop: max 8 root rounds, max 50 sub-calls per RLM invocation.
- Sub-prompts capped at 200K chars each.
- Use gpt-5-mini (or cheaper model) for sub-calls; reserve gpt-5/Opus for the root.
- Trigger only when (tokens > 150K) OR (direct call failed) OR (explicit opt-in).

== Files ==
- server/recursive-llm.ts — implementation
- scripts/test-rlm.ts — synthetic long-prompt verification harness
- attached_assets/2512.24601v2_1777420765844.pdf — full paper (1865 lines)

== When to revisit this knowledge ==
Whenever an agent observes:
- Repeated streaming failures on long-context conversations
- Project briefs/transcripts/memory exceeding 150K tokens
- A research/synthesis task that requires touching every entry of a large corpus
- Plans for a new "deep research" or "full-history" feature
the autoresearch programs should propose RLM as the implementation pattern.`;

async function main() {
  const existing: any = await db.execute(
    sql`SELECT id FROM agent_knowledge WHERE title = ${TITLE} LIMIT 1`,
  );
  if (existing.rows && existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await db.execute(sql`
      UPDATE agent_knowledge
      SET content = ${CONTENT},
          category = 'research',
          priority = 1,
          source = 'paper:arxiv',
          updated_at = now()
      WHERE id = ${id}
    `);
    console.log(`[knowledge] Updated agent_knowledge entry #${id}`);
  } else {
    const inserted: any = await db.execute(sql`
      INSERT INTO agent_knowledge (title, content, category, priority, source, tenant_id)
      VALUES (${TITLE}, ${CONTENT}, 'research', 1, 'paper:arxiv', 1)
      RETURNING id
    `);
    const id = inserted.rows?.[0]?.id;
    console.log(`[knowledge] Inserted agent_knowledge entry #${id}`);
  }

  const sample: any = await db.execute(sql`
    SELECT id, title, category, priority, source, LEFT(content, 80) AS preview
    FROM agent_knowledge
    WHERE title = ${TITLE}
  `);
  console.log("[knowledge] Verification:", JSON.stringify(sample.rows?.[0], null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[knowledge] failed:", err);
    process.exit(1);
  });
