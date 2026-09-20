/**
 * Server-only capabilities for the render pipeline.
 *
 * Symbols cannot be supplied through JSON tool arguments, so callers outside
 * the process cannot use these markers to bypass durability requirements.
 */
const INTERNAL_RENDER_STAGING = Symbol("visionclaw.internalRenderStaging");

export function markInternalRenderStaging<T extends Record<string, unknown>>(request: T): T {
  Object.defineProperty(request, INTERNAL_RENDER_STAGING, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return request;
}

export function isInternalRenderStaging(request: unknown): boolean {
  return Boolean(
    request &&
      typeof request === "object" &&
      (request as Record<PropertyKey, unknown>)[INTERNAL_RENDER_STAGING] === true,
  );
}

export function inheritInternalRenderStaging<T extends Record<string, unknown>>(
  source: unknown,
  target: T,
): T {
  return isInternalRenderStaging(source) ? markInternalRenderStaging(target) : target;
}

export function markInternalTransientTtsSegment<T extends Record<string, unknown>>(request: T): T {
  return markInternalRenderStaging(request);
}

export function isInternalTransientTtsSegment(request: unknown): boolean {
  return isInternalRenderStaging(request);
}

export function shouldRequireAudioDriveDurability(request: unknown): boolean {
  return !isInternalRenderStaging(request);
}

export function shouldRequireFinalRenderDriveDurability(request: unknown): boolean {
  return !isInternalRenderStaging(request);
}

export function shouldPublishLocalProductOutput(request: unknown): boolean {
  return !isInternalRenderStaging(request);
}