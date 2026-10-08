import { expect, it, vi } from "vitest";
import { attachGameSessionPort } from "./port.js";
import { createGameSession, GAME_ACTIONS, type GameSnapshot } from "./index.js";

function setup(execute = vi.fn(() => true)) {
  const snapshot: GameSnapshot = {
    screen: "menu",
    status: "ready",
    started: false,
    mapOpen: false,
    actions: Object.fromEntries(
      GAME_ACTIONS.map((action) => [action, true])
    ) as GameSnapshot["actions"],
  };
  const adapter = createGameSession({ read: () => snapshot, isActive: () => true, execute });
  const port = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  };
  const ready = vi.fn(),
    error = vi.fn();
  const dispose = attachGameSessionPort(
    adapter.session,
    port as unknown as MessagePort,
    { title: "Home" },
    ready,
    error
  );
  return {
    execute,
    port,
    dispose,
    ready,
    error,
    send: (data: unknown) => port.onmessage?.({ data } as MessageEvent),
  };
}
it("sends a bounded snapshot and accepts only fresh known action requests", async () => {
  const f = setup();
  expect(f.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "initialize" }));
  for (const data of [
    { type: "invoke", id: 1, action: "eval" },
    { type: "transact", id: 1, transaction: { operations: [] } },
    { type: "invoke", id: 1, action: "start", code: "x" },
    { type: "invoke", id: -1, action: "start" },
  ])
    f.send(data);
  expect(f.execute).not.toHaveBeenCalled();
  f.send({ type: "invoke", id: 1, action: "start" });
  f.send({ type: "invoke", id: 1, action: "start" });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.port.postMessage).toHaveBeenCalledWith({ type: "result", id: 1, result: { ok: true } });
  f.dispose();
});
it("revokes old ports including late command results and caps abusive message streams", async () => {
  let finish!: () => void;
  const execute = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  const f = setup(execute as never);
  f.send({ type: "invoke", id: 1, action: "start" });
  f.dispose();
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.port.postMessage).toHaveBeenCalledTimes(1);
  expect(f.port.close).toHaveBeenCalled();
  const flood = setup();
  for (let n = 0; n < 61; n++) flood.send({ type: "ready" });
  expect(flood.port.close).toHaveBeenCalled();
  expect(flood.error).toHaveBeenCalledWith(expect.stringContaining("limit"));
});
