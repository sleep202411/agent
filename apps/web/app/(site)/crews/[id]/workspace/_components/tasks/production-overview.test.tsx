// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CrewProductionDocument,
  CrewProductionOverviewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { ProductionOverview } from "./production-overview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nextDocument: CrewProductionDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
};

const state = vi.hoisted(() => ({
  overview: null as CrewProductionOverviewDTO | null,
  error: null as Error | null,
  save: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", async () => {
  const actual = await vi.importActual<object>("@/app/(site)/crews/_hooks/use-crew");
  return {
    ...actual,
    useCrewProductionOverview: () => ({
      data: state.overview,
      isLoading: false,
      isError: !!state.error,
      error: state.error,
      refetch: state.refetch,
    }),
    useSaveCrewProductionDocument: () => ({ mutateAsync: state.save }),
  };
});
vi.mock("@/components/tiptap-templates/notion-like/notion-like-editor", () => ({
  NotionEditor: (props: {
    editable: boolean;
    onUpdate: (document: CrewProductionDocument) => void;
    onBlur: () => void;
  }) => (
    <div data-testid="editor" data-editable={String(props.editable)}>
      <button type="button" data-testid="update" onClick={() => props.onUpdate(nextDocument)}>
        update
      </button>
      <button type="button" data-testid="blur" onClick={props.onBlur}>
        blur
      </button>
    </div>
  ),
}));
vi.mock("./production-project-header", () => ({
  ProductionProjectHeader: (props: { saveState: string; onReload: () => void }) => (
    <button data-testid="project-header" data-save-state={props.saveState} onClick={props.onReload}>
      reload
    </button>
  ),
}));

const initialDocument: CrewProductionDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function overview(manage = true): CrewProductionOverviewDTO {
  return {
    capabilities: { manage },
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
      version: 1,
      updatedByUserId: "user-1",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    labels: [],
    labelOptions: [],
    resources: [],
    latestUpdate: null,
    page: {
      crewId: "crew-1",
      document: initialDocument,
      version: 3,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderOverview() {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() =>
    root!.render(
      <ProductionOverview
        crewId="crew-1"
        crewName="StoryOS"
        crewSummary="Production context"
        crewLogo=""
        crewVersion={2}
        canEditCrewInfo
        members={[]}
        displays={new Map()}
        onWriteUpdate={() => undefined}
      />
    )
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  state.overview = overview();
  state.error = null;
  state.save.mockReset();
  state.refetch.mockReset();
  state.save.mockResolvedValue({ ...overview().page, document: nextDocument, version: 4 });
  state.refetch.mockResolvedValue({ data: overview() });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("ProductionOverview", () => {
  it("retains the failed-save editor and draft across background read failures", async () => {
    state.save.mockRejectedValue(new Error("Save offline"));
    renderOverview();
    const editor = container!.querySelector('[data-testid="editor"]');
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="update"]')!.click();
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(
      container!.querySelector('[data-testid="project-header"]')?.getAttribute("data-save-state")
    ).toBe("error");
    state.error = new Error("Refresh offline");
    renderOverview();
    expect(container!.querySelector('[data-testid="editor"]')).toBe(editor);
    expect(container!.textContent).toContain("Refresh offline");
    state.error = null;
    renderOverview();
    expect(container!.querySelector('[data-testid="editor"]')).toBe(editor);
    expect(
      container!.querySelector('[data-testid="project-header"]')?.getAttribute("data-save-state")
    ).toBe("error");
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("does not mark an unsaved draft saved when reload returns cached data with an error", async () => {
    state.save.mockRejectedValue(new Error("Save offline"));
    state.refetch.mockResolvedValue({ data: overview(), isError: true });
    renderOverview();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="update"]')!.click();
      await vi.advanceTimersByTimeAsync(450);
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="project-header"]')!.click();
    });
    expect(
      container!.querySelector('[data-testid="project-header"]')?.getAttribute("data-save-state")
    ).toBe("error");
  });

  it("persists editor updates after the debounce with optimistic versioning", async () => {
    renderOverview();

    act(() => {
      container!.querySelector<HTMLButtonElement>('[data-testid="update"]')!.click();
    });
    expect(state.save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(state.save).toHaveBeenCalledWith({
      expectedVersion: 3,
      document: nextDocument,
    });
  });

  it("flushes a pending edit when the editor loses focus", async () => {
    renderOverview();

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="update"]')!.click();
      container!.querySelector<HTMLButtonElement>('[data-testid="blur"]')!.click();
      await Promise.resolve();
    });

    expect(state.save).toHaveBeenCalledWith({
      expectedVersion: 3,
      document: nextDocument,
    });
  });

  it("uses the server capability as the editor's only editability source", () => {
    state.overview = overview(false);
    renderOverview();

    expect(container!.querySelector('[data-testid="editor"]')?.getAttribute("data-editable")).toBe(
      "false"
    );
  });
});
