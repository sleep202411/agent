import {
  APP_STORY_BRIDGE_PROTOCOL,
  StoryBridgeInboundSchema,
  StoryBridgeOutboundSchema,
  type StoryBridgeInit,
  type StoryBridgeOutbound,
  type StoryBridgeResource,
} from "@repo/app-story-protocol";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    FizzDragonStoryBridge?: { receive(message: string): void };
  }
}

type Result = Extract<StoryBridgeOutbound, { type: "result" }>["payload"];
type Body = {
  [K in StoryBridgeOutbound["type"]]: Omit<
    Extract<StoryBridgeOutbound, { type: K }>,
    "protocol" | "bridgeId" | "requestId"
  >;
}[StoryBridgeOutbound["type"]];
type Notification = Exclude<Body, { type: "result" }>;
type Handlers = {
  back(): boolean | Promise<boolean>;
  refresh(): void;
  pause(paused: boolean): void;
};

/** One page lifetime; native responses from an old page cannot affect this one. */
export class StoryBridge {
  readonly id = crypto.randomUUID();
  readonly context: Promise<StoryBridgeInit>;
  private init?: StoryBridgeInit;
  private handlers?: Handlers;
  private background = false;
  private expired = false;
  private disposed = false;
  private closing = false;
  private readonly pending = new Map<
    string,
    { resolve(value: Result): void; reject(error: Error): void }
  >();
  private readonly replies = new Map<string, Promise<Result>>();
  private readonly resolveContext: (init: StoryBridgeInit) => void;
  private readonly rejectContext: (error: Error) => void;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly post: (message: string) => void) {
    let resolve!: (init: StoryBridgeInit) => void;
    let reject!: (error: Error) => void;
    this.context = new Promise((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    this.resolveContext = resolve;
    this.rejectContext = reject;
    this.timer = setTimeout(() => {
      this.rejectContext(new Error("App initialization timed out. Please reopen this page."));
      this.dispose();
    }, 20000);
  }

  start() {
    this.notify({ type: "ready", payload: { capabilities: ["saveResource", "shareResource"] } });
  }
  supports(action: "saveResource" | "shareResource") {
    return !this.disposed && Boolean(this.init?.capabilities.includes(action));
  }
  get authenticationRequired() {
    return this.expired;
  }

  bind(handlers: Handlers) {
    this.handlers = handlers;
    handlers.pause(this.background || this.expired);
    return () => {
      if (this.handlers === handlers) this.handlers = undefined;
    };
  }
  authenticationExpired() {
    if (this.expired || this.disposed) return;
    this.expired = true;
    this.handlers?.pause(true);
    this.notify({ type: "authExpired", payload: {} });
  }
  contentChanged(projectId: string, chapterId: string) {
    this.notify({ type: "contentChanged", payload: { projectId, chapterId } });
  }
  async back() {
    if (!(await this.handlers?.back()) && !this.closing) {
      this.closing = true;
      this.notify({ type: "close", payload: {} });
    }
  }
  async resource(action: "saveResource" | "shareResource", payload: StoryBridgeResource) {
    if (!this.supports(action))
      throw new Error("This resource action is not available in the App.");
    if (payload.projectId !== this.init?.projectId)
      throw new Error("Resource project does not match this page.");
    const requestId = crypto.randomUUID();
    const message = this.message({ type: action, payload }, requestId);
    const result = await new Promise<Result>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.post(message);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    if (result.status === "error") throw new Error(result.message);
    return result.status;
  }
  receive = (raw: string) => {
    if (this.disposed || typeof raw !== "string" || raw.length > 32768) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = StoryBridgeInboundSchema.safeParse(value);
    if (!parsed.success || parsed.data.bridgeId !== this.id) return;
    const message = parsed.data;
    if (message.type === "result") {
      this.pending.get(message.requestId)?.resolve(message.payload);
      this.pending.delete(message.requestId);
      return;
    }
    let reply = this.replies.get(message.requestId);
    if (!reply) {
      reply = this.handle(message).catch(
        (error): Result => ({
          status: "error",
          code: "BRIDGE_ACTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        })
      );
      this.replies.set(message.requestId, reply);
      if (this.replies.size > 32) this.replies.delete(this.replies.keys().next().value!);
    }
    void reply.then((payload) => {
      if (!this.disposed) this.post(this.message({ type: "result", payload }, message.requestId));
    });
  };
  private async handle(
    message: Exclude<ReturnType<typeof StoryBridgeInboundSchema.parse>, { type: "result" }>
  ): Promise<Result> {
    if (message.type === "init") {
      if (
        this.init &&
        (this.init.projectId !== message.payload.projectId ||
          this.init.chapterId !== message.payload.chapterId ||
          this.init.locale !== message.payload.locale ||
          [...this.init.capabilities].sort().join() !==
            [...message.payload.capabilities].sort().join())
      )
        return {
          status: "error",
          code: "REOPEN_REQUIRED",
          message: "Reopen the page to change account, project, chapter, locale or capabilities.",
        };
      this.init = message.payload;
      clearTimeout(this.timer);
      this.resolveContext(this.init);
      if (this.expired) {
        this.expired = false;
        this.handlers?.pause(this.background);
        if (!this.background) this.handlers?.refresh();
      }
      return { status: "success" };
    }
    if (message.type === "back")
      return { status: "success", handled: Boolean(await this.handlers?.back()) };
    const wasBackground = this.background;
    this.background = message.payload.state === "background";
    this.handlers?.pause(this.background || this.expired);
    if (wasBackground && !this.background && !this.expired) this.handlers?.refresh();
    return { status: "success" };
  }
  private message(value: Body, requestId: string = crypto.randomUUID()) {
    return JSON.stringify(
      StoryBridgeOutboundSchema.parse({
        protocol: APP_STORY_BRIDGE_PROTOCOL,
        bridgeId: this.id,
        requestId,
        ...value,
      })
    );
  }
  private notify(value: Notification) {
    if (!this.disposed) this.post(this.message(value));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    const error = new DOMException("Page closed", "AbortError");
    this.rejectContext(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.handlers = undefined;
    this.replies.clear();
  }
}

export function connectStoryBridge() {
  if (!window.ReactNativeWebView || window.top !== window.self) return undefined;
  const bridge = new StoryBridge((message) => window.ReactNativeWebView!.postMessage(message));
  const receiver = { receive: bridge.receive };
  window.FizzDragonStoryBridge = receiver;
  bridge.start();
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    bridge.dispose();
    if (window.FizzDragonStoryBridge === receiver) delete window.FizzDragonStoryBridge;
  });
  return bridge;
}
