import { createServer, type Server, type ServerResponse } from "node:http";

import type { Worker, WorkerStatus } from "@temporalio/worker";

export type WorkerHealthSnapshot = Readonly<{
  live: boolean;
  ready: boolean;
  runState: WorkerStatus["runState"];
  workflowPollerState: WorkerStatus["workflowPollerState"];
  activityPollerState: WorkerStatus["activityPollerState"];
}>;

type WorkerStatusReader = Pick<Worker, "getStatus">;
type WorkerStatusReaders = Readonly<Record<string, WorkerStatusReader>>;

export type WorkerGroupHealthSnapshot = Readonly<{
  live: boolean;
  ready: boolean;
  workers: Readonly<Record<string, WorkerHealthSnapshot>>;
}>;

export function workerHealthSnapshot(status: WorkerStatus): WorkerHealthSnapshot {
  const live = status.runState !== "FAILED" && status.runState !== "STOPPED";
  const ready =
    status.runState === "RUNNING" &&
    status.workflowPollerState !== "FAILED" &&
    status.activityPollerState !== "FAILED";

  return Object.freeze({
    live,
    ready,
    runState: status.runState,
    workflowPollerState: status.workflowPollerState,
    activityPollerState: status.activityPollerState,
  });
}

export function workerGroupHealthSnapshot(workers: WorkerStatusReaders): WorkerGroupHealthSnapshot {
  const snapshots = Object.fromEntries(
    Object.entries(workers).map(([name, worker]) => [
      name,
      workerHealthSnapshot(worker.getStatus()),
    ])
  );
  const values = Object.values(snapshots);
  return Object.freeze({
    live: values.length > 0 && values.every((snapshot) => snapshot.live),
    ready: values.length > 0 && values.every((snapshot) => snapshot.ready),
    workers: Object.freeze(snapshots),
  });
}

export class WorkerHealthServer {
  readonly #host: string;
  readonly #port: number;
  readonly #workers: WorkerStatusReaders;
  #server: Server | undefined;

  constructor(
    input:
      | { host: string; port: number; worker: WorkerStatusReader }
      | { host: string; port: number; workers: WorkerStatusReaders }
  ) {
    this.#host = input.host;
    this.#port = input.port;
    this.#workers = "workers" in input ? input.workers : Object.freeze({ worker: input.worker });
  }

  async start(): Promise<void> {
    if (this.#server) {
      throw new Error("Worker health server is already running");
    }

    const server = createServer((request, response) => {
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("x-content-type-options", "nosniff");

      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }

      const pathname = new URL(request.url ?? "/", "http://worker.internal").pathname;
      if (pathname !== "/health/live" && pathname !== "/health/ready") {
        writeJson(response, 404, { error: "not_found" });
        return;
      }

      const snapshot = workerGroupHealthSnapshot(this.#workers);
      const isLiveProbe = pathname === "/health/live";
      const healthy = isLiveProbe ? snapshot.live : snapshot.ready;
      writeJson(response, healthy ? 200 : 503, {
        status: healthy ? "ok" : "unavailable",
        ...snapshot,
      });
    });

    this.#server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.#port, this.#host);
      });
    } catch (error) {
      this.#server = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: Readonly<Record<string, unknown>>
): void {
  response.statusCode = statusCode;
  response.end(`${JSON.stringify(value)}\n`);
}
