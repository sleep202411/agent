import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { fetchCreatorServiceById } from "@/data/creator-service-api";
import type { CreatorServiceDetail } from "@/data/types";
import { useServiceDetail } from "./use-service-detail";
vi.mock("@/data/creator-service-api", () => ({ fetchCreatorServiceById: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("hides old route/session data, ignores aborted results and retries errors", async () => {
  const pending: {
    resolve: (value: CreatorServiceDetail | undefined) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
  }[] = [];
  vi.mocked(fetchCreatorServiceById).mockImplementation(
    (_id, signal) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal }))
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  let current: ReturnType<typeof useServiceDetail>;
  function Probe({ id, generation }: { id: string; generation: number }) {
    current = useServiceDetail(id, generation);
    return (
      <span>
        {current.loading ? "loading" : current.error || current.service?.title || "missing"}
      </span>
    );
  }
  const render = (id: string, generation = 1) =>
    act(async () => root.render(<Probe id={id} generation={generation} />));
  try {
    await render("a");
    await act(async () => pending[0].resolve({ title: "First" } as CreatorServiceDetail));
    expect(host.textContent).toBe("First");
    await render("b");
    expect(host.textContent).toBe("loading");
    expect(pending[0].signal?.aborted).toBe(true);
    await render("b", 2);
    await act(async () => pending[1].resolve({ title: "Old account" } as CreatorServiceDetail));
    expect(host.textContent).toBe("loading");
    await act(async () => pending[2].reject(new Error("Service unavailable")));
    expect(host.textContent).toBe("Service unavailable");
    await act(async () => current.retry());
    expect(host.textContent).toBe("loading");
    await act(async () => pending[3].resolve(undefined));
    expect(host.textContent).toBe("missing");
  } finally {
    await act(async () => root.unmount());
  }
  expect(pending[3].signal?.aborted).toBe(true);
});
