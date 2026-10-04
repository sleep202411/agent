import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommunityVideoDialog } from "./community-video-dialog";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
  user: "creator" as string | null,
}));
vi.mock("@/src/lib/api", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/src/lib/media-upload", () => ({ uploadFileViaSignedUrl: h.upload }));
vi.mock("@/src/lib/ip-commerce/api", () => ({ listIpCommerceIps: h.list }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}
beforeEach(() => {
  h.user = "creator";
  h.get.mockResolvedValue({ open: true });
  h.post.mockResolvedValue({ status: "pending" });
  h.upload.mockResolvedValue({ mediaAssetId: "asset" });
  h.list.mockResolvedValue({
    items: [{ id: "channel", title: "Film community" }],
    nextCursor: null,
  });
});
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});
async function mount() {
  const el = document.createElement("div");
  root = createRoot(el);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <CommunityVideoDialog open onOpenChange={() => {}} />
      </QueryClientProvider>
    )
  );
  await settle();
  const file = document.querySelector("input[type=file]")!;
  Object.defineProperty(file, "files", {
    value: [new File(["video"], "film.mp4", { type: "video/mp4" })],
    configurable: true,
  });
  act(() => file.dispatchEvent(new Event("change", { bubbles: true })));
  const title = document.querySelectorAll("input")[1]!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      title,
      "My film"
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent === "Film community")!
      .click()
  );
}
function submit() {
  act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
}
it("uploads a video and submits its title to the selected Community channel", async () => {
  await mount();
  submit();
  await settle();
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(
    "/aurora/ip-commerce/ips/channel/video-submissions",
    expect.objectContaining({ data: { assetId: "asset", title: "My film", description: "" } })
  );
  expect(document.body.textContent).toContain("success");
  expect(h.list).toHaveBeenCalledWith(
    expect.objectContaining({ channelType: "community" }),
    expect.any(AbortSignal)
  );
});
it("checks whether the channel is open before uploading any bytes", async () => {
  h.get.mockResolvedValue({ open: false });
  await mount();
  submit();
  await settle();
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("closed");
});
it("retains the uploaded asset for retry after a submission failure", async () => {
  h.post.mockRejectedValueOnce(new Error("Temporary failure"));
  await mount();
  submit();
  await settle();
  expect(document.body.textContent).toContain("Temporary failure");
  submit();
  await settle();
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain("success");
});
it("owns duplicate submission while upload is pending", async () => {
  h.upload.mockImplementation(() => new Promise(() => {}));
  await mount();
  submit();
  submit();
  await settle();
  expect(h.upload).toHaveBeenCalledTimes(1);
});
