// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CrewModerationPanel } from "./crew-moderation-panel";
import { CrewPositionModerationPanel } from "./crew-position-moderation-panel";
vi.mock("../billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    open ? (
      <section role="dialog">
        {children}
        {footer}
      </section>
    ) : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const row = (id: string, moderationStatus = "taken_down") => ({
  id,
  name: id,
  positionType: id,
  crewName: "Crew",
  crewId: "crew",
  description: "Role",
  logo: "fixture.png",
  crewLogo: "fixture.png",
  ownerUserId: null,
  memberCount: 1,
  listingStatus: "listed",
  moderationStatus,
  createdAt: "2026-01-01",
});
const response = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: () => Promise.resolve({ code: ok ? 200 : 503, msg: "Moderation unavailable", data }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(position: boolean, scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        {position ? <CrewPositionModerationPanel /> : <CrewModerationPanel />}
      </AdminSessionBoundary>
    )
  );
}
function button(text: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
for (const position of [false, true]) {
  const label = position ? "positions" : "crews";
  it(`${label}: blocks rapid competing restores and suppresses abandoned completion`, async () => {
    const pending = deferred();
    fetchMock
      .mockResolvedValueOnce(response({ items: [row("alpha"), row("beta")], nextCursor: null }))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response({ items: [row("replacement")], nextCursor: null }));
    await render(position);
    const buttons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "恢复"
    );
    await act(async () => {
      buttons[0]!.click();
      buttons[1]!.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    await render(position, "two");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(response(row("alpha", "ok")));
    });
    expect(container.textContent).toContain("replacement");
    expect(container.textContent).not.toContain("alpha");
  });
  it(`${label}: retries the failed cursor and deduplicates boundary rows`, async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [row("alpha")], nextCursor: "next" }))
      .mockResolvedValueOnce(response(null, false))
      .mockResolvedValueOnce(response({ items: [row("alpha"), row("beta")], nextCursor: null }));
    await render(position);
    await act(async () => button("加载更多").click());
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("Moderation unavailable");
    await act(async () => button("加载更多").click());
    expect(fetchMock.mock.calls[2][0]).toContain("cursor=next");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
  it(`${label}: preserves failed takedown reason and permits a corrected retry`, async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [row("alpha", "ok")], nextCursor: null }))
      .mockResolvedValueOnce(response(null, false))
      .mockResolvedValueOnce(response(row("alpha")));
    await render(position);
    await act(async () => button("下架").click());
    const input = container.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Evidence retained"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("确认下架").click());
    expect(input.value).toBe("Evidence retained");
    expect(container.textContent).toContain("Moderation unavailable");
    await act(async () => button("确认下架").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
}
