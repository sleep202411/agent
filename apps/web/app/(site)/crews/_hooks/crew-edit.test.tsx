import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import { useUpdateCrew, useUpdateCrewListing } from "./use-crew-detail";

vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "alice" } }) }));
vi.mock("./api", () => ({ crewApi: { post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
const key = crewKeys.detail("crew");
function mount<T>(hook: () => T) {
  client = new QueryClient();
  root = createRoot(document.createElement("div"));
  let result: T;
  function Probe() {
    result = hook();
    return null;
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  );
  client.setQueryData(key, { project: { name: "old" }, resources: [{ id: "original" }] });
  return () => result!;
}
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});

it("failed Crew edits preserve another successful edit", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(crewApi.patch)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValueOnce({ id: "crew", name: "Confirmed", version: 2 });
  const hook = mount(() => useUpdateCrew());
  client.setQueryData(key, { id: "crew", name: "Original", version: 1 });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook()
      .mutateAsync({ id: "crew", expectedVersion: 1, name: "Failed" })
      .catch((e) => e);
  });
  await act(async () => {
    await hook().mutateAsync({ id: "crew", expectedVersion: 1, name: "Confirmed" });
  });
  await act(async () => {
    reject(new Error("conflict"));
    await pending;
  });
  expect(client.getQueryData(key)).toEqual({ id: "crew", name: "Confirmed", version: 2 });
});

it("ignores an older edit response after newer Crew data arrives", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(crewApi.patch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const hook = mount(() => useUpdateCrew());
  client.setQueryData(key, { id: "crew", name: "Original", version: 1 });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook().mutateAsync({ id: "crew", expectedVersion: 1, name: "Older" });
  });
  const latest = { id: "crew", name: "Newer", version: 3 };
  client.setQueryData(key, latest);
  await act(async () => {
    complete({ id: "crew", name: "Older", version: 2 });
    await pending;
  });
  expect(client.getQueryData(key)).toEqual(latest);
});

it("does not replace newer Crew details with an older listing response", async () => {
  vi.mocked(crewApi.patch).mockResolvedValue({ id: "crew", version: 2 });
  const hook = mount(() => useUpdateCrewListing());
  const latest = { id: "crew", name: "Newer", version: 3 };
  client.setQueryData(key, latest);
  await act(async () => {
    await hook().mutateAsync({ id: "crew", listingStatus: "listed", expectedVersion: 1 });
  });
  expect(client.getQueryData(key)).toEqual(latest);
});
