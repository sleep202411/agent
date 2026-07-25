import { StudioAgentEventSchema, type StudioAgentEvent } from "@repo/shared";

export type StudioAgentStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface StudioAgentSseMetadata {
  id: string | null;
  event: string | null;
}

export interface StudioAgentSseClientOptions {
  url: string | ((cursor: string | null) => string);
  parseEvent?: (data: unknown, metadata: StudioAgentSseMetadata) => StudioAgentEvent | null;
  onEvents: (events: readonly StudioAgentEvent[]) => void;
  onStatusChange?: (status: StudioAgentStreamStatus) => void;
  onError?: (error: Error) => void;
  headers?: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
  initialCursor?: string | null;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

interface ParsedSseFrame {
  id: string | null;
  event: string | null;
  data: string;
  retry: number | null;
}

export class StudioAgentSseHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number) {
    super(`Studio Agent event stream failed with HTTP ${status}.`);
    this.name = "StudioAgentSseHttpError";
    this.status = status;
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export class StudioAgentSseProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioAgentSseProtocolError";
  }
}

/**
 * Fetch-based SSE client with explicit acknowledgement.
 *
 * The client never advances Last-Event-ID merely because bytes arrived. The
 * consumer acknowledges only the reducer's highest contiguous cursor, so an
 * out-of-order event cannot create a replay gap after reconnect.
 */
export class StudioAgentSseClient {
  readonly #options: Required<
    Pick<StudioAgentSseClientOptions, "minReconnectDelayMs" | "maxReconnectDelayMs" | "fetchImpl">
  > &
    Omit<StudioAgentSseClientOptions, "minReconnectDelayMs" | "maxReconnectDelayMs" | "fetchImpl">;
  #abortController: AbortController | null = null;
  #cursor: string | null;
  #desiredOpen = false;
  #attempt = 0;
  #loop: Promise<void> | null = null;

  constructor(options: StudioAgentSseClientOptions) {
    this.#options = {
      ...options,
      // Native fetch throws "Illegal invocation" when called with any receiver
      // other than the global object. Stored on #options and invoked as
      // `this.#options.fetchImpl(...)`, an unwrapped `fetch` binds `this` to
      // #options and throws before a request is ever issued — so wrap it.
      fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
      minReconnectDelayMs: options.minReconnectDelayMs ?? 500,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? 12_000,
    };
    this.#cursor = options.initialCursor ?? null;
  }

  start(): void {
    if (this.#desiredOpen) return;
    this.#desiredOpen = true;
    this.#loop = this.#run();
  }

  acknowledge(cursor: string | null): void {
    this.#cursor = cursor;
  }

  stop(): void {
    this.#desiredOpen = false;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#options.onStatusChange?.("closed");
  }

  async settled(): Promise<void> {
    await this.#loop;
  }

  async #run(): Promise<void> {
    while (this.#desiredOpen) {
      this.#options.onStatusChange?.(this.#attempt === 0 ? "connecting" : "reconnecting");
      this.#abortController = new AbortController();

      try {
        await this.#connectOnce(this.#abortController.signal);
        this.#attempt = 0;
      } catch (error) {
        if (!this.#desiredOpen || isAbortError(error)) break;
        const nextError = toError(error);
        this.#options.onError?.(nextError);
        if (isTerminalStreamError(nextError)) {
          this.#desiredOpen = false;
          this.#abortController = null;
          this.#options.onStatusChange?.("closed");
          break;
        }
        this.#attempt += 1;
      }

      if (!this.#desiredOpen) break;
      await wait(this.#reconnectDelay(), this.#abortController.signal).catch(() => undefined);
    }
  }

  async #connectOnce(signal: AbortSignal): Promise<void> {
    const headers = new Headers(this.#options.headers);
    headers.set("Accept", "text/event-stream");
    headers.set("Cache-Control", "no-cache");
    if (this.#cursor) headers.set("Last-Event-ID", this.#cursor);

    const url =
      typeof this.#options.url === "function" ? this.#options.url(this.#cursor) : this.#options.url;
    const response = await this.#options.fetchImpl(url, {
      method: "GET",
      headers,
      signal,
      credentials: "include",
    });

    if (!response.ok) {
      throw new StudioAgentSseHttpError(response.status);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType?.toLowerCase().includes("text/event-stream")) {
      throw new StudioAgentSseProtocolError(
        "Studio Agent event stream returned an unexpected content type."
      );
    }
    if (!response.body) {
      throw new StudioAgentSseProtocolError("Studio Agent event stream returned no response body.");
    }

    // A valid SSE response proves connectivity. Reset the backoff here rather
    // than after the stream returns: a long-lived SSE connection normally
    // ends by throwing when the server disconnects, so resetting after
    // `#connectOnce` would be unreachable and every later reconnect would
    // become progressively slower.
    this.#attempt = 0;
    this.#options.onStatusChange?.("connected");
    for await (const frame of parseSseStream(response.body, signal)) {
      if (!this.#desiredOpen) break;
      const parsed = parseJson(frame.data);
      if (parsed === undefined) {
        throw new StudioAgentSseProtocolError("Studio Agent event stream emitted invalid JSON.");
      }
      const metadata = { id: frame.id, event: frame.event };
      let event: StudioAgentEvent | null;
      try {
        event = this.#options.parseEvent
          ? this.#options.parseEvent(parsed, metadata)
          : parseStudioAgentWireEvent(parsed, metadata);
      } catch (error) {
        throw new StudioAgentSseProtocolError(
          `Studio Agent event stream emitted an invalid event: ${toError(error).message}`,
          { cause: error }
        );
      }
      if (event) this.#options.onEvents([event]);
    }

    if (this.#desiredOpen) {
      throw new Error("Studio Agent event stream closed before the client stopped.");
    }
  }

  #reconnectDelay(): number {
    const exponential = Math.min(
      this.#options.maxReconnectDelayMs,
      this.#options.minReconnectDelayMs * 2 ** Math.max(0, this.#attempt - 1)
    );
    return Math.round(exponential * (0.8 + Math.random() * 0.4));
  }
}

export function parseStudioAgentWireEvent(
  data: unknown,
  metadata: StudioAgentSseMetadata
): StudioAgentEvent {
  const parsed = StudioAgentEventSchema.parse(data);
  if (metadata.id && metadata.id !== String(parsed.sequence)) {
    throw new Error("Studio Agent SSE id does not match the event sequence.");
  }
  return parsed;
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ParsedSseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let trailingCarriageReturn = false;

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      const decoded = decoder.decode(value, { stream: !done });
      const withBoundary: string = trailingCarriageReturn ? `\r${decoded}` : decoded;
      trailingCarriageReturn = withBoundary.endsWith("\r") && !done;
      const normalizedSource = trailingCarriageReturn ? withBoundary.slice(0, -1) : withBoundary;
      buffer += normalizedSource.replace(/\r\n|\r/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseFrame(rawFrame);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }

      if (done) break;
    }
    if (trailingCarriageReturn) buffer += "\n";
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(raw: string): ParsedSseFrame | null {
  let id: string | null = null;
  let event: string | null = null;
  let retry: number | null = null;
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\0")) id = value;
    else if (field === "event") event = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  }

  if (data.length === 0) return null;
  return { id, event, data: data.join("\n"), retry };
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function isTerminalStreamError(error: Error): boolean {
  return (
    error instanceof StudioAgentSseProtocolError ||
    (error instanceof StudioAgentSseHttpError && !error.retryable)
  );
}

function wait(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
