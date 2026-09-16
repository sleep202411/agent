// @vitest-environment jsdom
import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AdminSessionBoundary, useAdminSessionRequests } from "./admin-session-boundary";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
let requests: ReturnType<typeof useAdminSessionRequests>;
let edit: (value: string) => void;
function Probe() {
  const scope = useAdminSessionRequests();
  const [draft, setDraft] = useState("");
  useLayoutEffect(() => {
    requests = scope;
    edit = setDraft;
  }, [scope]);
  return <span>{draft}</span>;
}
async function render(key: string) {
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={key}>
        <Probe />
      </AdminSessionBoundary>
    )
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});
it("preserves same-session drafts but resets them and aborts requests for a replacement identity", async () => {
  await render("global/alice/session-a");
  await act(async () => edit("draft"));
  const oldScope = requests;
  const request = requests.begin()!;
  await render("global/alice/session-a");
  expect(container.textContent).toBe("draft");
  expect(request.signal.aborted).toBe(false);
  await render("global/alice/session-b");
  expect(container.textContent).toBe("");
  expect(request.signal.aborted).toBe(true);
  expect(request.current()).toBe(false);
  expect(oldScope.begin()).toBeNull();
  expect(requests.begin()?.current()).toBe(true);
});
it("cancels requests on unmount and supports releasing completed reads", async () => {
  await render("global/alice/session-a");
  const active = requests.begin()!;
  const released = requests.begin()!;
  released.release();
  await act(async () => root!.unmount());
  root = undefined;
  expect(active.signal.aborted).toBe(true);
  expect(active.current()).toBe(false);
  expect(released.current()).toBe(false);
});
