import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskContractFiles } from "./task-contract-files";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  data: new Map<string, string>(),
  failWrite: false,
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
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
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, task: string) => {
    const key = JSON.stringify([namespace, user, task]);
    return {
      read: () => h.data.get(key),
      write: (value: string) => {
        if (h.failWrite) throw Error("Storage unavailable");
        h.data.set(key, value);
      },
    };
  },
}));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: async () => ({}) }));
vi.mock("./task-contract-field", () => ({
  TaskContractField: ({
    onChange,
    locked,
    value,
  }: {
    onChange: (id: string) => void;
    locked: boolean;
    value: string | null;
  }) => (
    <button disabled={locked} onClick={() => onChange(id(2))}>
      select:{value}
    </button>
  ),
}));
vi.mock("./contract-file-row", () => ({
  ContractFileRow: ({ file }: { file: { name: string } }) => <span>{file.name}</span>,
}));
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () =>
    root.render(<TaskContractFiles taskId={id(1)} crewId="crew" userId="alice" generation={1} />)
  );
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text))!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.data.clear();
  h.failWrite = false;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me")
      ? { userId: "alice", permissions: ["tasks.manage"] }
      : {
          items: [
            {
              id: id(3),
              name: "Original.pdf",
              attachedAt: null,
              sizeBytes: null,
              contentType: null,
              available: true,
            },
          ],
        }
  );
  h.post.mockResolvedValue({ id: id(4) });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("retains and retries the same attachment after a lost response and background return", async () => {
  await mount();
  expect(host.textContent).toContain("Original.pdf");
  await click("select:");
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await click("taskContractFiles.attach");
  expect(host.textContent).toContain("Response lost");
  expect(host.querySelector("button[disabled]")).not.toBeNull();
  h.active = false;
  await mount();
  h.active = true;
  await mount();
  expect(host.textContent).toContain("taskContractFiles.retryAttach");
  await click("taskContractFiles.retryAttach");
  expect(h.post.mock.calls.map((call) => call[1].data)).toEqual([
    { assetNodeId: id(2) },
    { assetNodeId: id(2) },
  ]);
  expect([...h.data.values()]).toEqual([""]);
  expect(host.textContent).not.toContain("taskContractFiles.retryAttach");
});
it("does not send if pending persistence fails", async () => {
  await mount();
  await click("select:");
  h.failWrite = true;
  await click("taskContractFiles.attach");
  expect(host.textContent).toContain("Storage unavailable");
  expect(h.post).not.toHaveBeenCalled();
  h.failWrite = false;
  await click("taskContractFiles.attach");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("shows retained files without attachment controls for viewers and retires changed accounts", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me")
      ? { userId: "alice", permissions: [] }
      : {
          items: [
            {
              id: id(3),
              name: "Original.pdf",
              attachedAt: null,
              sizeBytes: null,
              contentType: null,
              available: true,
            },
          ],
        }
  );
  await mount();
  expect(host.textContent).toContain("Original.pdf");
  expect(host.textContent).not.toContain("select:");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
it("recovers a persisted-state read failure without discarding its data", async () => {
  h.data.set(JSON.stringify(["task-contract-attachment", "alice", id(1)]), "broken");
  await mount();
  expect(host.textContent).not.toContain("select:");
  h.data.set(
    JSON.stringify(["task-contract-attachment", "alice", id(1)]),
    JSON.stringify({ assetNodeId: id(2), attempted: true })
  );
  await click("common.retry");
  expect(host.textContent).toContain("taskContractFiles.retryAttach");
});
