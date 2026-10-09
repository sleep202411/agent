import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskMentionPicker } from "./task-mention-picker";
const h = vi.hoisted(() => ({ fetch: vi.fn(), select: vi.fn(), generation: 1 }));
vi.mock("./task-mentions", () => ({ fetchMentionMembers: h.fetch }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["2", { nickname: "Artist" }]]),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  FlatList: ({
    data,
    renderItem,
  }: {
    data: { userId: string }[];
    renderItem: (v: { item: { userId: string } }) => ReactNode;
  }) => (
    <div>
      {data.map((item) => (
        <div key={item.userId}>{renderItem({ item })}</div>
      ))}
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const member = (userId: string) => ({ id: `m${userId}`, crewId: "crew", userId, status: "active" });
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const render = () =>
  act(async () =>
    root.render(
      <TaskMentionPicker
        crewId="crew"
        userId="1"
        generation={1}
        excludedIds={["3"]}
        onSelect={h.select}
        onClose={() => {}}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("excludes self/selected members, deduplicates pages and prevents duplicate selection", async () => {
  h.fetch
    .mockResolvedValueOnce({ items: [member("1"), member("2"), member("3")], nextCursor: "m3" })
    .mockResolvedValueOnce({ items: [member("2"), member("4")], nextCursor: null });
  await render();
  expect(host.textContent).not.toContain("@1");
  expect(host.textContent).not.toContain("@3");
  await act(async () => button("discovery.more").click());
  expect(h.fetch.mock.calls[1][1]).toBe("m3");
  expect(
    Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "@Artist · 2")
  ).toHaveLength(1);
  await act(async () => {
    button("@Artist · 2").click();
    button("@Artist · 2").click();
  });
  expect(h.select).toHaveBeenCalledExactlyOnceWith({ userId: "2", label: "Artist" });
});
it("clears candidates on revoked access and restarts pagination on retry", async () => {
  h.fetch
    .mockResolvedValueOnce({ items: [member("2")], nextCursor: "m2" })
    .mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }))
    .mockResolvedValueOnce({ items: [member("4")], nextCursor: null });
  await render();
  await act(async () => button("discovery.more").click());
  expect(host.textContent).not.toContain("@Artist");
  await act(async () => button("inbox.retry").click());
  expect(h.fetch.mock.calls[2][1]).toBeNull();
  expect(host.textContent).not.toContain("@Artist");
  expect(host.textContent).toContain("@4");
});
it("stops cursor loops and ignores results after account change or unmount", async () => {
  h.fetch
    .mockResolvedValueOnce({ items: [member("2")], nextCursor: "m2" })
    .mockResolvedValueOnce({ items: [member("4")], nextCursor: "m2" });
  await render();
  await act(async () => button("discovery.more").click());
  expect(host.textContent).toContain("Repeated Crew member cursor");
  expect(host.textContent).not.toContain("@4");
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await act(async () => button("inbox.retry").click());
  h.generation = 2;
  await act(async () => finish({ items: [member("4")], nextCursor: null }));
  expect(host.textContent).not.toContain("@4");
  const signal = h.fetch.mock.calls.at(-1)![2];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("allows self-assignment only when explicitly enabled", async () => {
  h.fetch.mockResolvedValue({ items: [member("1"), member("2")], nextCursor: null });
  await act(async () =>
    root.render(
      <TaskMentionPicker
        crewId="crew"
        userId="1"
        generation={1}
        excludedIds={[]}
        includeSelf
        title="Assignees"
        onSelect={h.select}
        onClose={() => {}}
      />
    )
  );
  expect(host.textContent).toContain("Assignees");
  await act(async () => button("@1 · 1").click());
  expect(h.select).toHaveBeenCalledExactlyOnceWith({ userId: "1", label: "1" });
});

it("returns the crew membership identifier for earning recipients including self", async () => {
  h.fetch.mockResolvedValue({ items: [member("1")], nextCursor: null });
  await act(async () =>
    root.render(
      <TaskMentionPicker
        crewId="crew"
        userId="1"
        generation={1}
        excludedIds={[]}
        includeSelf
        onSelectMember={h.select}
        onClose={() => {}}
      />
    )
  );
  await act(async () => button("@1 · 1").click());
  expect(h.select).toHaveBeenCalledExactlyOnceWith({ crewMemberId: "m1", userId: "1", label: "1" });
});
