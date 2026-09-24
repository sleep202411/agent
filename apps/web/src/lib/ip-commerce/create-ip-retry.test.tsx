import { webcrypto } from "node:crypto";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateIpCommerceIp } from "./hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ create: vi.fn(), user: { id: "creator" } }));
vi.mock("./api", () => ({ createIpCommerceIp: state.create }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: state.user }) }));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let mutation: ReturnType<typeof useCreateIpCommerceIp>;
function Fixture() {
  const result = useCreateIpCommerceIp();
  useEffect(() => {
    mutation = result;
  }, [result]);
  return null;
}
const input = { title: "Test project", genreCodes: ["drama"], sourceLocale: "en-US" };
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Fixture />
      </QueryClientProvider>
    );
  });
}
async function submit(value = input) {
  await act(async () => {
    await mutation.mutateAsync(value);
  });
}
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  state.create.mockReset().mockResolvedValue({ ip: { id: "ip" } });
  state.user = { id: "creator" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
describe("IP creation request identity", () => {
  it("keeps its request key after a lost response and repeated submission", async () => {
    state.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(submit()).rejects.toThrow("Response lost");
    await submit();
    await submit();
    const keys = state.create.mock.calls.map(([value]) => value.idempotencyKey);
    expect(keys[0]).toEqual(expect.any(String));
    expect(new Set(keys).size).toBe(1);
  });
  it("creates a new request key for changed input or a different account", async () => {
    await submit();
    await submit({ ...input, title: "Another project" });
    state.user = { id: "another-creator" };
    await render();
    await submit({ ...input, title: "Another project" });
    const keys = state.create.mock.calls.map(([value]) => value.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });
  it("recovers an unresolved request after the form unmounts, but starts fresh after success", async () => {
    state.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(submit()).rejects.toThrow("Response lost");
    const first = state.create.mock.calls[0][0].idempotencyKey;
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).not.toContain(input.title);
    await act(async () => root.render(null));
    await render();
    await submit();
    expect(state.create.mock.calls[1][0].idempotencyKey).toBe(first);
    expect(sessionStorage.length).toBe(0);
    await act(async () => root.render(null));
    await render();
    await submit();
    expect(state.create.mock.calls[2][0].idempotencyKey).not.toBe(first);
  });
  it("reuses an unresolved draft after editing and returning to its original content", async () => {
    state.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(submit()).rejects.toThrow();
    await submit({ ...input, title: "Other draft" });
    await submit();
    expect(state.create.mock.calls[2][0].idempotencyKey).toBe(
      state.create.mock.calls[0][0].idempotencyKey
    );
  });
});
