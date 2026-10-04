// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({
  userId: "alice",
  get: vi.fn(),
  search: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.userId }, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/src/lib/api", () => ({ api: { get: (...args: unknown[]) => state.get(...args) } }));
vi.mock("@/src/lib/ip-commerce/api", () => ({
  listIpCommerceIps: (...args: unknown[]) => state.search(...args),
  reportIpContent: (...args: unknown[]) => state.submit(...args),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    onChange,
    children,
    ...props
  }: {
    onChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    // NativeSelect test double: exercise value callbacks without portal behavior.
    // eslint-disable-next-line no-restricted-syntax
    <select {...props} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ children, ...props }: { children: React.ReactNode }) => (
    <option {...props}>{children}</option>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  client?.clear();
  document.body.innerHTML = "";
  vi.resetAllMocks();
  state.userId = "alice";
});
async function render() {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function click(label: string) {
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("switches report views through independently scoped requests", async () => {
  state.get.mockResolvedValue({ items: [], nextCursor: null });
  await render();
  await click("responses");
  expect(state.get).toHaveBeenLastCalledWith(
    "/aurora/ip-commerce/me/reports",
    expect.objectContaining({ params: { view: "responses", cursor: undefined, limit: 20 } })
  );
  expect(document.body.textContent).toContain("responsesHint");
});
it("does not display the previous account’s reports after an account switch", async () => {
  state.get.mockImplementation(() =>
    Promise.resolve({
      items:
        state.userId === "alice"
          ? [
              {
                id: "private-alice",
                reason: "copyright",
                status: "submitted",
                createdAt: "2026-10-04",
                description: "Alice evidence",
              },
            ]
          : [],
      nextCursor: null,
    })
  );
  await render();
  expect(document.body.textContent).toContain("Alice evidence");
  state.userId = "bob";
  await render();
  expect(document.body.textContent).not.toContain("Alice evidence");
});
it("hides existing reports after access is revoked", async () => {
  state.get.mockResolvedValue({
    items: [
      {
        id: "report",
        reason: "copyright",
        status: "submitted",
        createdAt: "2026-10-04",
        description: "Private evidence",
      },
    ],
    nextCursor: null,
  });
  await render();
  state.get.mockRejectedValue(new Error("Access revoked"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["my-content-reports"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain("Access revoked");
  expect(document.body.textContent).not.toContain("Private evidence");
});
it("requires a real selected IP before sending a complaint", async () => {
  state.get.mockResolvedValue({ items: [], nextCursor: null });
  state.search.mockResolvedValue({
    items: [{ id: "ip-1", title: "Test film", roomNumber: "100001" }],
    nextCursor: null,
  });
  state.submit.mockResolvedValue({ report: { id: "report", status: "submitted" } });
  await render();
  await click("newReport");
  const submit = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "submit"
  )!;
  expect(submit.disabled).toBe(true);
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.querySelector('select[aria-label="target"] option[value="ip-1"]')
    ).not.toBeNull();
  });
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="target"]')!;
    select.value = "ip-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("submit");
  expect(state.submit).toHaveBeenCalledWith({
    targetType: "ip",
    targetId: "ip-1",
    reason: "copyright",
    description: undefined,
  });
  expect(document.querySelector("form")).toBeNull();
});
