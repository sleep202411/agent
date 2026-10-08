/** Framework-independent interface. The host retains sole ownership of game state. */
export const GAME_ACTIONS = [
  "start",
  "continue",
  "restart",
  "open-map",
  "close-map",
  "return-menu",
] as const;
export type GameAction = (typeof GAME_ACTIONS)[number];
export interface GameSnapshot {
  readonly screen: "menu" | "game";
  readonly started: boolean;
  readonly status: "loading" | "ready" | "starting" | "playing" | "paused" | "completed" | "failed";
  readonly mapOpen: boolean;
  readonly actions: Readonly<Record<GameAction, boolean>>;
}
export type GameActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "unavailable" | "busy" | "disposed" };
export interface GameSession {
  readonly apiVersion: 1;
  /** Stable immutable snapshot, suitable for useSyncExternalStore. */
  readonly getSnapshot: () => GameSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly invoke: (action: GameAction) => Promise<GameActionResult>;
}
export interface GameSessionHost {
  readonly isActive: () => boolean;
  readonly read: () => GameSnapshot;
  /** Must recheck runtime gates; called synchronously to retain browser activation. */
  readonly execute: (action: GameAction) => boolean | Promise<boolean>;
}

function freezeSnapshot(value: GameSnapshot): GameSnapshot {
  return Object.freeze({ ...value, actions: Object.freeze({ ...value.actions }) });
}
function equalSnapshot(a: GameSnapshot, b: GameSnapshot): boolean {
  return (
    a.screen === b.screen &&
    a.started === b.started &&
    a.status === b.status &&
    a.mapOpen === b.mapOpen &&
    GAME_ACTIONS.every((action) => a.actions[action] === b.actions[action])
  );
}

/** Internal host adapter. UI receives only `session`, never these lifecycle methods. */
export function createGameSession(host: GameSessionHost): {
  readonly session: GameSession;
  readonly publish: () => void;
  readonly dispose: () => void;
} {
  let snapshot = freezeSnapshot(host.read());
  let disposed = false;
  let busy = false;
  const listeners = new Set<() => void>();
  const publish = () => {
    if (disposed || !host.isActive()) return;
    const value = host.read();
    if (equalSnapshot(snapshot, value)) return;
    snapshot = freezeSnapshot(value);
    [...listeners].forEach((listener) => listener());
  };
  const session: GameSession = Object.freeze({
    apiVersion: 1,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invoke: async (action: GameAction): Promise<GameActionResult> => {
      if (disposed || !host.isActive()) return { ok: false, reason: "disposed" };
      if (busy) return { ok: false, reason: "busy" };
      if (!GAME_ACTIONS.includes(action) || !host.read().actions[action])
        return { ok: false, reason: "unavailable" };
      busy = true;
      try {
        const result = await host.execute(action);
        // A successful restart intentionally replaces and revokes this host.
        if (action === "restart" && result) return { ok: true };
        if (disposed || !host.isActive()) return { ok: false, reason: "disposed" };
        publish();
        return result ? { ok: true } : { ok: false, reason: "unavailable" };
      } finally {
        busy = false;
      }
    },
  });
  return {
    session,
    publish,
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}
