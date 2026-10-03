import { createHappyOysterRuntime } from "./happy-oyster-runtime";
import { worldCommandSchema, type WorldMessage, type WorldCommand } from "./protocol";
import type { WorldTravelRuntime } from "../src/features/experience-player/world/world-travel-runtime";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
    __fizzWorldReceive?: (raw: string) => void;
  }
}
const sessionId: string = JSON.parse(
  document.querySelector("[data-initial]")!.textContent!
).sessionId;
const video = document.querySelector("video")!;
let runtime: WorldTravelRuntime | undefined;
let initialized = false;
let retired = false;
let queue = Promise.resolve();
const seen = new Set<string>();
type Payload<T = WorldMessage> = T extends WorldMessage ? Omit<T, "sessionId"> : never;
const send = (message: Payload) => {
  const raw = JSON.stringify({ ...message, sessionId });
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(raw);
  else window.parent.postMessage(raw, "*");
};
const errorValue = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  name: error instanceof Error ? error.name : "Error",
});
async function execute(command: WorldCommand): Promise<unknown> {
  if (command.type === "initialize") {
    if (initialized) throw new Error("World runtime is already initialized.");
    initialized = true;
    runtime = await createHappyOysterRuntime(
      {
        ...command,
        events: {
          onStatusChange: (status) => send({ type: "status", status }),
          onFirstFrame: (url) => send({ type: "frame", url }),
          onCompleted: () => send({ type: "completed" }),
          onError: (error) => send({ type: "error", ...errorValue(error) }),
        },
      },
      video
    );
    // The document may have gone away while the SDK was being acquired.
    if (retired) {
      await runtime.dispose();
      throw new Error("World runtime is closed.");
    }
    return;
  }
  if (!runtime) throw new Error("World runtime is not initialized.");
  switch (command.type) {
    case "start":
      return runtime.start();
    case "move":
      return runtime.move(command.command);
    case "instruct":
      return runtime.instruct(command.content);
    case "pause":
      return runtime.pause();
    case "resume":
      return runtime.resume();
    case "rewind":
      return runtime.rewind(command.seconds);
    case "token":
      return runtime.updateToken(command.token);
    case "end":
      return runtime.end();
    case "dispose":
      await runtime.dispose();
      retired = true;
      return;
  }
}
const receive = (raw: string) => {
  if (typeof raw !== "string" || raw.length > 100000) return;
  let parsed: ReturnType<typeof worldCommandSchema.safeParse>;
  try {
    parsed = worldCommandSchema.safeParse(JSON.parse(raw));
  } catch {
    return;
  }
  if (!parsed.success || parsed.data.sessionId !== sessionId || retired) return;
  const command = parsed.data;
  // A transport replay must never start or move a paid session twice.
  if (seen.has(command.requestId)) return;
  seen.add(command.requestId);
  queue = queue.then(async () => {
    try {
      if (retired) throw new Error("World runtime is closed.");
      const value = await execute(command);
      send({ type: "result", requestId: command.requestId, value });
    } catch (error) {
      send({ type: "failure", requestId: command.requestId, ...errorValue(error) });
    }
  });
};
window.__fizzWorldReceive = receive;
const receiveParent = (event: MessageEvent) => {
  if (window.parent !== window && event.source === window.parent) receive(event.data);
};
window.addEventListener("message", receiveParent);
window.addEventListener("pagehide", () => {
  retired = true;
  window.removeEventListener("message", receiveParent);
  void runtime?.dispose().catch(() => undefined);
});
send({ type: "ready" });
