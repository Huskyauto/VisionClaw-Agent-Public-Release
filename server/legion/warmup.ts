import { LEGION_MODEL, guardLocalMessages } from "./model-policy";
import { legionBackgroundEnabled, legionProxyPort, legionShutdownSignal } from "./runtime";
import { legionRequest } from "./proxy-client";
import { withLocalInferenceSlot } from "./local-slots";

let lastSuccess = 0;
let pending: Promise<void> | undefined;
export const legionModelWarm = () => Date.now() - lastSuccess < 270_000;

/** Synthetic, single-flight and slot-bounded. Never awaited by user-facing work. */
export function warmLegionModel(): Promise<void> {
  if (pending) return pending;
  if (!legionBackgroundEnabled() || Date.now() - lastSuccess < 210_000) return Promise.resolve();
  pending = (async () => {
    try {
      const response = await withLocalInferenceSlot("legion-local", legionShutdownSignal(), signal =>
        legionRequest(legionProxyPort(), "/v1/chat/completions", {
          model: LEGION_MODEL, stream: false, temperature: 0, max_tokens: 4, reasoning_effort: "none",
          messages: guardLocalMessages([{ role: "user", content: "Reply with exactly OK." }]),
        }, 90_000, signal));
      if (response.model !== LEGION_MODEL ||
          response.choices?.[0]?.message?.content?.trim() !== "OK" ||
          response.choices?.[0]?.message?.tool_calls?.length)
        throw Error("Local warmup response did not pass its synthetic control");
      lastSuccess = Date.now();
      console.info(JSON.stringify({ event: "local_model_warmup", model: LEGION_MODEL, status: "ready" }));
    } catch {
      lastSuccess = 0;
      console.info(JSON.stringify({ event: "local_model_warmup", model: LEGION_MODEL, status: "unavailable" }));
    } finally { pending = undefined; }
  })();
  return pending;
}
