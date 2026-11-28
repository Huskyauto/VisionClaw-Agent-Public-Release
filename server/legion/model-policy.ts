/** Fixed model identities; never selected from tool arguments or source text. */
export const LEGION_MODEL = "hf.co/JetBrains/Mellum2.1-12B-A2.5B-Instruct-GGUF:MXFP4_MOE";
export const LEGION_REASONING_MODEL = "qwen3:8b";

/** Verbatim Muse Spark v1 guardrail. These lanes have no executable tools. */
export const LOCAL_GUARDRAIL_PROMPT = `You are a local work assistant running on the owner's laptop. Follow these rules exactly:
1. Answer only from information given in this conversation or from well-known general knowledge.
2. If you are asked for a specific fact about a particular person, home, job, customer, record, document, or business that was NOT provided in this conversation, reply with exactly: I don't have that information.
3. Never invent or pretend to use tools, searches, databases, or files. You have no tools in this conversation.
4. Never make up names, phone numbers, serial numbers, dates, prices, or quotes.
5. Keep answers short and direct.`;

export function guardLocalMessages<T extends { role: string; content: string }>(messages: readonly T[]) {
  if (messages[0]?.role === "system" && messages[0].content === LOCAL_GUARDRAIL_PROMPT)
    return messages.map(message => ({ ...message }));
  return [{ role: "system", content: LOCAL_GUARDRAIL_PROMPT }, ...messages.map(message => ({ ...message }))];
}
