// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CrewSwitcherRail,
  CrewSwitcherRailView,
  shouldShowCrewSwitcherRail,
} from "@/app/(site)/crews/_components/crew-switcher-rail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  query: {
    data: {
      founded: [] as Array<{ id: string; logo: string; name: string }>,
      joined: [] as Array<{ id: string; logo: string; name: string }>,
    },
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useMyCrews: () => state.query,
}));

vi.mock("@/app/(site)/messages/_components/crew-logo", () => ({
  CrewLogo: ({ name }: { name: string }) => <span data-logo={name} />,
}));

vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(<CrewSwitcherRail currentCrew={{ id: "crew_1", logo: "one.png", name: "One" }} />)
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.query = {
    data: {
      founded: [{ id: "crew_1", logo: "one.png", name: "One" }],
      joined: [
        { id: "crew_1", logo: "one.png", name: "One" },
        { id: "crew_2", logo: "two.png", name: "Two" },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("crew switcher rail", () => {
  it("hides after a successful empty membership response", () => {
    expect(shouldShowCrewSwitcherRail({ crewCount: 0, isPending: false, isError: false })).toBe(
      false
    );
    expect(shouldShowCrewSwitcherRail({ crewCount: 1, isPending: false, isError: false })).toBe(
      true
    );
    expect(shouldShowCrewSwitcherRail({ crewCount: 0, isPending: true, isError: false })).toBe(
      true
    );
    expect(shouldShowCrewSwitcherRail({ crewCount: 0, isPending: false, isError: true })).toBe(
      true
    );
  });

  it("deduplicates memberships and links every crew to its workspace", () => {
    render();

    expect(document.querySelectorAll("[data-logo]")).toHaveLength(2);
    expect(document.querySelector('a[href="/zh-CN/crews/crew_1/workspace"]')).not.toBeNull();
    expect(document.querySelector('a[href="/zh-CN/crews/crew_2/workspace"]')).not.toBeNull();
    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/zh-CN/crews/crew_1/workspace"
    );
  });

  it("uses the same rail for Crew Hall with the all-crews entry active", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <CrewSwitcherRailView
          crews={state.query.data.founded}
          allCrewsActive
          rootLabel="My Crews"
          className="flex"
        />
      )
    );

    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/zh-CN/crews"
    );
    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("aria-label")).toBe(
      "My Crews"
    );
    expect(document.querySelector('a[href="/zh-CN/crews/crew_1/workspace"]')).not.toBeNull();
  });
});
