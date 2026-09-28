// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpPublishersSection } from "./ip-publishers-section";
import type { IpPublisherAssignment } from "./types";
vi.mock("@/lib/admin-api", () => ({ adminUiApiPath: (path: string) => path }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ size: _size, ...props }: React.ComponentProps<"button"> & { size?: string }) => (
    <button data-size={_size} {...props} />
  ),
}));
const active = {
  id: "active",
  name: "Active",
  code: "active",
  status: "active",
  logoUrl: "/logo.png",
} as IpPublisherAssignment;
const inactive = { ...active, id: "inactive", status: "inactive" } as IpPublisherAssignment;
const other = { ...active, id: "other", name: "Other", code: "other" };
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
const fetcher = vi.fn();
const saved = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher);
  fetcher
    .mockReset()
    .mockImplementation((_url, init) =>
      Promise.resolve(ok(init?.method === "PATCH" ? {} : { items: [active, inactive, other] }))
    );
  saved.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const render = (assigned: IpPublisherAssignment[]) =>
  act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey="admin">
        <IpPublishersSection ipId="ip" assigned={assigned} onSaved={saved} />
      </AdminSessionBoundary>
    )
  );
const checkboxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const save = () => act(async () => host.querySelector("button")!.click());
it("sends only visible active selections when replacing an inactive binding", async () => {
  await render([inactive]);
  await act(async () => checkboxes()[0].click());
  await save();
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(patch[1].body)).toEqual({ publisherIds: ["active"] });
  expect(saved).toHaveBeenCalledOnce();
});
it("lets an administrator explicitly remove an inactive-only binding", async () => {
  await render([inactive]);
  expect(host.querySelector("button")!.disabled).toBe(false);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  await save();
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(patch[1].body)).toEqual({ publisherIds: [] });
});
it("preserves unsaved choices when equivalent assignments are rendered again", async () => {
  await render([active]);
  await act(async () => checkboxes()[1].click());
  await render([{ ...active }]);
  expect(checkboxes()[1].checked).toBe(true);
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it("resets to changed server assignments", async () => {
  await render([active]);
  await act(async () => checkboxes()[1].click());
  await render([other]);
  expect(checkboxes().map((box) => box.checked)).toEqual([false, true]);
  expect(host.querySelector("button")!.disabled).toBe(true);
});

it("does not allow replacement when the catalog cannot be loaded", async () => {
  fetcher.mockRejectedValueOnce(new Error("Catalog unavailable"));
  await render([inactive]);
  expect(host.textContent).toContain("Catalog unavailable");
  expect(host.querySelector("button")!.disabled).toBe(true);
  await save();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(saved).not.toHaveBeenCalled();
});

it("retains the draft and permits retry after a rejected save", async () => {
  await render([active]);
  await act(async () => checkboxes()[1].click());
  fetcher.mockRejectedValueOnce(new Error("Save unavailable"));
  await save();
  expect(host.textContent).toContain("Save unavailable");
  expect(checkboxes().every((box) => box.checked)).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  await save();
  expect(saved).toHaveBeenCalledOnce();
});
