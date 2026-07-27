import { createServer, type Server, type ServerResponse } from "node:http";
import type { WorkerStatus } from "@temporalio/worker";
import type { RuntimeProcessConfig } from "./config.js";

export type RuntimeWorkerRole = "control" | "activities";

export interface WorkerStatusProvider {
  getStatus(): WorkerStatus;
}

export interface RuntimeWorkerHealth {
  alive: boolean;
  ready: boolean;
  workerState: WorkerStatus["runState"] | "UNAVAILABLE";
  pollerState: WorkerStatus["workflowPollerState"] | "UNAVAILABLE";
}

interface HealthSnapshot {
  service: "studio-agent-runtime";
  role: RuntimeWorkerRole;
  release: string;
  status: "alive" | "ready" | "starting" | "draining" | "failed";
  workerState: WorkerStatus["runState"] | "UNAVAILABLE";
  pollerState: WorkerStatus["workflowPollerState"] | "UNAVAILABLE";
}

export class RuntimeHealthServer {
  readonly #role: RuntimeWorkerRole;
  readonly #config: RuntimeProcessConfig;
  readonly #server: Server;
  #worker: WorkerStatusProvider | undefined;
  #draining = false;
  #failed = false;
  #listening = false;

  constructor(role: RuntimeWorkerRole, config: RuntimeProcessConfig) {
    this.#role = role;
    this.#config = config;
    this.#server = createServer((request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        this.#respond(response, request.method === "HEAD", 405, this.#snapshot("alive"));
        return;
      }
      if (request.url === "/healthz") {
        const health = this.#health();
        this.#respond(
          response,
          request.method === "HEAD",
          health.alive ? 200 : 503,
          this.#snapshot(health.alive ? "alive" : "failed", health)
        );
        return;
      }
      if (request.url === "/ready") {
        const health = this.#health();
        this.#respond(
          response,
          request.method === "HEAD",
          health.ready ? 200 : 503,
          this.#snapshot(
            health.ready
              ? "ready"
              : this.#failed
                ? "failed"
                : this.#draining
                  ? "draining"
                  : "starting",
            health
          )
        );
        return;
      }
      this.#respond(response, request.method === "HEAD", 404, this.#snapshot("alive"));
    });
    this.#server.keepAliveTimeout = 5_000;
    this.#server.headersTimeout = 6_000;
    this.#server.requestTimeout = 5_000;
    this.#server.maxConnections = 64;
    this.#server.on("clientError", (_error, socket) => {
      socket.destroy();
    });
  }

  attachWorker(worker: WorkerStatusProvider): void {
    this.#worker = worker;
  }

  beginDraining(): void {
    this.#draining = true;
  }

  markFailed(): void {
    this.#failed = true;
    this.#draining = true;
  }

  async listen(): Promise<void> {
    if (this.#listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.#server.off("error", onError);
        this.#listening = true;
        resolve();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(this.#config.healthPort, this.#config.healthHost);
    });
  }

  async close(): Promise<void> {
    if (!this.#listening) {
      return;
    }
    this.#listening = false;
    this.#server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  #health(): RuntimeWorkerHealth {
    return evaluateRuntimeWorkerHealth(
      this.#role,
      this.#worker?.getStatus(),
      this.#draining,
      this.#failed
    );
  }

  #snapshot(
    status: HealthSnapshot["status"],
    health: RuntimeWorkerHealth = this.#health()
  ): HealthSnapshot {
    return {
      service: "studio-agent-runtime",
      role: this.#role,
      release: this.#config.release,
      status,
      workerState: health.workerState,
      pollerState: health.pollerState,
    };
  }

  #respond(
    response: ServerResponse,
    headOnly: boolean,
    statusCode: number,
    payload: HealthSnapshot
  ): void {
    const body = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(headOnly ? undefined : body);
  }
}

export function evaluateRuntimeWorkerHealth(
  role: RuntimeWorkerRole,
  workerStatus: WorkerStatus | undefined,
  draining: boolean,
  failed: boolean
): RuntimeWorkerHealth {
  const workerState = workerStatus?.runState ?? "UNAVAILABLE";
  const pollerState =
    (role === "control" ? workerStatus?.workflowPollerState : workerStatus?.activityPollerState) ??
    "UNAVAILABLE";
  const alive = !failed && workerState !== "FAILED";
  return {
    alive,
    ready: alive && !draining && workerState === "RUNNING" && pollerState === "POLLING",
    workerState,
    pollerState,
  };
}
