import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ExperienceAccessRequirement,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExperiencePlayerAccess } from "../lib/experience-player-access";
import type { StoryCommunityAccessQuote } from "../api/story-community-access-api";
import { useStoryCommunityAccess } from "./use-story-community-access";

const mocks = vi.hoisted(() => ({
  quote: vi.fn(),
  purchase: vi.fn(),
  paywall: vi.fn(),
  remember: vi.fn(),
  generation: 0,
  listeners: new Set<() => void>(),
  t: (key: string) => key,
}));
vi.mock("@tabler/icons-react-native", () => ({ IconLock: () => null }));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("@/auth", () => ({
  getAuthSnapshot: () => ({ status: "authenticated", user: { id: "account" } }),
  openAuthSheet: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({
  getAuthGeneration: () => mocks.generation,
  subscribeAuth: (fn: () => void) => {
    mocks.listeners.add(fn);
    return () => mocks.listeners.delete(fn);
  },
}));
vi.mock("../lib/story-top-up-return", () => ({
  storyTopUpReturnStore: () => ({ remember: mocks.remember }),
}));
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.com" }));
vi.mock("@/features/paywall", () => ({ openPaywall: mocks.paywall }));
vi.mock("@/i18n", () => ({ useTranslations: () => mocks.t }));
vi.mock("../api/story-community-access-api", () => ({
  fetchStoryCommunityAccessQuote: mocks.quote,
  purchaseStoryCommunityAccess: mocks.purchase,
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View: Box,
    Text: Box,
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    ActivityIndicator: () => null,
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  };
});

const runtime = {
  gameId: "game",
  buildId: "build",
  localization: { defaultLocale: "en-US" },
} as ExperienceRuntimeManifest;
const requirement = (key: string) =>
  ({ key, title: { "en-US": key }, communityPointPrice: 1 }) as ExperienceAccessRequirement;
const quote = (keys: string[]): StoryCommunityAccessQuote => ({
  requirements: [],
  ownedKeys: keys,
  balance: "10",
  authenticated: true,
});
let access: ExperiencePlayerAccess;
let currentRuntime = runtime;
function Harness() {
  const result = useStoryCommunityAccess(currentRuntime, "en-US", "chapter two");
  useEffect(() => {
    access = result.access;
  }, [result.access]);
  return result.dialog;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  currentRuntime = runtime;
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("ignores an old quote when another access request replaces it", async () => {
  let first!: (value: StoryCommunityAccessQuote) => void;
  let second!: (value: StoryCommunityAccessQuote) => void;
  mocks.quote
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = resolve;
        })
    );
  const firstResult = vi.fn();
  const secondResult = vi.fn();
  await act(async () => {
    void access.requestAccess(requirement("first")).then(firstResult);
  });
  await act(async () => {
    void access.requestAccess(requirement("second")).then(secondResult);
  });
  expect(firstResult).toHaveBeenCalledWith(false);
  await act(async () => first(quote(["first", "second"])));
  expect(secondResult).not.toHaveBeenCalled();
  expect(access.canAccess(requirement("second"))).toBe(false);
  await act(async () => second(quote(["second"])));
  expect(secondResult).toHaveBeenCalledExactlyOnceWith(true);
});

it("rejects pending access on unmount and ignores a late quote", async () => {
  let resolve!: (value: StoryCommunityAccessQuote) => void;
  mocks.quote.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const result = vi.fn();
  await act(async () => {
    void access.requestAccess(requirement("first")).then(result);
  });
  await act(async () => root.render(null));
  expect(result).toHaveBeenCalledExactlyOnceWith(false);
  await act(async () => resolve(quote(["first"])));
  expect(result).toHaveBeenCalledExactlyOnceWith(false);
  expect(access.canAccess(requirement("first"))).toBe(false);
});

vi.mock("@tabler/icons-react-native/IconLock", () => ({ default: () => null }));

