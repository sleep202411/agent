import type { BoundWorldTravel, WorldStreamStatus } from "@repo/shared/world-model-protocol";
import type { WorldTravelApi } from "./world-travel-api";
import type {
  WorldTravelCommand,
  WorldTravelRuntime,
  WorldTravelRuntimeFactory,
} from "./world-travel-runtime";

export type WorldTravelControllerPhase =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "ending"
  | "ended"
  | "failed";

export interface WorldTravelControllerSnapshot {
  phase: WorldTravelControllerPhase;
  streamStatus: WorldStreamStatus;
  travelId: string | null;
  firstFrameUrl: string | null;
  error: unknown | null;
}

export interface WorldTravelControllerOptions {
  api: WorldTravelApi;
  maxExperienceSeconds?: 60 | 90 | 120;
  runtimeFactory: WorldTravelRuntimeFactory;
  onChange?: (snapshot: WorldTravelControllerSnapshot) => void;
}

type Timer = ReturnType<typeof setTimeout>;

const INITIAL_SNAPSHOT: WorldTravelControllerSnapshot = {
  phase: "idle",
  streamStatus: "DISCONNECTED",
  travelId: null,
  firstFrameUrl: null,
  error: null,
};

/**
 * Coordinates the product session and the provider realtime runtime.
 *
 * Components never bind provider IDs, refresh tokens, or manage heartbeats.
 * This class owns those invariants and presents one idempotent lifecycle.
 */
export class WorldTravelController {
  private snapshot: WorldTravelControllerSnapshot = INITIAL_SNAPSHOT;
  private runtime: WorldTravelRuntime | null = null;
  private sessionId: string | null = null;
  private boundTravel: BoundWorldTravel | null = null;
  private heartbeatTimer: Timer | null = null;
  private tokenTimer: Timer | null = null;
  private startPromise: Promise<void> | null = null;
  private endPromise: Promise<void> | null = null;
  private disposed = false;
  private endRequested = false;
  private providerCompleted = false;
  private latestUnreportedStreamStatus: WorldStreamStatus | null = null;
  private streamStatusReportPromise: Promise<void> | null = null;
  private streamStatusReportBlocked = false;

  constructor(private readonly options: WorldTravelControllerOptions) {}

  get state() {
    return this.snapshot;
  }

  can(action: Parameters<WorldTravelRuntime["can"]>[0]) {
    if (action === "start") {
      return !this.disposed && this.snapshot.phase === "idle";
    }
    if (!this.runtime) return false;

    const phaseAllowsAction =
      action === "resume" || action === "rewind"
        ? this.snapshot.phase === "paused"
        : action === "end"
          ? this.snapshot.phase === "running" || this.snapshot.phase === "paused"
          : this.snapshot.phase === "running";
    return phaseAllowsAction && this.runtime.can(action);
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.snapshot.phase !== "idle") {
      return Promise.reject(new Error("This world travel has already been started."));
    }
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  move(command: WorldTravelCommand) {
    this.requirePhase("running", "move");
    return this.requireRuntime().move(command);
  }

  instruct(content: string) {
    this.requirePhase("running", "instruct");
    const value = content.trim();
    if (!value) return Promise.reject(new Error("Instruction content is required."));
    return this.requireRuntime().instruct(value);
  }

  async pause() {
    this.requirePhase("running", "pause");
    const runtime = this.requireRuntime();
    await runtime.pause();
    if (
      this.acceptsRuntimeUpdates() &&
      this.runtime === runtime &&
      this.snapshot.phase === "running"
    )
      this.update({ phase: "paused" });
  }

  async resume() {
    this.requirePhase("paused", "resume");
    const runtime = this.requireRuntime();
    await runtime.resume();
    if (
      this.acceptsRuntimeUpdates() &&
      this.runtime === runtime &&
      this.snapshot.phase === "paused"
    )
      this.update({ phase: "running" });
  }

  rewind(seconds: number) {
    this.requirePhase("paused", "rewind");
    return this.requireRuntime().rewind(seconds);
  }

