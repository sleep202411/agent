/**
 * The two worker roles of the single runtime image. Declared on its own so
 * configuration, health, logging, and the local dev launcher can all agree on
 * it without importing each other.
 */
export type RuntimeWorkerRole = "control" | "activities";

export const RUNTIME_WORKER_ROLES = ["control", "activities"] as const satisfies readonly [
  RuntimeWorkerRole,
  RuntimeWorkerRole,
];
