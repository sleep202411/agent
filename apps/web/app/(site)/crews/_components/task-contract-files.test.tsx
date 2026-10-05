import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskContractFiles, ContractFileRow, type TaskContractFile } from "./task-contract-files";
import MyContracts from "../../contracts/page";
const h = vi.hoisted(() => ({ user: "owner", get: vi.fn(), post: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: h.user }, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("../[id]/workspace/_components/tasks/task-delivery-upload", () => ({
  TaskDeliveryUpload: ({
    onUploaded,
    disabled,
  }: {
    onUploaded: (asset: { id: string; name: string }) => void;
    disabled: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => onUploaded({ id: "node", name: "New addendum.pdf" })}
    >
      Upload fixture
    </button>
  ),
}));
vi.mock("../[id]/workspace/_components/members/crew-agreements-dialog", () => ({
  CrewAgreementsDialog: () => null,
}));
const file: TaskContractFile = {
  id: "file",
  name: "Original.pdf",
  attachedAt: null,
  sizeBytes: "123",
  contentType: "application/pdf",
  available: true,
};
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "owner";
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue({ items: [file] });
  h.post.mockReset().mockResolvedValue({ id: "new-file" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(content = <TaskContractFiles taskId="task" crewId="crew" canManage />) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 15));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
    await new Promise((r) => setTimeout(r, 15));
  });
}
it("shows immutable file details and requires explicit attachment after upload", async () => {
  await render();
  expect(host.textContent).toContain("Original.pdf");
  expect(host.textContent).toContain("readOnly");
  await click("Upload fixture");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("attachNotice");
  await click("attach");
  expect(h.post).toHaveBeenCalledWith("/crew-tasks/task/contracts", {
    body: { assetNodeId: "node" },
  });
});
it("retries the same attachment after a lost response and preserves the selected file", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue({ id: "new-file" });
  await render();
  await click("Upload fixture");
  await click("attach");
  expect(host.textContent).toContain("Lost response");
  expect(host.textContent).toContain("New addendum.pdf");
  await click("retryAttach");
  expect(h.post.mock.calls[1]).toEqual(h.post.mock.calls[0]);
});
it("offers no editing controls to viewers and hides stale files after a failed read", async () => {
  await render(<TaskContractFiles taskId="task" crewId="crew" canManage={false} />);
  expect(button("Upload fixture")).toBeUndefined();
  h.get.mockRejectedValue(new Error("Access revoked"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["task-contract-files"] });
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
  expect(host.textContent).not.toContain("Original.pdf");
  expect(host.textContent).toContain("Access revoked");
});
it("requests a fresh authorized download and rejects unsafe links", async () => {
  h.get.mockResolvedValueOnce({
    url: "javascript:alert(1)",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await render(<ContractFileRow file={file} />);
  await click("download");
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).toContain("invalidLink");
  h.get.mockResolvedValueOnce({
    url: "https://storage.test/read",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await click("download");
  expect(h.get).toHaveBeenLastCalledWith("/task-contract-files/file/download", {
    cache: "no-store",
  });
  expect(host.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
});
it("groups multiple contracts and resets archive pagination when switching views", async () => {
  h.get.mockImplementation(async (path: string, options?: { query?: { lifecycle: string } }) =>
    path === "/me/crew-agreements"
      ? { items: [], nextCursor: null }
      : {
          items: [
            {
              id: "task",
              title: options?.query?.lifecycle === "archived" ? "Archived task" : "Current task",
              number: 1,
              crew: { id: "crew", name: "Crew" },
              archived: options?.query?.lifecycle === "archived",
              files: [file, { ...file, id: "addendum", name: "Addendum.pdf" }],
            },
          ],
          nextCursor: null,
        }
  );
  await render(<MyContracts />);
  await click("files");
  expect(host.textContent).toContain("Original.pdf");
  expect(host.textContent).toContain("Addendum.pdf");
  await click("archived");
  expect(host.textContent).toContain("Archived task");
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/task-contracts",
    expect.objectContaining({ query: { lifecycle: "archived", cursor: undefined, limit: 20 } })
  );
});