  end(): Promise<void> {
    if (this.endPromise) return this.endPromise;
    this.endRequested = true;
    const operation = this.endInternal();
    this.endPromise = operation;
    void operation.catch(() => {
      if (this.endPromise === operation) this.endPromise = null;
    });
    return operation;
  }

  async dispose() {
    this.disposed = true;
    await this.end();
  }

  private async startInternal() {
    this.update({ phase: "starting", error: null });
    try {
      const session = await this.options.api.createWorldSession({
        tokenSeconds: 60,
        maxExperienceSeconds: this.options.maxExperienceSeconds,
      });
      this.sessionId = session.id;
      if (this.endRequested) return;
      const factory = this.options.runtimeFactory;
      this.runtime = await factory({
        providerKey: session.providerKey,
        connection: session.connection,
        maxExperienceSeconds: session.maxExperienceSeconds,
        events: {
          onStatusChange: (streamStatus) => this.handleStreamStatus(streamStatus),
          onFirstFrame: (firstFrameUrl) => {
            if (this.acceptsRuntimeUpdates()) this.update({ firstFrameUrl });
          },
          onCompleted: () => this.handleProviderCompleted(),
          onError: (error) => this.handleRuntimeError(error),
        },
      });
      if (this.endRequested) return;
      const started = await this.runtime.start();
      if (this.endRequested) return;
      this.boundTravel = await this.options.api.bindWorldTravel(session.id, {
        providerTravelId: started.providerTravelId,
      });
      if (this.endRequested) return;
      this.update({
        phase: "running",
        travelId: this.boundTravel.id,
        firstFrameUrl: started.firstFrameUrl,
      });
      this.scheduleHeartbeat(session.heartbeatIntervalSeconds);
      this.scheduleTokenRefresh(session.connection.tokenExpiresIn);
      await this.reportLatestStreamStatus();
    } catch (error) {
      this.fail(error);
      await this.release(false);
      throw error;
    }
  }

