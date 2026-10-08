import { GAME_ACTIONS, type GameAction, type GameSession } from "@repo/game-sdk";

/** An authenticated MessagePort is the complete capability; no window-wide RPC. */
export function attachGameSessionPort(
  session: GameSession,
  port: MessagePort,
  context: unknown,
  onReady: () => void,
  onError: (message: string) => void
): () => void {
  let closed = false;
  let lastId = 0;
  let count = 0;
  let windowStart = Date.now();
  const send = (value: unknown) => {
    if (!closed) port.postMessage(value);
  };
  const unsubscribe = session.subscribe(() =>
    send({ type: "snapshot", snapshot: session.getSnapshot() })
  );
  port.onmessage = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (closed || !value || typeof value !== "object") return;
    if (Date.now() - windowStart > 1000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > 60) {
      dispose();
      onError("Game UI exceeded its command limit.");
      return;
    }
    const request = value as Record<string, unknown>;
    if (request.type === "ready") {
      onReady();
      return;
    }
    if (request.type === "error" && typeof request.message === "string") {
      dispose();
      onError(request.message.slice(0, 2000));
      return;
    }
    if (
      !Number.isSafeInteger(request.id) ||
      (request.id as number) <= lastId ||
      Object.keys(request).length !== 3
    )
      return;
    if (
      request.type !== "invoke" ||
      typeof request.action !== "string" ||
      !GAME_ACTIONS.includes(request.action as GameAction)
    )
      return;
    lastId = request.id as number;
    const id = lastId;
    // invoke itself rechecks current engine gates and serializes commands.
    void session.invoke(request.action as GameAction).then(
      (result) => send({ type: "result", id, result }),
      (error: unknown) =>
        send({ type: "result", id, error: error instanceof Error ? error.message : String(error) })
    );
  };
  port.start();
  send({
    type: "initialize",
    snapshot: session.getSnapshot(),
    context,
  });
  function dispose() {
    closed = true;
    unsubscribe();
    port.onmessage = null;
    port.close();
  }
  return dispose;
}
