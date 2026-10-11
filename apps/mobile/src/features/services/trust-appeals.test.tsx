import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrustAppeals } from "./trust-appeals";
import { fetchTrustAppeals, reviewTrustAppeal } from "./trust-appeals-api";
vi.mock("./trust-appeals-api", () => ({ fetchTrustAppeals: vi.fn(), reviewTrustAppeal: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => (
    <textarea value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />
  ),
}));
let node: HTMLDivElement, root: Root;
const appeal = {
  id: "a",
  taskId: "task",
  userId: "u",
  submissionId: "s",
  reason: "Evidence",
  status: "pending" as const,
  reviewReason: null,
  points: -200,
  originalPoints: -200,
  currentCorrectionId: null,
  submittedAt: "2026-10-01",
  deadline: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchTrustAppeals).mockResolvedValue({ items: [appeal], nextCursor: null });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
async function start() {
  await act(async () =>
    root.render(
      <StrictMode>
        <TrustAppeals crewId="crew" userId="user" generation={1} onClose={() => {}} />
      </StrictMode>
    )
  );
}
async function click(text: string) {
  const button = [...node.querySelectorAll("button")].find((b) => b.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("loads under Strict Mode and can refresh after losing queue access", async () => {
  await start();
  expect(node.textContent).toContain("Evidence");
  vi.mocked(fetchTrustAppeals).mockRejectedValueOnce(new Error("Permission revoked"));
  await click("trustAppeals.refresh");
  expect(node.textContent).toContain("Permission revoked");
  expect(node.textContent).not.toContain("Evidence");
  await click("trustAppeals.refresh");
  expect(node.textContent).toContain("Evidence");
});
it("clears review controls after an uncertain write and requires a fresh queue", async () => {
  await start();
  await click("trustAppeals.review");
  const input = node.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Evidence checked"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.mocked(reviewTrustAppeal).mockRejectedValueOnce(new Error("Response lost"));
  await click("trustAppeals.confirm");
  expect(reviewTrustAppeal).toHaveBeenCalledTimes(1);
  expect(node.textContent).toContain("Response lost");
  expect(node.querySelector("textarea")).toBeNull();
  expect(node.textContent).not.toContain("trustAppeals.review");
  await click("trustAppeals.refresh");
  expect(node.textContent).toContain("Evidence");
});
