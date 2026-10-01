import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  ContentGpsToolInputSchema,
  ContentGpsToolOutputSchema,
  CreatorGpsToolInputSchema,
  CreatorGpsToolOutputSchema,
} from "@repo/agent-tools";
import {
  ContentGpsSearchResultSchema,
  type ContentGpsSearchRequest,
} from "@repo/shared/content-gps";
import {
  CreatorDiscoveryResultSchema,
  type CreatorDiscoveryRequest,
} from "@repo/shared/creator-location";

/** Implemented by the authenticated catalogue host, never by model arguments.
 * Each read must recheck viewer access. No preloaded all-IP dump or DB port. */
export interface DiscoveryQueryPort {
  searchIps(input: ContentGpsSearchRequest, signal: AbortSignal): Promise<unknown>;
  searchCreators(input: CreatorDiscoveryRequest, signal: AbortSignal): Promise<unknown>;
}
export interface DiscoveryToolHost {
  locale: ContentGpsSearchRequest["query"]["locale"];
  coordinateSystem: ContentGpsSearchRequest["map"]["coordinateSystem"];
  port: DiscoveryQueryPort;
}

async function read<T>(signal: AbortSignal, invoke: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new Error("Discovery cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return invoke();
      })
      .then((value) => {
        signal.throwIfAborted();
        resolve(value);
      })
      .catch(reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

/** Only these two registered query tools are executable in discovery. The
 * caller's capability set cannot expose project writes or paid analysis. */
export async function executeDiscoveryTool(
  toolId: string,
  raw: unknown,
  host: DiscoveryToolHost,
  signal: AbortSignal
): Promise<unknown> {
  signal.throwIfAborted();
  const requestId = randomUUID();
  if (toolId === "discovery.searchIps") {
    const input = ContentGpsToolInputSchema.parse(raw);
    const query = { ...input.query, locale: host.locale };
    const result = ContentGpsSearchResultSchema.parse(
      await read(signal, () =>
        host.port.searchIps(
          {
            ...input,
            requestId,
            query,
            selectedIpId: null,
            map: {
              coordinateSystem: host.coordinateSystem,
              west: -180,
              east: 180,
              south: -90,
              north: 90,
            },
          },
          signal
        )
      )
    );
    if (
      result.requestId !== requestId ||
      !isDeepStrictEqual(result.query, query) ||
      (input.cursor && input.cursor.queryId !== result.queryId) ||
      (result.nextCursor && result.nextCursor.queryId !== result.queryId) ||
      result.items.some((item) => !item.matched) ||
      result.items.length > input.limit
    )
      throw new Error("Discovery catalogue response does not match the requested query");
    return ContentGpsToolOutputSchema.parse({
      queryId: result.queryId,
      query: result.query,
      items: result.items,
      nextCursor: result.nextCursor,
      matchedCount: result.matchedCount,
      accessibleCount: result.accessibleCount,
      countScope: result.countScope,
      places: result.places,
      placeCount: result.placeCount,
      placesTruncated: result.placesTruncated,
    });
  }
  if (toolId === "discovery.searchCreators") {
    const input = CreatorGpsToolInputSchema.parse(raw);
    const result = CreatorDiscoveryResultSchema.parse(
      await read(signal, () =>
        host.port.searchCreators(
          { ...input, requestId, selectedCreatorId: null, map: null },
          signal
        )
      )
    );
    if (
      result.requestId !== requestId ||
      !isDeepStrictEqual(result.query, input.query) ||
      (input.cursor && input.cursor.queryId !== result.queryId) ||
      (result.nextCursor && result.nextCursor.queryId !== result.queryId) ||
      result.items.some((item) => !item.matched) ||
      result.items.length > input.limit
    )
      throw new Error("Discovery catalogue response does not match the requested query");
    return CreatorGpsToolOutputSchema.parse({
      queryId: result.queryId,
      query: result.query,
      items: result.items,
      nextCursor: result.nextCursor,
      matchedCount: result.matchedCount,
      accessibleCount: result.accessibleCount,
      countScope: result.countScope,
      requiresLogin: result.requiresLogin,
    });
  }
  throw new Error(`Unsupported discovery tool: ${toolId}`);
}
