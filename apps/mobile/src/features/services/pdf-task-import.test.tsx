import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PdfTaskImport } from "./pdf-task-import";
const h = vi.hoisted(() => ({
  generation: 1,
  load: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
  apply: vi.fn(),
  pick: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
    accessibilityRole: string;
  }) => (
    <button data-role={accessibilityRole} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("./pdf-task-api", () => ({
  loadPdfRecovery: h.load,
  savePdfRecovery: h.save,
  fetchPdfPreview: h.get,
  applyPdfTasks: h.apply,
  pickPdfFile: h.pick,
  analyzePdf: h.analyze,
}));
const id = "11111111-1111-4111-8111-111111111111";
const preview = {
  id,
  status: "ready",
  createdAt: new Date().toISOString(),
  tasks: [0, 1].map((i) => ({
    title: `Task ${i}`,
    description: `Description ${i}`,
    category: "scripts",
    evidence: "Source excerpt",
  })),
  taskIds: [],
};
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <PdfTaskImport
          crewId="crew"
          userId="user"
          generation={1}
          onClose={() => {}}
          onCreated={() => {}}
        />
      </StrictMode>
    )
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.load.mockResolvedValue({ id });
  h.get.mockResolvedValue(preview);
  h.save.mockResolvedValue(undefined);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("restores analysis and freezes the same selection after a lost apply response", async () => {
  h.apply.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({ taskIds: [id] });
  await render();
  await act(async () => button("✓ Task 1").click());
  await act(async () => {
    button("mobileProduction.pdfCreate").click();
    button("mobileProduction.pdfCreate").click();
  });
  expect(h.apply).toHaveBeenCalledTimes(1);
  expect(h.save).toHaveBeenCalledWith("crew", "user", { id, indices: [0] });
  expect(
    [...host.querySelectorAll('button[data-role="checkbox"]')].every(
      (b) => (b as HTMLButtonElement).disabled
    )
  ).toBe(true);
  await act(async () => button("mobileProduction.pdfRetry").click());
  expect(h.apply.mock.calls[1]?.slice(0, 4)).toEqual(h.apply.mock.calls[0]?.slice(0, 4));
  expect(host.textContent).toContain("mobileProduction.pdfCreated");
});
it("restores a previously attempted selection without selecting new tasks", async () => {
  h.load.mockResolvedValue({ id, indices: [1] });
  await render();
  expect(button("Task 0").disabled).toBe(true);
  expect(button("✓ Task 1").disabled).toBe(true);
  await act(async () => button("mobileProduction.pdfRetry").click());
  expect(h.apply.mock.calls[0]?.[2]).toEqual([1]);
});
it("does not mutate after account changes", async () => {
  await render();
  h.generation = 2;
  await act(async () => button("mobileProduction.pdfCreate").click());
  expect(h.apply).not.toHaveBeenCalled();
  expect(h.save).not.toHaveBeenCalled();
});

it("shows actionable analysis failure details instead of discarding the provider reason", async () => {
  h.load.mockResolvedValue({ id });
  h.get.mockResolvedValue({
    ...preview,
    status: "failed",
    tasks: [],
    failure: { code: "provider_limit", message: "AI provider quota exhausted. Contact support." },
  });
  await render();
  expect(host.textContent).toContain("AI provider quota exhausted. Contact support.");
  expect(host.textContent).toContain("mobileProduction.pdfAnalysisId");
});
