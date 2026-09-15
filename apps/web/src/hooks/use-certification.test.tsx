import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useMyCertifications,
  useSubmitCertification,
  useUpdateCertification,
} from "./use-certification";
const s = vi.hoisted(() => ({
  user: "a" as string | null,
  works: vi.fn(),

  create: vi.fn(),
}));
vi.mock("./use-user", () => ({ useCurrentUser: () => ({ user: s.user ? { id: s.user } : null }) }));
vi.mock("@/src/services/certification", () => ({
  getMyCertifications: s.works,

  submitCertification: s.create,
  updateCertification: s.create,
}));
let root: Root;
let client: QueryClient;
let works: ReturnType<typeof useMyCertifications>;
let create: ReturnType<typeof useSubmitCertification>;
function View() {
  const w = useMyCertifications();
  const c = useSubmitCertification();
  useUpdateCertification();
  useLayoutEffect(() => {
    works = w;
    create = c;
  });
  return null;
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  for (const fn of [s.works, s.create]) fn.mockReset();
  s.works.mockResolvedValue([{ id: 1 }]);

  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("separates private records and cancels abandoned reads", async () => {
  await render();
  expect(works.data).toEqual([{ id: 1 }]);
  s.user = "b";
  for (const fn of [s.works]) fn.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(works.data).toBeUndefined();
  const signals = [s.works.mock.calls[1][0]] as AbortSignal[];
  s.user = null;
  await render();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(s.works).toHaveBeenCalledTimes(2);
});
it("invalidates only the originating account after a delayed creation", async () => {
  let resolve!: (value: { id: number }) => void;
  s.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  let pending!: ReturnType<typeof create.mutateAsync>;
  await act(async () => {
    pending = create.mutateAsync({ roleId: 1, file: [] });
    await Promise.resolve();
  });
  s.user = "b";
  await render();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    resolve({ id: 2 });
    await pending;
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["certification", "my", "a"] });
  expect(s.works).toHaveBeenCalledTimes(2);
});
