import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useStoryTopUpRecovery } from "./use-story-top-up-recovery";
import { createStoryTopUpReturnStore } from "../lib/story-top-up-return";
const h = vi.hoisted(() => ({
  account: "alice",
  generation: 1,
  active: true,
  data: new Map<string, string>(),
  alert: vi.fn(),
  push: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.account ? "authenticated" : "hydrating",
    user: { id: h.account },
    generation: h.generation,
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("../components/story-top-up-recovery-dialog", () => ({
  StoryTopUpRecoveryDialog: (props: {
    error?: string;
    onCancel: () => void;
    onContinue?: () => void;
  }) => {
    h.alert(props.error ? "play.topUpReturn.error" : "play.topUpReturn.title", "", [
      { onPress: props.onCancel },
      { onPress: props.onContinue },
    ]);
    return null;
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (_namespace: string, account: string) => ({
    read: () => h.data.get(account) ?? null,
    write: (next: string) => h.data.set(account, next),
  }),
}));
function saved(account = "alice") {
  return createStoryTopUpReturnStore(
    {
      read: () => h.data.get(account) ?? null,
      write: (next) => {
        h.data.set(account, next);
      },
    },
    "previous-process"
  );
}
function Harness() {
  return useStoryTopUpRecovery();
}
let root: Root;
const render = () => act(async () => root.render(<Harness />));
const buttons = () => h.alert.mock.calls.at(-1)![2] as { onPress: () => void }[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.account = "alice";
  h.generation = 1;
  h.active = true;
  h.data.clear();
  h.alert.mockReset();
  h.push.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("offers a cold destination and keeps it until the film opens", async () => {
  const entry = saved().remember("film", "two");
  await render();
  expect(h.alert).toHaveBeenCalled();
  await act(async () => buttons()[1]!.onPress());
  expect(h.push).toHaveBeenCalledExactlyOnceWith("/play/interactive-film/film?chapter=two");
  expect(saved().matches(entry.id)).toBe(true);
});
it("dismisses the destination without removing saved playback", async () => {
  saved().remember("film");
  h.data.set("saved-playback", "checkpoint");
  await render();
  await act(async () => buttons()[0]!.onPress());
  expect(saved().interrupted()).toBeNull();
  expect(h.data.get("saved-playback")).toBe("checkpoint");
  expect(h.push).not.toHaveBeenCalled();
});
it("does not interrupt inactive Home or another account", async () => {
  saved().remember("film");
  h.active = false;
  await render();
  expect(h.alert).not.toHaveBeenCalled();
  h.active = true;
  h.account = "bob";
  h.generation++;
  await render();
  expect(h.alert).not.toHaveBeenCalled();
  h.account = "alice";
  h.generation++;
  await render();
  expect(h.alert).toHaveBeenCalled();
});
it("rejects old alerts after account change, blur or destination replacement", async () => {
  saved().remember("film");
  await render();
  const first = buttons();
  h.generation++;
  first[1]!.onPress();
  expect(h.push).not.toHaveBeenCalled();
  await render();
  const second = buttons();
  h.active = false;
  await render();
  second[1]!.onPress();
  expect(h.push).not.toHaveBeenCalled();
  h.active = true;
  await render();
  const third = buttons();
  const next = saved().remember("new");
  third[0]!.onPress();
  third[1]!.onPress();
  expect(saved().matches(next.id)).toBe(true);
  expect(h.push).not.toHaveBeenCalled();
});
it("waits for authentication hydration", async () => {
  saved().remember("film");
  h.account = "";
  await render();
  expect(h.alert).not.toHaveBeenCalled();
  h.account = "alice";
  await render();
  expect(h.alert).toHaveBeenCalled();
});
it("reports malformed state without navigating or discarding it", async () => {
  h.data.set("alice", "bad json");
  await render();
  expect(h.alert.mock.calls[0]![0]).toBe("play.topUpReturn.error");
  expect(h.push).not.toHaveBeenCalled();
  expect(h.data.get("alice")).toBe("bad json");
});
