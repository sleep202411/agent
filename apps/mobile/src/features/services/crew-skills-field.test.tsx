import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewSkillsField } from "./crew-skills-field";
const h = vi.hoisted(() => ({ fetch: vi.fn(), generation: 1 }));
vi.mock("./crew-skills-api", () => ({ fetchCrewSkills: h.fetch }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
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
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
    accessibilityLabel: string;
    accessibilityRole: string;
    accessibilityState?: { checked?: boolean };
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-checked={accessibilityState?.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
function Harness({ initial = [], locked = false }: { initial?: string[]; locked?: boolean }) {
  const [value, setValue] = useState(initial);
  return <CrewSkillsField value={value} onChange={setValue} locked={locked} generation={1} />;
}
const control = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue(["Editing", "Lighting"]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("loads only on expansion, retains removed catalog skills, and changes selections", async () => {
  await act(async () => root.render(<Harness initial={["Legacy"]} />));
  expect(h.fetch).not.toHaveBeenCalled();
  await act(async () => control("crewSkills.label").click());
  expect(control("Legacy").getAttribute("aria-checked")).toBe("true");
  await act(async () => control("Editing").click());
  expect(control("Editing").getAttribute("aria-checked")).toBe("true");
  await act(async () => control("Legacy").click());
  expect(control("Legacy")).toBeNull();
});
it("surfaces failure, preserves selected skills and retries explicitly", async () => {
  h.fetch.mockRejectedValueOnce(Error("Catalog unavailable"));
  await act(async () => root.render(<Harness initial={["Legacy"]} />));
  await act(async () => control("crewSkills.label").click());
  expect(host.textContent).toContain("Catalog unavailable");
  expect(control("Legacy").disabled).toBe(false);
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "crewSkills.retry")!
      .click()
  );
  expect(h.fetch).toHaveBeenCalledTimes(2);
  expect(control("Editing").disabled).toBe(false);
});
it("limits selections to twenty while allowing removal", async () => {
  await act(async () =>
    root.render(<Harness initial={Array.from({ length: 20 }, (_, n) => "Skill" + n)} />)
  );
  await act(async () => control("crewSkills.label").click());
  expect(control("Editing").disabled).toBe(true);
  await act(async () => control("Skill0").click());
  expect(control("Editing").disabled).toBe(false);
});
it("ignores catalog completion after account changes", async () => {
  let resolve!: (v: string[]) => void;
  h.fetch.mockImplementation(() => new Promise((r) => (resolve = r)));
  await act(async () => root.render(<Harness />));
  await act(async () => control("crewSkills.label").click());
  h.generation = 2;
  await act(async () => resolve(["Editing"]));
  expect(control("Editing")).toBeNull();
});

it("keeps FD role selection separate from Editor certification", async () => {
  h.fetch.mockResolvedValue(["FD-I", "FD-II", "Editor"]);
  await act(async () => root.render(<Harness />));
  await act(async () => control("crewSkills.label").click());
  await act(async () => control("certificationGuide.fd1Name").click());
  expect(control("certificationGuide.fd1Name").getAttribute("aria-checked")).toBe("true");
  expect(control("certificationGuide.editorName").getAttribute("aria-checked")).toBe("false");
  expect(host.textContent).toContain("FD-I");
});
