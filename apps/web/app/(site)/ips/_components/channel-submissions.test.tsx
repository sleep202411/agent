// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ChannelSubmissions } from "./channel-submissions";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  mine: vi.fn(),
  open: vi.fn(),
  user: "creator" as string | null,
}));
vi.mock("@/src/lib/api", () => ({ api: { get: h.get, post: h.post, patch: h.patch } }));
vi.mock("@/src/lib/ip-commerce/api", () => ({ listMyIpCommerceIps: h.mine }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.open }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      { value, onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) },
      children
    ),
}));
let node: HTMLDivElement, root: Root;
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};
const button = (text: string) =>
  Array.from(node.querySelectorAll("button")).find((b) => b.textContent === text)!;
const click = async (text: string) => {
  await act(async () => button(text).click());
  await settle();
};
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <ChannelSubmissions ipId="channel" />
      </QueryClientProvider>
    )
  );
  await settle();
}
beforeEach(() => {
  vi.resetAllMocks();
  h.user = "creator";
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  h.get.mockResolvedValue({
    community: true,
    open: true,
    canManage: false,
    items: [],
    nextCursor: null,
  });
  h.mine.mockResolvedValue({
    items: [{ id: "work", title: "My work", status: "published", listingVisibility: "public" }],
    nextCursor: null,
  });
  h.post.mockResolvedValue({});
  h.patch.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
it("requires login before choosing a work", async () => {
  h.user = null;
  await render();
  await click("submit");
  expect(h.open).toHaveBeenCalledOnce();
  expect(h.mine).not.toHaveBeenCalled();
});
it("submits the chosen published work for approval", async () => {
  await render();
  await click("submit");
  await act(async () => {
    const select = node.querySelector("select")!;
    select.value = "work";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("send");
  expect(h.post).toHaveBeenCalledWith("/aurora/ip-commerce/ips/channel/submissions", {
    data: { workId: "work" },
  });
});
it("does not offer submission when closed", async () => {
  h.get.mockResolvedValue({ community: true, open: false, canManage: false, items: [] });
  await render();
  expect(button("submit")).toBeUndefined();
});
it("lets the owner close submissions and approve a pending work using its version", async () => {
  h.get.mockResolvedValue({
    community: true,
    open: true,
    canManage: true,
    items: [{ workId: "work", title: "My work", roomNumber: "123", status: "pending", version: 4 }],
  });
  await render();
  await click("approve");
  expect(h.patch).toHaveBeenCalledWith("/aurora/ip-commerce/ips/channel/submissions", {
    data: { workId: "work", status: "approved", expectedVersion: 4 },
  });
  await click("close");
  expect(h.patch).toHaveBeenCalledWith("/aurora/ip-commerce/ips/channel/submissions/settings", {
    data: { open: false },
  });
});
it("displays a submission failure instead of a success state", async () => {
  h.patch.mockRejectedValue(new Error("Submission changed. Refresh before reviewing."));
  h.get.mockResolvedValue({ community: true, open: true, canManage: true, items: [] });
  await render();
  await click("close");
  expect(node.querySelector("[role=alert]")?.textContent).toContain("Submission changed");
});

it("keeps approved works visible when loading the next page fails and retries that page", async () => {
  const first = {
    community: true,
    open: true,
    canManage: false,
    items: [
      {
        workId: "one",
        title: "First approved work",
        roomNumber: "101",
        status: "approved",
        version: 1,
      },
    ],
    nextCursor: "cursor-1",
  };
  h.get
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error("Page unavailable"))
    .mockResolvedValueOnce({
      ...first,
      items: [
        {
          workId: "two",
          title: "Second approved work",
          roomNumber: "102",
          status: "approved",
          version: 1,
        },
      ],
      nextCursor: null,
    });
  await render();
  await click("more");
  expect(node.textContent).toContain("First approved work");
  expect(node.textContent).toContain("Page unavailable");
  await click("retry");
  expect(h.get.mock.calls[2][1].params.cursor).toBe("cursor-1");
  expect(node.textContent).toContain("First approved work");
  expect(node.textContent).toContain("Second approved work");
});
it("lets creators retry failed work loading without falsely claiming they have no works", async () => {
  h.mine.mockRejectedValueOnce(new Error("Works unavailable"));
  await render();
  await click("submit");
  expect(node.textContent).toContain("Works unavailable");
  expect(node.textContent).not.toContain("noWorks");
  await click("retry");
  expect(node.textContent).toContain("My work");
  expect(node.textContent).not.toContain("Works unavailable");
});

it("retries a failed initial channel read without showing an empty catalog", async () => {
  h.get.mockRejectedValueOnce(new Error("Channel unavailable"));
  await render();
  expect(node.textContent).toContain("Channel unavailable");
  expect(node.textContent).not.toContain("empty");
  await click("retry");
  expect(node.textContent).toContain("description");
});
it("preserves available choices when the next page of a creator's works fails", async () => {
  h.mine
    .mockResolvedValueOnce({
      items: [{ id: "work", title: "My work", status: "published", listingVisibility: "public" }],
      nextCursor: "works-2",
    })
    .mockRejectedValueOnce(new Error("Next works unavailable"))
    .mockResolvedValueOnce({
      items: [
        { id: "other", title: "Other work", status: "published", listingVisibility: "public" },
      ],
      nextCursor: null,
    });
  await render();
  await click("submit");
  await click("more");
  expect(node.textContent).toContain("My work");
  await click("retry");
  expect(h.mine.mock.calls[2][0].cursor).toBe("works-2");
  expect(node.textContent).toContain("My work");
  expect(node.textContent).toContain("Other work");
});
