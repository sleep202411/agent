import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CertificationGuide } from "./certification-guide";
import { certificationEntry, certificationGroup } from "./certification-guide-data";
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ onPress, children }: { onPress(): void; children: ReactNode }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
it("expands the approved fifteen certification explanations and can collapse them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CertificationGuide />));
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("certificationGuide.partner");
    expect(host.textContent).toContain("certificationGuide.director");
    expect(host.textContent).toContain("certificationGuide.skill");
    expect(host.textContent?.match(/Description/g)).toHaveLength(15);
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).not.toContain("Description");
  } finally {
    await act(async () => root.unmount());
  }
});
it("preserves qualification identity while grouping Instructor and FD levels", () => {
  expect(certificationGroup("Instructor")).toBe("partner");
  expect(certificationEntry("FD-II · Junior Creator")).toBe("fd2");
  expect(certificationEntry("Writer")).toBe("writer");
  expect(certificationGroup("Regional qualification")).toBe("other");
});
