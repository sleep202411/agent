import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";

/** Reloads and a second view of unchanged content share the same admission identity. */
export function reconcileAppearanceWebContext(
  previous: AppearanceDesignRequest,
  next: AppearanceDesignRequest
): AppearanceDesignRequest {
  const content = (request: AppearanceDesignRequest) =>
    JSON.stringify({ ...request, requestId: undefined });
  return content(previous) === content(next) ? previous : next;
}