  private async endInternal() {
    if (this.snapshot.phase === "ended") return;
    if (this.snapshot.phase !== "failed") this.update({ phase: "ending" });
    try {
      // Startup may still acquire resources; release after that work settles.
      await this.startPromise?.catch(() => undefined);
      await this.release(this.providerCompleted);
      this.update({
        ...(this.snapshot.phase === "failed" ? {} : { phase: "ended" as const }),
        streamStatus: "DISCONNECTED",
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private async release(travelCompleted: boolean) {
    this.clearTimers();
    const runtime = this.runtime;
    const sessionId = this.sessionId;
    const [runtimeResult, sessionResult] = await Promise.allSettled([
      runtime?.dispose() ?? Promise.resolve(),
      sessionId
        ? this.options.api.closeWorldSession(sessionId, { travelCompleted })
        : Promise.resolve(),
    ]);
    if (runtimeResult.status === "fulfilled" && this.runtime === runtime) this.runtime = null;
    if (sessionResult.status === "fulfilled" && this.sessionId === sessionId) {
      this.sessionId = null;
      this.boundTravel = null;
    }
    const failures = [runtimeResult, sessionResult].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failures.length === 1) throw failures[0].reason;
    if (failures.length > 1) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Failed to close the world travel cleanly."
      );
    }
  }

  private scheduleHeartbeat(seconds: number) {
    if (!this.sessionId || !this.acceptsRuntimeUpdates()) return;
    this.heartbeatTimer = setTimeout(
      async () => {
        const sessionId = this.sessionId;
        if (!sessionId || !this.acceptsRuntimeUpdates()) return;
        try {
          const response = await this.options.api.heartbeatWorldSession(sessionId);
          if (!this.acceptsRuntimeUpdates() || this.sessionId !== sessionId) return;
          if (!response.alive) throw new Error("The world session expired.");
          this.scheduleHeartbeat(response.heartbeatIntervalSeconds);
        } catch (error) {
          if (!this.acceptsRuntimeUpdates() || this.sessionId !== sessionId) return;
          this.fail(error);
          this.endInBackground();
        }
      },
      Math.max(1, seconds) * 1_000
    );
  }

  private scheduleTokenRefresh(expiresInSeconds: number) {
    if (!this.sessionId || !this.acceptsRuntimeUpdates()) return;
    const refreshAfterSeconds = Math.max(5, expiresInSeconds - Math.min(15, expiresInSeconds / 2));
    this.tokenTimer = setTimeout(async () => {
      const sessionId = this.sessionId;
      if (!sessionId || !this.acceptsRuntimeUpdates()) return;
      try {
        const response = await this.options.api.refreshWorldSessionToken(sessionId, {
          tokenSeconds: 60,
        });
        if (!this.acceptsRuntimeUpdates() || this.sessionId !== sessionId) return;
        this.runtime?.updateToken(response.token);
        this.scheduleTokenRefresh(response.tokenExpiresIn);
      } catch (error) {
        if (!this.acceptsRuntimeUpdates() || this.sessionId !== sessionId) return;
        this.fail(error);
        this.endInBackground();
      }
    }, refreshAfterSeconds * 1_000);
  }

  private handleStreamStatus(streamStatus: WorldStreamStatus) {
    if (!this.acceptsRuntimeUpdates()) return;
    this.streamStatusReportBlocked = false;
    this.latestUnreportedStreamStatus = streamStatus;
    this.update({ streamStatus });
    void this.reportLatestStreamStatus();
  }

  private handleProviderCompleted() {
    if (!this.acceptsRuntimeUpdates()) return;
    this.providerCompleted = true;
    this.endInBackground();
  }

  private handleRuntimeError(error: unknown) {
    if (!this.acceptsRuntimeUpdates()) return;
    this.fail(error);
    this.endInBackground();
  }

  private endInBackground() {
    void this.end().catch((error) => this.fail(error));
  }

  private reportLatestStreamStatus() {
    if (!this.acceptsRuntimeUpdates()) return Promise.resolve();
    if (this.streamStatusReportPromise || this.streamStatusReportBlocked) {
      return this.streamStatusReportPromise ?? Promise.resolve();
    }
    this.streamStatusReportPromise = this.flushStreamStatusReports().finally(() => {
      this.streamStatusReportPromise = null;
      if (
        !this.streamStatusReportBlocked &&
        this.latestUnreportedStreamStatus &&
        this.boundTravel
      ) {
        void this.reportLatestStreamStatus();
      }
    });
    return this.streamStatusReportPromise;
  }

  private async flushStreamStatusReports() {
    while (this.acceptsRuntimeUpdates() && this.latestUnreportedStreamStatus && this.boundTravel) {
      const status = this.latestUnreportedStreamStatus;
      const travelId = this.boundTravel.id;
      this.latestUnreportedStreamStatus = null;
      try {
        await this.options.api.reportWorldTravelStatus(travelId, {
          streamStatus: status,
          streamStatusChangedAtMs: Date.now(),
        });
      } catch (error) {
        if (!this.acceptsRuntimeUpdates() || this.boundTravel?.id !== travelId) return;
        if (!this.latestUnreportedStreamStatus) this.latestUnreportedStreamStatus = status;
        this.streamStatusReportBlocked = true;
        if (!this.disposed) this.update({ error });
        return;
      }
    }
  }

  private acceptsRuntimeUpdates() {
    return !this.disposed && ["starting", "running", "paused"].includes(this.snapshot.phase);
  }

  private requireRuntime() {
    if (!this.runtime) throw new Error("The world travel is not running.");
    return this.runtime;
  }

  private requirePhase(expected: WorldTravelControllerPhase, action: string) {
    if (this.snapshot.phase !== expected) {
      throw new Error(`World travel must be ${expected} before it can ${action}.`);
    }
  }

  private clearTimers() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.heartbeatTimer = null;
    this.tokenTimer = null;
  }

  private fail(error: unknown) {
    this.update({ phase: "failed", error });
  }

  private update(patch: Partial<WorldTravelControllerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.options.onChange?.(this.snapshot);
  }
}
