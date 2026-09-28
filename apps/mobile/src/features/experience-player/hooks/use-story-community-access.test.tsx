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

const mocks = vi.hoisted(() => ({ quote: vi.fn(), t: (key: string) => key }));
vi.mock("@tabler/icons-react-native", () => ({ IconLock: () => null }));
vi.mock("expo-router", () => ({ useFocusEffect: () => {} }));
vi.mock("@/auth", () => ({
  getAuthSnapshot: () => ({ status: "authenticated" }),
  openAuthSheet: vi.fn(),
}));
vi.mock("@/features/paywall", () => ({ openPaywall: vi.fn() }));
vi.mock("@/i18n", () => ({ useTranslations: () => mocks.t }));
vi.mock("../api/story-community-access-api", () => ({
  fetchStoryCommunityAccessQuote: mocks.quote,
  purchaseStoryCommunityAccess: vi.fn(),
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View: Box,
    Text: Box,
    Pressable: Box,
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
function Harness() {
  const result = useStoryCommunityAccess(runtime, "en-US");
  useEffect(() => {
    access = result.access;
  }, [result.access]);
  return result.dialog;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
