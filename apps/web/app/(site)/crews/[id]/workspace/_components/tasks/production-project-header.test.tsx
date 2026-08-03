// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CrewProductionOverviewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { ProductionProjectHeader } from "./production-project-header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  updateCrew: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", async () => {
  const actual = await vi.importActual<object>("@/app/(site)/crews/_hooks/use-crew");
  return {
    ...actual,
    useUpdateCrew: () => ({ mutateAsync: state.updateCrew, isPending: false }),
    useUpdateCrewProductionProject: () => ({
      mutateAsync: state.updateProject,
      isPending: false,
    }),
    useCrewStudioProjectOptions: () => ({ data: undefined, isLoading: false, isError: false }),
    useLinkCrewStudioProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateCrewProductionResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteCrewProductionResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock("@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets", () => ({
  useCrewAssets: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock("@/app/(site)/messages/_components/crew-logo", () => ({
  CrewLogo: () => <div data-testid="crew-logo" />,
}));
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
}));

const overview: CrewProductionOverviewDTO = {
  capabilities: { manage: true },
  studioProject: null,
  project: {
    crewId: "crew-1",
    status: "backlog",
    priority: null,
    leadMemberId: null,
    startDate: null,
    startDateGranularity: "day",
    targetDate: null,
    targetDateGranularity: "day",
    version: 2,
    updatedByUserId: "user-1",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  labels: [],
  labelOptions: [],
  resources: [],
  latestUpdate: null,
  page: {
    crewId: "crew-1",
    document: { type: "doc", content: [{ type: "paragraph" }] },
    version: 1,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHeader(canEditCrewInfo = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ProductionProjectHeader
        crewId="crew-1"
        crewName="Original crew"
        crewSummary="Original summary"
        crewLogo="logo.jpg"
        crewVersion={7}
        canEditCrewInfo={canEditCrewInfo}
        members={[]}
        displays={new Map()}
        overview={overview}
        saveState="saved"
        onReload={() => undefined}
        onWriteUpdate={() => undefined}
      />
    )
  );
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  state.updateCrew.mockReset();
  state.updateProject.mockReset();
  state.updateCrew.mockResolvedValue(undefined);
  state.updateProject.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ProductionProjectHeader project identity", () => {
  it("saves a renamed crew in place with optimistic concurrency", async () => {
    renderHeader();
    const input = container!.querySelector<HTMLInputElement>(
      'input[aria-label="projectInfo.nameLabel"]'
    )!;

    await act(async () => {
      input.focus();
      changeInput(input, "Renamed crew");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(state.updateCrew).toHaveBeenCalledWith({
      id: "crew-1",
      expectedVersion: 7,
      name: "Renamed crew",
    });
  });

  it("restores the previous value when editing is cancelled", async () => {
    renderHeader();
    const input = container!.querySelector<HTMLInputElement>(
      'input[aria-label="projectInfo.nameLabel"]'
    )!;

    await act(async () => {
      input.focus();
      changeInput(input, "Cancelled name");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });

    expect(input.value).toBe("Original crew");
    expect(state.updateCrew).not.toHaveBeenCalled();
  });

  it("keeps project identity read-only without crew settings permission", () => {
    renderHeader(false);

    expect(
      container!.querySelector<HTMLInputElement>('input[aria-label="projectInfo.nameLabel"]')
        ?.readOnly
    ).toBe(true);
    expect(
      container!.querySelector<HTMLInputElement>('input[aria-label="projectInfo.summaryLabel"]')
        ?.readOnly
    ).toBe(true);
  });
});
