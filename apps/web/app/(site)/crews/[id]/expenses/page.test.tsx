// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import Page from "./page";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
const state = vi.hoisted(() => ({ account: "a" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "crew" }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { get: vi.fn(), post: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("retains failed drafts, submits saved identity and resets private edits on account change", async () => {
  const container = document.createElement("div"),
    root = createRoot(container),
    client = new QueryClient();
  vi.mocked(crewApi.get).mockResolvedValue({ items: [], nextCursor: null });
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      )
    );
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
  const input = (label: string, value: string) =>
    act(() => {
      const field = [...container.querySelectorAll("label")]
        .find((el) => el.textContent?.startsWith(label))!
        .querySelector("input,textarea")!;
      const proto =
        field.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  try {
    await render();
    input("category", "Travel");
    input("purpose", "Meeting");
    input("amount", "12.34");
    vi.mocked(crewApi.post).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => button("save").click());
    expect(container.textContent).toContain("Offline");
    expect(container.querySelector("textarea")!.value).toBe("Meeting");
    const failed = vi.mocked(crewApi.post).mock.calls[0];
    const definition = {
      category: "Travel",
      purpose: "Meeting",
      occurredOn: null,
      currency: "USD",
      amountMinor: "1234",
      evidenceNote: "",
    };
    vi.mocked(crewApi.post).mockResolvedValueOnce({ id: "saved-id", version: 1, definition });
    await act(async () => button("save").click());
    expect(vi.mocked(crewApi.post).mock.calls[1][0]).toBe(failed[0]);
    vi.mocked(crewApi.post).mockResolvedValueOnce({ status: "pending" });
    await act(async () => button("submit").click());
    expect(crewApi.post).toHaveBeenLastCalledWith(
      "/crews/crew/expense-drafts/saved-id/submit",
      expect.objectContaining({ body: { expectedVersion: 1 } })
    );
    expect(container.querySelector("input")!.disabled).toBe(true);
    state.account = "b";
    await render();
    expect(container.querySelector("input")!.value).toBe("");
  } finally {
    act(() => root.unmount());
    client.clear();
    state.account = "a";
  }
});

it("retains history after pagination failure and cancels retry on account change", async () => {
  const container = document.createElement("div"),
    root = createRoot(container);
  const client = new QueryClient();
  const row = {
    id: "history-id",
    version: 2,
    submissionStatus: null,
    createdAt: "2026-09-13T00:00:00Z",
    definition: {
      category: "Travel",
      purpose: "Meeting",
      occurredOn: "2026-09-13",
      currency: "USD",
      amountMinor: "900719925474099",
      evidenceNote: "Original note",
    },
  };
  let signal: AbortSignal | null | undefined;
  let attempts = 0;
  vi.mocked(crewApi.get).mockImplementation(async (path, options) => {
    if (!path.endsWith("/history")) return { items: [row], nextCursor: null };
    if (!options?.query?.beforeVersion) return { items: [row], nextCursor: 2 };
    if (++attempts === 1) throw new Error("History offline");
    signal = options?.signal;
    return new Promise(() => {});
  });
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      )
    );
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  try {
    await render();
    await flush();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Travel"))!
        .click()
    );
    await flush();
    expect(container.querySelector('[aria-label="history"]')?.textContent).toContain(
      "9007199254740.99"
    );
    expect(container.textContent).toContain("Original note");
    const history = container.querySelector('[aria-label="history"]')!;
    await act(async () =>
      [...history.querySelectorAll("button")].find((b) => b.textContent === "more")!.click()
    );
    await flush();
    expect(history.textContent).toContain("History offline");
    expect(history.textContent).toContain("Original note");
    await act(async () =>
      [...history.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
    );
    await flush();
    expect(signal).toBeDefined();
    state.account = "other";
    await render();
    expect(signal?.aborted).toBe(true);
    expect(container.querySelector('[aria-label="history"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    client.clear();
    state.account = "a";
  }
});

it.each([false, true])(
  "discards to the accepted save when the list refresh fails (existing: %s)",
  async (existing) => {
    vi.mocked(crewApi.post).mockReset();
    const container = document.createElement("div"),
      root = createRoot(container),
      client = new QueryClient();
    const original = {
      id: "saved-id",
      version: 1,
      submissionStatus: null,
      definition: {
        category: "Original",
        purpose: "Meeting",
        occurredOn: null,
        currency: "USD",
        amountMinor: "1000",
        evidenceNote: "",
      },
    };
    let saved = false;
    vi.mocked(crewApi.get).mockImplementation(async (path) => {
      if (path === "/crews/crew/expense-drafts") {
        if (saved) throw new Error("List offline");
        return { items: existing ? [original] : [], nextCursor: null };
      }
      return { items: [], nextCursor: null };
    });
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
    const category = () =>
      [...container.querySelectorAll("label")]
        .find((el) => el.textContent?.startsWith("category"))!
        .querySelector("input")!;
    const edit = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          category(),
          value
        );
        category().dispatchEvent(new Event("input", { bubbles: true }));
      });
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Page />
          </QueryClientProvider>
        )
      );
      await flush();
      if (existing)
        await act(async () =>
          [...container.querySelectorAll("button")]
            .find((b) => b.textContent?.startsWith("Original"))!
            .click()
        );
      edit("Saved category");
      vi.mocked(crewApi.post).mockImplementationOnce(async () => {
        saved = true;
        return {
          ...original,
          version: 2,
          definition: { ...original.definition, category: "Saved category" },
        };
      });
      await act(async () => button("save").click());
      await flush();
      expect(container.textContent).toContain("List offline");
      edit("Discard this edit");
      await act(async () => button("discard").click());
      expect(category().value).toBe("Saved category");
      vi.mocked(crewApi.post).mockResolvedValueOnce({ status: "pending" });
      await act(async () => button("submit").click());
      expect(crewApi.post).toHaveBeenLastCalledWith(
        "/crews/crew/expense-drafts/saved-id/submit",
        expect.objectContaining({ body: { expectedVersion: 2 } })
      );
    } finally {
      act(() => root.unmount());
      client.clear();
    }
  }
);
