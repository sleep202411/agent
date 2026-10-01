import { z } from "zod";
import {
  DiscoveryReadCredentialSchema,
  DiscoveryReadRequestSchema,
} from "@repo/shared/discovery-assistant";
import { ContentGpsSearchResultSchema } from "@repo/shared/content-gps";
import { CreatorDiscoveryResultSchema } from "@repo/shared/creator-location";
import type { DiscoveryQueryPort } from "./discovery-tools.js";

const MAX_BYTES = 3 * 1024 * 1024;
const ErrorEnvelope = z.object({ message: z.string().max(2000) });

/** A scoped read credential, unlike a model-supplied actor ID, can only read
 * while the authenticated server admission remains live. No automatic retry. */
export function createDiscoveryQueryPort(options: {
  baseUrl: string;
  internalToken: string;
  credential: z.infer<typeof DiscoveryReadCredentialSchema>;
  fetcher?: typeof fetch;
}): DiscoveryQueryPort {
  const base = new URL(options.baseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid discovery domain URL");
  if (options.internalToken.trim().length < 16)
    throw new Error("Discovery internal token is not configured");
  const credential = DiscoveryReadCredentialSchema.parse(options.credential);
  const endpoint = `${base.toString().replace(/\/$/, "")}/internal/content-gps/discovery/read`;
  const fetcher = options.fetcher ?? fetch;
  async function read(kind: "ips" | "creators", raw: unknown, parent: AbortSignal) {
    parent.throwIfAborted();
    const body = DiscoveryReadRequestSchema.parse({ ...credential, kind, input: raw });
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          "x-agent-os-internal-token": options.internalToken,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      parent.throwIfAborted();
      throw new Error(
        signal.aborted
          ? "Discovery catalogue request timed out"
          : "Discovery catalogue transport failed"
      );
    }
    const json = await readJson(response, signal);
    parent.throwIfAborted();
    if (!response.ok) {
      const message = ErrorEnvelope.safeParse(json);
      // Catalogue messages may explain unavailable/unsupported criteria, but
      // credentials and infrastructure addresses must never enter the model.
      const detail = message.success
        ? message.data.message
        : `Discovery catalogue rejected the request (${response.status})`;
      throw new Error(
        detail
          .replaceAll(options.internalToken, "[redacted]")
          .replaceAll(credential.readToken, "[redacted]")
          .replaceAll(options.baseUrl, "[redacted]")
      );
    }
    // Internal routes return the canonical result directly, never a Java-style
    // code=error envelope disguised by HTTP 200.
    return kind === "ips"
      ? ContentGpsSearchResultSchema.parse(json)
      : CreatorDiscoveryResultSchema.parse(json);
  }
  return {
    searchIps: (input, signal) => read("ips", input, signal),
    searchCreators: (input, signal) => read("creators", input, signal),
  };
}
async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty discovery catalogue response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Discovery catalogue response is too large");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (signal.aborted) throw new Error("Discovery catalogue read cancelled or timed out");
    if (error instanceof Error && error.message === "Discovery catalogue response is too large")
      throw error;
    throw new Error("Invalid discovery catalogue response");
  } finally {
    signal.removeEventListener("abort", stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
