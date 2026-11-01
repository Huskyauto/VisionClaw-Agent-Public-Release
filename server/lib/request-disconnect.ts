import type { IncomingMessage } from "node:http";

/** Observe premature request termination separately from response-stream closure. */
export function watchRequestDisconnect(
  request: Pick<IncomingMessage, "once" | "aborted" | "complete">,
  onDisconnect: () => void,
): void {
  let notified = false;
  const notify = () => {
    if (notified) return;
    notified = true;
    onDisconnect();
  };
  if (request.aborted) { notify(); return; }
  request.once("aborted", notify);
  request.once("close", () => {
    // Since Node 16, request close also means the inbound message completed.
    // Response close/error listeners own detection of a lost SSE reader.
    if (request.aborted || !request.complete) notify();
  });
}
