import {
  APP_STORY_BRIDGE_PROTOCOL,
  StoryBridgeOutboundSchema,
  type StoryBridgeInbound,
  type StoryBridgeInit,
  type StoryBridgeResource,
} from "@repo/app-story-protocol";

export function storyWebViewCookie(token: { tokenName: string; tokenValue: string }) {
  if (
    !/^[A-Za-z0-9_-]+$/.test(token.tokenName) ||
    !token.tokenValue ||
    /[;,\s\r\n]/.test(token.tokenValue)
  )
    throw new Error("Invalid session cookie.");
  return `${token.tokenName}=${token.tokenValue}`;
}
export function trustedStoryPage(value: string, page: string) {
  try {
    const url = new URL(value),
      expected = new URL(page);
    return (
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password &&
      !url.search
    );
  } catch {
    return false;
  }
}
export function storyBridgeScript(message: StoryBridgeInbound, origin: string) {
  return `if(location.origin===${JSON.stringify(origin)}){window.FizzDragonStoryBridge?.receive(${JSON.stringify(JSON.stringify(message))});} true;`;
}

export class AppStoryNativeBridge {
  private bridgeId?: string;
  private active = true;
  private backId?: string;
  private backTimeout?: ReturnType<typeof setTimeout>;
  get isReady() {
    return !!this.bridgeId && !this.disposed;
  }
  private closed = false;
  private disposed = false;
  private readonly handled = new Set<string>();
  private readonly replies = new Map<
    string,
    Promise<Extract<StoryBridgeInbound, { type: "result" }>["payload"]>
  >();
  constructor(
    private readonly context: StoryBridgeInit,
    private readonly page: string,
    private readonly actions: {
      id(): string;
      send(message: StoryBridgeInbound): void;
      close(): void;
      expired(): void;
      changed(): void;
      resource(action: "saveResource" | "shareResource", value: StoryBridgeResource): Promise<void>;
      failure(message: string): void;
    }
  ) {}
  private send(
    body:
      | { type: "init"; payload: StoryBridgeInit }
      | { type: "appState"; payload: { state: "active" | "background" } }
      | { type: "back"; payload: Record<string, never> }
  ) {
    if (!this.bridgeId || this.disposed) return;
    const requestId = this.actions.id();
    this.actions.send({
      protocol: APP_STORY_BRIDGE_PROTOCOL,
      bridgeId: this.bridgeId,
      requestId,
      ...body,
    });
    return requestId;
  }
  state(active: boolean) {
    this.active = active;
    this.send({ type: "appState", payload: { state: active ? "active" : "background" } });
  }
  back() {
    if (!this.bridgeId) {
      this.close();
      return;
    }
    if (!this.backId) {
      this.backId = this.send({ type: "back", payload: {} });
      // A crashed embedded page must never trap the user in the native route.
      this.backTimeout = setTimeout(() => this.close(), 3000);
    }
  }
  private close() {
    if (!this.closed && !this.disposed) {
      this.closed = true;
      this.actions.close();
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.backTimeout);
  }
  receive(raw: string, url: string) {
    if (this.disposed || !trustedStoryPage(url, this.page) || raw.length > 32768) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = StoryBridgeOutboundSchema.safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "ready") {
      if (this.bridgeId && this.bridgeId !== message.bridgeId) return;
      this.bridgeId = message.bridgeId;
      this.send({ type: "init", payload: this.context });
      this.state(this.active);
      return;
    }
    if (message.bridgeId !== this.bridgeId) return;
    if (message.type === "result") {
      if (message.requestId === this.backId) {
        clearTimeout(this.backTimeout);
        this.backId = undefined;
        if (message.payload.status === "success" && message.payload.handled === false) this.close();
        else if (message.payload.status === "error") this.actions.failure(message.payload.message);
      } else if (message.payload.status === "error") this.actions.failure(message.payload.message);
      return;
    }
    if (message.type === "saveResource" || message.type === "shareResource") {
      if (message.payload.projectId !== this.context.projectId) return;
      let result = this.replies.get(message.requestId);
      if (!result) {
        result = this.actions.resource(message.type, message.payload).then(
          () => ({ status: "success" as const }),
          (error) => ({
            status: "error" as const,
            code: "RESOURCE_FAILED",
            message:
              (error instanceof Error ? error.message : String(error)).slice(0, 2000) ||
              "Resource action failed.",
          })
        );
        this.replies.set(message.requestId, result);
      }
      void result.then((payload) => {
        if (!this.disposed)
          this.actions.send({
            protocol: APP_STORY_BRIDGE_PROTOCOL,
            bridgeId: message.bridgeId,
            requestId: message.requestId,
            type: "result",
            payload,
          });
      });
      return;
    }
    if (this.handled.has(message.requestId)) return;
    this.handled.add(message.requestId);
    if (message.type === "close") this.close();
    if (message.type === "authExpired") this.actions.expired();
    if (message.type === "contentChanged" && message.payload.projectId === this.context.projectId)
      this.actions.changed();
  }
}