async function unlock() {
  await act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "play.communityAccess.unlock"
    );
    expect(button).toBeTruthy();
    button!.click();
  });
}
it("does not let an old purchase unlock a replacement request", async () => {
  mocks.quote.mockResolvedValue(quote([]));
  let purchased!: () => void;
  mocks.purchase.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        purchased = resolve;
      })
  );
  const first = vi.fn(),
    second = vi.fn();
  await act(async () => {
    void access.requestAccess(requirement("first")).then(first);
  });
  await unlock();
  await act(async () => {
    void access.requestAccess(requirement("second")).then(second);
  });
  await act(async () => purchased());
  expect(first).toHaveBeenCalledExactlyOnceWith(false);
  expect(second).not.toHaveBeenCalled();
  expect(access.canAccess(requirement("second"))).toBe(false);
  expect(host.textContent).toContain("second");
});
it("invalidates owned keys immediately when the account changes", async () => {
  mocks.quote.mockResolvedValue(quote(["first"]));
  await act(async () => {
    expect(await access.checkAccess!(requirement("first"))).toBe(true);
  });
  expect(access.canAccess(requirement("first"))).toBe(true);
  mocks.generation += 1;
  expect(access.canAccess(requirement("first"))).toBe(false);
  await act(async () => mocks.listeners.forEach((fn) => fn()));
});
it("rejects account-stale access checks and purchases", async () => {
  mocks.quote.mockResolvedValue(quote([]));
  let purchased!: () => void;
  mocks.purchase.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        purchased = resolve;
      })
  );
  const result = vi.fn();
  await act(async () => {
    void access.requestAccess(requirement("first")).then(result);
  });
  await unlock();
  await act(async () => {
    mocks.generation += 1;
    mocks.listeners.forEach((fn) => fn());
  });
  await act(async () => purchased());
  expect(result).toHaveBeenCalledExactlyOnceWith(false);
  expect(access.canAccess(requirement("first"))).toBe(false);
  let quoted!: (value: StoryCommunityAccessQuote) => void;
  mocks.quote.mockImplementation(
    () =>
      new Promise((resolve) => {
        quoted = resolve;
      })
  );
  let check!: Promise<boolean>;
  await act(async () => {
    check = access.checkAccess!(requirement("first"));
  });
  await act(async () => {
    mocks.generation += 1;
    mocks.listeners.forEach((fn) => fn());
    quoted(quote(["first"]));
  });
  expect(await check).toBe(false);
});

it("rejects late quotes and old access handles when the film build changes", async () => {
  let resolve!: (value: StoryCommunityAccessQuote) => void;
  mocks.quote.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const result = vi.fn();
  const oldAccess = access;
  await act(async () => {
    void access.requestAccess(requirement("first")).then(result);
  });
  currentRuntime = { ...runtime, buildId: "new-build" };
  await act(async () => root.render(<Harness />));
  await act(async () => resolve(quote(["first"])));
  expect(result).toHaveBeenCalledExactlyOnceWith(false);
  expect(access.canAccess(requirement("first"))).toBe(false);
  expect(await oldAccess.requestAccess(requirement("old"))).toBe(false);
});

it("keeps the film and chapter when opening checkout without purchasing access", async () => {
  mocks.quote.mockResolvedValue({ ...quote([]), balance: "0" });
  const resolved = vi.fn();
  await act(async () => {
    void access.requestAccess(requirement("locked")).then(resolved);
  });
  const recharge = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "play.communityAccess.recharge"
  );
  expect(recharge).toBeDefined();
  await act(async () => recharge!.click());
  expect(mocks.remember).toHaveBeenCalledExactlyOnceWith("game", "chapter two");
  expect(mocks.paywall).toHaveBeenCalledExactlyOnceWith({
    category: "community_points",
    communityReturnUrl:
      "https://fizzdragon.com/en-US/play/interactive-film/game?chapter=chapter+two",
  });
  expect(mocks.purchase).not.toHaveBeenCalled();
  expect(resolved).not.toHaveBeenCalled();
});

it("keeps checkout closed and exposes a failed destination save", async () => {
  mocks.quote.mockResolvedValue({ ...quote([]), balance: "0" });
  mocks.remember.mockImplementation(() => {
    throw new Error("Storage full");
  });
  await act(async () => {
    void access.requestAccess(requirement("locked"));
  });
  const recharge = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "play.communityAccess.recharge"
  );
  await act(async () => recharge!.click());
  expect(host.textContent).toContain("Storage full");
  expect(mocks.paywall).not.toHaveBeenCalled();
});

it("does not save or open top-up from a previous account's dialog", async () => {
  mocks.quote.mockResolvedValue({ ...quote([]), balance: "0" });
  await act(async () => {
    void access.requestAccess(requirement("locked"));
  });
  const recharge = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "play.communityAccess.recharge"
  );
  mocks.generation++;
  await act(async () => recharge!.click());
  expect(mocks.remember).not.toHaveBeenCalled();
  expect(mocks.paywall).not.toHaveBeenCalled();
});
