import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationInterview } from "./application-interview";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000001" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => (
    <textarea value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />
  ),
}));
const row = {
  id: "00000000-0000-4000-8000-000000000002",
  applicationId: "app",
  version: 1,
  requestKey: "00000000-0000-4000-8000-000000000003",
  actorUserId: "producer",
  action: "schedule",
  state: "proposed",
  scheduledAt: "2026-10-01T12:00:00Z",
  message: "Interview",
  createdAt: "2026-09-30T12:00:00Z",
};
const page = {
  applicationStatus: "pending",
  canUpdate: true,
  version: 1,
  state: "proposed",
  scheduledAt: row.scheduledAt,
  items: [row],
  nextBeforeVersion: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <ApplicationInterview applicationId="app" userId="creator" generation={1} onClose={h.close} />
    )
  );
};
const type = async () => {
  await act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Agreed"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(page);
  h.post.mockImplementation(async (_path, options) => ({
    ...row,
    ...options.data,
    version: 2,
    actorUserId: "creator",
    state: "confirmed",
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows interview state and applicant controls", async () => {
  await render();
  expect(host.textContent).toContain("crewInterview.proposed");
  expect(button("crewInterview.confirm")).toBeTruthy();
  expect(button("crewInterview.schedule")).toBeUndefined();
});
it("requires an explanation before writing", async () => {
  await render();
  await click("crewInterview.confirm");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewInterview.messageRequired");
});
it("confirms exact reviewed version and reloads history", async () => {
  await render();
  await type();
  await click("crewInterview.confirm");
  expect(h.post).toHaveBeenCalledWith(
    "/applications/app/interview",
    expect.objectContaining({
      data: expect.objectContaining({ expectedVersion: 1, action: "confirm", message: "Agreed" }),
    })
  );
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("reuses immutable request after ambiguous response", async () => {
  h.post.mockRejectedValueOnce(new Error("Network"));
  await render();
  await type();
  await click("crewInterview.confirm");
  const original = h.post.mock.calls[0]![1];
  expect(button("crewInterview.refresh").disabled).toBe(true);
  await click("crewInterview.retry");
  expect(h.post.mock.calls[1]![1]).toEqual(original);
});
it("requires refresh after conflict", async () => {
  h.post.mockRejectedValueOnce(Object.assign(new Error("Changed"), { status: 409 }));
  await render();
  await type();
  await click("crewInterview.confirm");
  expect(button("crewInterview.confirm").disabled).toBe(true);
  expect(button("crewInterview.retry")).toBeUndefined();
  await click("crewInterview.refresh");
  expect(button("crewInterview.confirm").disabled).toBe(false);
});
it("does not write after account change", async () => {
  await render();
  await type();
  h.generation = 2;
  await click("crewInterview.confirm");
  expect(h.post).not.toHaveBeenCalled();
});
it("shows reviewed applications as read only", async () => {
  h.get.mockResolvedValue({ ...page, applicationStatus: "approved", canUpdate: false });
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("crewInterview.readOnly");
});
it("locks double taps and back while writing", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await type();
  await act(async () => {
    button("crewInterview.confirm").click();
    button("crewInterview.confirm").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () =>
    resolve({
      ...row,
      ...h.post.mock.calls[0]![1].data,
      version: 2,
      actorUserId: "creator",
      state: "confirmed",
    })
  );
});
it("loads older events without exposing stale mutation controls", async () => {
  h.get
    .mockResolvedValueOnce({
      ...page,
      version: 2,
      items: [{ ...row, version: 2 }],
      nextBeforeVersion: 2,
    })
    .mockResolvedValue({ ...page, version: 2 });
  await render();
  await click("crewInterview.older");
  expect(h.get).toHaveBeenLastCalledWith(
    "/applications/app/interview",
    expect.objectContaining({ params: { limit: 20, beforeVersion: 2 } })
  );
  expect(host.querySelector("textarea")).toBeNull();
});
it("ignores late success after leaving the screen", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await type();
  await click("crewInterview.confirm");
  await act(async () => root.render(null));
  await act(async () =>
    resolve({
      ...row,
      ...h.post.mock.calls[0]![1].data,
      version: 2,
      actorUserId: "creator",
      state: "confirmed",
    })
  );
  expect(h.get).toHaveBeenCalledTimes(1);
});
