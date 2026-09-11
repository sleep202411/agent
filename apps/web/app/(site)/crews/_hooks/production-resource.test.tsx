import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import {
  useUpdateCrewProductionProject,
  useCreateCrewProductionResource,
  useDeleteCrewProductionResource,
} from "./use-production";

vi.mock("./api", () => ({ crewApi: { post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
const key = crewKeys.productionOverview("crew");
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

it("a failed resource addition preserves another successful addition and newer overview fields", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(crewApi.post)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValueOnce({ id: "successful" });
  const hook = mount(() => useCreateCrewProductionResource("crew"));
  let failed!: Promise<unknown>;
  await act(async () => {
    failed = hook()
      .mutateAsync({ kind: "link", url: "https://example.com/a" })
      .catch((e) => e);
  });
  await act(async () => {
    await hook().mutateAsync({ kind: "link", url: "https://example.com/b" });
  });
  client.setQueryData(key, (current: { resources: unknown[] }) => ({
    ...current,
    project: { name: "new" },
  }));
  await act(async () => {
    reject(new Error("failed"));
    await failed;
  });
  expect(client.getQueryData(key)).toEqual({
    project: { name: "new" },
    resources: [{ id: "original" }, { id: "successful" }],
  });
});

it("a failed resource deletion preserves another confirmed deletion and newer overview fields", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(crewApi.delete)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValueOnce(undefined);
  const hook = mount(() => useDeleteCrewProductionResource("crew"));
  client.setQueryData(key, {
    project: { name: "old" },
    resources: [{ id: "original" }, { id: "second" }],
  });
  let failed!: Promise<unknown>;
  await act(async () => {
    failed = hook()
      .mutateAsync("original")
      .catch((e) => e);
  });
  await act(async () => {
    await hook().mutateAsync("second");
  });
  client.setQueryData(key, (current: { resources: unknown[] }) => ({
    ...current,
    project: { name: "new" },
  }));
  await act(async () => {
    reject(new Error("failed"));
    await failed;
  });
  expect(client.getQueryData(key)).toEqual({
    project: { name: "new" },
    resources: [{ id: "original" }],
  });
});

it("a failed project edit does not restore old resources", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(crewApi.patch).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const hook = mount(() => useUpdateCrewProductionProject("crew"));
  client.setQueryData(key, { project: { version: 1 }, resources: [], labels: [] });
  let failed!: Promise<unknown>;
  await act(async () => {
    failed = hook()
      .mutateAsync({ expectedVersion: 1, priority: "high" })
      .catch((e) => e);
  });
  client.setQueryData(key, (current: object) => ({ ...current, resources: [{ id: "new" }] }));
  await act(async () => {
    reject(new Error("conflict"));
    await failed;
  });
  expect(client.getQueryData(key)).toEqual({
    project: { version: 1 },
    resources: [{ id: "new" }],
    labels: [],
  });
});

it("a delayed project response does not replace a newer confirmed version", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(crewApi.patch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const hook = mount(() => useUpdateCrewProductionProject("crew"));
  client.setQueryData(key, { project: { version: 1 }, resources: [], labels: [] });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = hook().mutateAsync({ expectedVersion: 1, priority: "high" });
  });
  const newer = { project: { version: 3 }, resources: [{ id: "new" }], labels: [{ id: "label" }] };
  client.setQueryData(key, newer);
  await act(async () => {
    complete({ project: { version: 2 }, labels: [] });
    await pending;
  });
  expect(client.getQueryData(key)).toEqual(newer);
});
