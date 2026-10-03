/** A queued/silenced result or a resolved call without a message id is not provider acceptance. */
export function isAcceptedMailResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.queued !== true && result.silenced !== true
    && [result.messageId, result.id, result.message_id]
      .some((id) => typeof id === "string" && id.trim().length > 0);
}