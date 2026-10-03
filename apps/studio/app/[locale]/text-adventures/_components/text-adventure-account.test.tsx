// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventureAccount, useTextAdventureOwner } from "./text-adventure-account";
import { TextAdventuresLibrary } from "./text-adventures-library";
const s = vi.hoisted(() => ({
  user: "a" as string | null,
  loading: false,
  list: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: s.user ? { id: s.user } : null,
    loading: s.loading,
    signIn: s.signIn,
    isCurrentAccount: (id: string) => s.user === id,
  }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("./text-adventure-create-dialog", () => ({ TextAdventureCreateDialog: () => null }));
vi.mock("../_lib/text-adventure-api", async (original) => ({
  ...(await original<typeof import("../_lib/text-adventure-api")>()),
  listCreatorTextAdventures: s.list,
}));
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
let begin: ReturnType<typeof useTextAdventureOwner>["begin"];
function Editor({ userId }: { userId: string }) {
  const owner = useTextAdventureOwner(userId);
  useLayoutEffect(() => {
    begin = owner.begin;
  }, [owner.begin]);
  return <input defaultValue="draft" />;
}
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.loading = false;
  s.list.mockReset().mockResolvedValue([]);
  s.signIn.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("aborts departed account operations and drops its editor state", async () => {
  const page = () => <TextAdventureAccount>{(id) => <Editor userId={id} />}</TextAdventureAccount>;
  await render(page());
  const operation = begin();
  const input = node.querySelector("input")!;
  input.value = "Private draft";
  s.user = "b";
  await render(page());
  expect(operation.signal.aborted).toBe(true);
  expect(operation.current()).toBe(false);
  expect(() => operation.assert()).toThrow();
  expect(node.querySelector("input")!.value).toBe("draft");
  expect(begin().current()).toBe(true);
});
it("checks session identity before React rerenders", async () => {
  await render(<TextAdventureAccount>{(id) => <Editor userId={id} />}</TextAdventureAccount>);
  const operation = begin();
  s.user = "b";
  expect(operation.current()).toBe(false);
  expect(() => begin()).toThrow();
});
it("does not read private works while signed out or loading auth", async () => {
  s.user = null;
  await render(<TextAdventuresLibrary />);
  expect(s.list).not.toHaveBeenCalled();
  await act(async () => node.querySelector("button")!.click());
  expect(s.signIn).toHaveBeenCalledTimes(1);
  s.loading = true;
  await render(<TextAdventuresLibrary />);
  expect(node.textContent).toContain("loading");
  expect(s.list).not.toHaveBeenCalled();
});
it("does not reuse the previous account's fresh library and cancels its read", async () => {
  let resolve!: (rows: unknown[]) => void;
  s.list
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
    .mockResolvedValue([]);
  await render(<TextAdventuresLibrary />);
  const signal = s.list.mock.calls[0][0] as AbortSignal;
  s.user = "b";
  await render(<TextAdventuresLibrary />);
  expect(signal.aborted).toBe(true);
  expect(s.list).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolve([
      {
        gameId: "tg_0123456789abcdef",
        name: "Private work",
        status: "draft",
        updatedAt: "2026-10-03",
      },
    ])
  );
  expect(node.textContent).not.toContain("Private work");
  expect(client.getQueryData(["text-adventures", "list", "b"])).toEqual([]);
});
