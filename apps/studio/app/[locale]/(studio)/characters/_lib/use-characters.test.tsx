// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  useCharacter,
  useCharacters,
  useApplyCharacterDetail,
  charactersKeys,
} from "./use-characters";
import { getCharacter, listCharacters, type CharacterDetail } from "@/lib/characters-api";
const state = vi.hoisted(() => ({ user: "a" as string | null }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.user ? { id: state.user } : null }),
}));
vi.mock("@/app/_components/workspace-context", () => ({ useActiveWorkspaceId: () => "workspace" }));
vi.mock("@/lib/canvas-authoring/assets-realtime-kernel", () => ({
  getAssetsRealtimeKernel: vi.fn(),
}));
vi.mock("@/lib/characters-api", () => ({ getCharacter: vi.fn(), listCharacters: vi.fn() }));
let root: Root;
let client: QueryClient;
let result: {
  detail: ReturnType<typeof useCharacter>;
  list: ReturnType<typeof useCharacters>;
  apply: ReturnType<typeof useApplyCharacterDetail>;
};
function Harness() {
  const detail = useCharacter("character");
  const list = useCharacters("workspace");
  const apply = useApplyCharacterDetail();
  useLayoutEffect(() => {
    result = { detail, list, apply };
  });
  return null;
}
const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.user = "a";
  vi.mocked(getCharacter).mockImplementation(() => new Promise(() => {}));
  vi.mocked(listCharacters).mockImplementation(() => new Promise(() => {}));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});
it("does not expose cached character details or lists across accounts", async () => {
  const detail = { id: "character", name: "private" } as CharacterDetail;
  client.setQueryData(charactersKeys.viewerDetail("character", "a"), detail);
  client.setQueryData(charactersKeys.viewerList("workspace", "a"), [detail]);
  await render();
  expect(result.detail.data).toEqual(detail);
  state.user = "b";
  await render();
  expect(result.detail.data).toBeUndefined();
  expect(result.list.data).toBeUndefined();
});
it("cancels abandoned reads and keeps old mutation cache writes with their initiating account", async () => {
  await render();
  const detailSignal = vi.mocked(getCharacter).mock.calls[0][1]!;
  const listSignal = vi.mocked(listCharacters).mock.calls[0][1]!;
  const oldApply = result.apply;
  state.user = "b";
  await render();
  expect(detailSignal.aborted).toBe(true);
  expect(listSignal.aborted).toBe(true);
  const detail = { id: "character", name: "old" } as CharacterDetail;
  await act(async () => oldApply(detail));
  expect(client.getQueryData(charactersKeys.viewerDetail("character", "a"))).toEqual(detail);
  expect(client.getQueryData(charactersKeys.viewerDetail("character", "b"))).toBeUndefined();
});
it("does not request private character data while signed out", async () => {
  state.user = null;
  await render();
  expect(getCharacter).not.toHaveBeenCalled();
  expect(listCharacters).not.toHaveBeenCalled();
});
