import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchUserDisplays, useUserDisplays } from "./user-displays";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ owner, ids }: { owner?: string; ids: string[] }) {
  const result = useUserDisplays(owner, ids);
  return <div>{ids.map((id) => result?.get(id)?.nickname ?? `User ${id}`).join(",")}</div>;
}
const render = (owner?: string, ids = ["1"]) =>
  act(async () => root.render(<Probe owner={owner} ids={ids} />));
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("chunks numeric IDs at the server limit, deduplicates and ignores unsolicited profiles", async () => {
  vi.mocked(api.get).mockResolvedValue({
    users: [
      { userId: "1", nickname: "Alice", avatar: null },
      { userId: "999", nickname: "Other", avatar: null },
    ],
  });
  const ids = Array.from({ length: 51 }, (_, i) => String(i + 1));
  const result = await fetchUserDisplays(
    [...ids, "1", "crew-uuid", "1,999"],
    new AbortController().signal
  );
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.get).mock.calls[0][1]?.params?.ids?.toString().split(",")).toHaveLength(50);
  expect(result.get("1")?.nickname).toBe("Alice");
  expect(result.has("999")).toBe(false);
});
it("does not request guest or non-user identities", async () => {
  await render();
  expect(api.get).not.toHaveBeenCalled();
  await render("1", ["crew-uuid"]);
  expect(api.get).not.toHaveBeenCalled();
});
it("hides old profiles immediately on account change and suppresses late responses", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.get)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ users: [] });
  await render("alice:1");
  const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
  await render("bob:2");
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ users: [{ userId: "1", nickname: "Old", avatar: null }] }));
  expect(host.textContent).toBe("User 1");
});
it("keeps the identity fallback on failure and avoids refetching reordered IDs", async () => {
  vi.mocked(api.get).mockResolvedValue({
    users: [{ userId: "1", nickname: "Alice", avatar: null }],
  });
  await render("1", ["1", "2"]);
  await render("1", ["2", "1", "1"]);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Alice");
  vi.mocked(api.get).mockRejectedValue(new Error("offline"));
  await render("2");
  expect(host.textContent).toBe("User 1");
});
