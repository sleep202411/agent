import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIpKnowledge } from "./use-ip-knowledge";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  authenticated: true,
  locale: "en-US",
  post: vi.fn(),
  login: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.authenticated ? "authenticated" : "anonymous",
  }),
  useAuthGate: () => ({ requireAuth: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useLocale: () => h.locale, useTranslations: () => (s: string) => s }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, current: ReturnType<typeof useIpKnowledge>;
function Screen({ id }: { id: string }) {
  const value = useIpKnowledge(id);
  useLayoutEffect(() => {
    current = value;
  });
  return null;
}
const render = (id = "ip") => act(async () => root.render(<Screen id={id} />));
const answer = (text: string) => ({
  answer: text,
  citedDocumentIds: ["source"],
  unanswered: false,
});
function deferred() {
  let resolve!: (value: ReturnType<typeof answer>) => void, reject!: (value: Error) => void;
  const promise = new Promise<ReturnType<typeof answer>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.authenticated = true;
  h.locale = "en-US";
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("serializes immediate taps and uses Web's trimmed input, locale and timeout", async () => {
  const pending = deferred();
  h.post.mockReturnValue(pending.promise);
  h.locale = "zh-HK";
  await render();
  await act(async () => {
    void current.ask("  Question  ");
    void current.ask("Duplicate");
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith("/ip-commerce/ips/ip/knowledge/ask", {
    service: "aurora",
    data: { question: "Question", locale: "zh-HK" },
    timeout: 45000,
    signal: expect.any(AbortSignal),
  });
  await act(async () => pending.resolve(answer("Reply")));
  expect(current.answer).toBe("Reply");
  expect(current.citedIds).toEqual(["source"]);
  expect(current.loading).toBe(false);
});
it("a cancelled request cannot clear or overwrite its replacement", async () => {
  const first = deferred(),
    second = deferred();
  h.post.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await act(async () => {
    void current.ask("First");
  });
  const signal = h.post.mock.lastCall![1].signal;
  await act(async () => current.cancel());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    void current.ask("Second");
  });
  await act(async () => first.resolve(answer("Old")));
  expect(current.loading).toBe(true);
  expect(current.answer).toBeUndefined();
  await act(async () => {
    void current.ask("Third");
  });
  expect(h.post).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve(answer("New")));
  expect(current.answer).toBe("New");
});
it("aborts on blur and supports deliberate retry after return without old errors", async () => {
  const first = deferred();
  h.post.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer("Retry"));
  await render();
  await act(async () => {
    void current.ask("Question");
  });
  const signal = h.post.mock.lastCall![1].signal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(current.loading).toBe(false);
  h.active = true;
  await render();
  await act(async () => first.reject(new Error("Old failure")));
  expect(current.error).toBeUndefined();
  await act(async () => current.ask("Question"));
  expect(current.answer).toBe("Retry");
});
it("rejects late previous-account replies and clears visible answers on identity change", async () => {
  const first = deferred();
  h.post.mockReturnValueOnce(first.promise);
  await render();
  await act(async () => {
    void current.ask("Question");
  });
  h.generation++;
  await render();
  await act(async () => first.resolve(answer("Private old reply")));
  expect(current.answer).toBeUndefined();
  expect(current.loading).toBe(false);
  h.post.mockResolvedValue(answer("New reply"));
  await act(async () => current.ask("New"));
  expect(current.answer).toBe("New reply");
  await render("other-ip");
  expect(current.answer).toBeUndefined();
  expect(current.citedIds).toEqual([]);
});
it("shows upstream errors and keeps retry available; guests do not submit", async () => {
  h.post.mockRejectedValueOnce(new Error("Knowledge assistance is not configured."));
  await render();
  await act(async () => current.ask("Question"));
  expect(current.error).toBe("Knowledge assistance is not configured.");
  expect(current.loading).toBe(false);
  h.authenticated = false;
  await render();
  await act(async () => current.ask("Guest"));
  expect(h.login).toHaveBeenCalledExactlyOnceWith();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("aborts the request on unmount", async () => {
  const first = deferred();
  h.post.mockReturnValue(first.promise);
  await render();
  await act(async () => {
    void current.ask("Question");
  });
  const signal = h.post.mock.lastCall![1].signal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => first.resolve(answer("Late")));
});
