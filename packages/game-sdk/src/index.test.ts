import { describe, expect, it, vi } from "vitest";
import { createGameSession, type GameSnapshot } from "./index";

const ready = (): GameSnapshot => ({
  screen: "menu",
  started: false,
  status: "ready",
  mapOpen: false,
  actions: {
    start: true,
    continue: false,
    restart: false,
    "open-map": true,
    "close-map": false,
    "return-menu": false,
  },
});
describe("game session", () => {
  it("invokes the host inside the activation, prevents duplicate commands, and reads fresh gates", async () => {
    let value = ready();
    let complete!: (result: boolean) => void;
    const execute = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        })
    );
    const adapter = createGameSession({ isActive: () => true, read: () => value, execute });
    const first = adapter.session.invoke("start");
    expect(execute).toHaveBeenCalledOnce(); // Before the first await.
    expect(await adapter.session.invoke("start")).toEqual({ ok: false, reason: "busy" });
    complete(true);
    expect(await first).toEqual({ ok: true });
    value = { ...value, actions: { ...value.actions, start: false } };
    expect(await adapter.session.invoke("start")).toEqual({ ok: false, reason: "unavailable" });
    expect(await adapter.session.invoke("invented" as "start")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("publishes immutable stable snapshots only when the view changes", () => {
    let value = ready();
    const adapter = createGameSession({
      isActive: () => true,
      read: () => value,
      execute: () => true,
    });
    const listener = vi.fn();
    const unsubscribe = adapter.session.subscribe(listener);
    const first = adapter.session.getSnapshot();
    adapter.publish();
    expect(adapter.session.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.actions)).toBe(true);
    value = { ...value, mapOpen: true };
    adapter.publish();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    value = ready();
    adapter.publish();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("revokes old sessions and discards completion after disposal", async () => {
    let active = true;
    let complete!: (result: boolean) => void;
    const execute = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        })
    );
    const adapter = createGameSession({ isActive: () => active, read: ready, execute });
    const pending = adapter.session.invoke("start");
    active = false;
    adapter.dispose();
    complete(true);
    expect(await pending).toEqual({ ok: false, reason: "disposed" });
    expect(await adapter.session.invoke("open-map")).toEqual({ ok: false, reason: "disposed" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("releases command ownership after an error or rejected runtime gate", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("Actual failure"))
      .mockReturnValue(false);
    const adapter = createGameSession({ isActive: () => true, read: ready, execute });
    await expect(adapter.session.invoke("start")).rejects.toThrow("Actual failure");
    expect(await adapter.session.invoke("start")).toEqual({ ok: false, reason: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
