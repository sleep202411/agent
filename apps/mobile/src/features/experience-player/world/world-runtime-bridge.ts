import { z } from "zod";
import {
  worldCommandSchema,
  worldMessageSchema,
  type WorldCommand,
} from "../../../../world-player/protocol";
import type {
  CreateWorldTravelRuntimeInput,
  WorldTravelAction,
  WorldTravelCommand,
  WorldTravelRuntime,
  WorldTravelStartResult,
} from "./world-travel-runtime";

type Payload<T = WorldCommand> = T extends WorldCommand
  ? Omit<T, "sessionId" | "requestId">
  : never;
const startResult = z
  .object({
    providerTravelId: z.string().min(1),
    firstFrameUrl: z.string().url().nullable(),
    maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable(),
  })
  .strict();

/** RPC endpoint owned by one mounted, bundled playback document. */
export class WorldRuntimeBridge implements WorldTravelRuntime {
  private counter = 0;
  private closed = false;
  private status = "DISCONNECTED";
  private input?: CreateWorldTravelRuntimeInput;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private ready: Promise<void>;
  private readyTimer: ReturnType<typeof setTimeout>;
  private disposal?: Promise<void>;

  constructor(
    private readonly sessionId: string,
    private readonly send: (message: WorldCommand) => void
  ) {
    z.string().uuid().parse(sessionId);
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // The document can fail before a controller attaches; keep the rejection
    // handled while initialize still receives it when it arrives.
    void this.ready.catch(() => undefined);
    this.readyTimer = setTimeout(
      () => this.detach(new Error("World playback surface did not load.")),
      15000
    );
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  async initialize(input: CreateWorldTravelRuntimeInput): Promise<WorldTravelRuntime> {
    if (this.input) throw new Error("World playback surface is already assigned.");
    this.input = input;
    await this.ready;
    await this.request({
      type: "initialize",
      providerKey: input.providerKey,
      connection: input.connection,
      maxExperienceSeconds: input.maxExperienceSeconds,
    });
    return this;
  }

  receive(raw: unknown) {
    if (this.closed || typeof raw !== "string" || raw.length > 100000) return;
    let parsed: ReturnType<typeof worldMessageSchema.safeParse>;
    try {
      parsed = worldMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      return;
    }
    if (!parsed.success || parsed.data.sessionId !== this.sessionId) return;
    const message = parsed.data;
    if (message.type === "ready") {
      clearTimeout(this.readyTimer);
      this.readyResolve();
      return;
    }
    if (message.type === "result" || message.type === "failure") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.type === "result") pending.resolve(message.value);
      else {
        const error = new Error(message.message);
        error.name = message.name ?? "Error";
        pending.reject(error);
      }
      return;
    }
    if (message.type === "status") {
      this.status = message.status;
      this.input?.events?.onStatusChange?.(message.status);
    }
    if (message.type === "frame") this.input?.events?.onFirstFrame?.(message.url);
    if (message.type === "completed") this.input?.events?.onCompleted?.();
    if (message.type === "error") {
      const error = new Error(message.message);
      error.name = message.name ?? "Error";
      this.input?.events?.onError?.(error);
    }
  }

  private request(payload: Payload): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("World playback surface is closed."));
    if (this.pending.size >= 128) return Promise.reject(new Error("World playback is busy."));
    const requestId = String(++this.counter);
    const message = worldCommandSchema.parse({ ...payload, sessionId: this.sessionId, requestId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          reject(new Error(`World playback ${payload.type} timed out. Its result is unknown.`));
        },
        payload.type === "start" ? 120000 : 15000
      );
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async setPresentation(active: boolean) {
    await this.request({ type: "presentation", active });
  }

  can(action: WorldTravelAction) {
    if (this.closed) return false;
    if (action === "start") return this.status === "DISCONNECTED";
    if (action === "resume" || action === "rewind") return this.status === "PAUSED";
    if (action === "end") return true;
    return this.status === "PLAYING";
  }
  async start(): Promise<WorldTravelStartResult> {
    return startResult.parse(await this.request({ type: "start" }));
  }
  async move(command: WorldTravelCommand) {
    await this.request({ type: "move", command });
  }
  async instruct(content: string) {
    await this.request({ type: "instruct", content });
  }
  async pause() {
    await this.request({ type: "pause" });
  }
  async resume() {
    await this.request({ type: "resume" });
  }
  async rewind(seconds: number) {
    return z
      .object({ resumedAtSeconds: z.number().nonnegative() })
      .strict()
      .parse(await this.request({ type: "rewind", seconds }));
  }
  updateToken(token: string) {
    void this.request({ type: "token", token }).catch((error) =>
      this.input?.events?.onError?.(error)
    );
  }
  async end() {
    await this.request({ type: "end" });
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.disposal = this.request({ type: "dispose" })
      .then(() => this.detach())
      .catch((error) => {
        this.disposal = undefined;
        throw error;
      });
    return this.disposal;
  }
  detach(error = new Error("World playback surface was removed.")) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer);
    this.readyReject(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.input = undefined;
  }
}
