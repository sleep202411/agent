import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import CrewDetail from "@/app/crew/[id]";
vi.mock("@/lib/api-client", () => ({ ApiRequestError: class extends Error {} }));
const h = vi.hoisted(() => ({ read: vi.fn(), t: (key: string) => key }));
vi.mock("@/data/browse-service", () => ({ getCrewById: h.read }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "crew" }),
  useRouter: () => ({}),
  Stack: { Screen: () => null },
}));
vi.mock("@/auth", () => ({ useAuthGate: () => ({}) }));
vi.mock("@/features/browse/use-crew-application", () => ({ useCrewApplication: () => ({}) }));
vi.mock("@/features/services/crew-linked-resources", () => ({ CrewLinkedResources: () => null }));
vi.mock("@/components/report-actions", () => ({
  MoreActionsButton: () => null,
  ReportReasonSheet: () => null,
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui", () => ({
  EmptyState: ({ title, detail }: any) => (
    <div>
      {title}
      {detail}
    </div>
  ),
  PosterImage: () => null,
  SectionHeader: () => null,
  Tag: () => null,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (options: any) => options.web ?? options.default },
  StyleSheet: { create: (x: any) => x },
  View: ({ children }: any) => <div>{children}</div>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
  ActivityIndicator: () => <span>loading</span>,
}));
it("shows upstream errors, retries without false not-found, and aborts obsolete reads", async () => {
  h.read.mockRejectedValueOnce(new Error("Openings offline")).mockResolvedValueOnce(undefined);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<CrewDetail />));
    expect(host.textContent).toContain("Openings offline");
    expect(host.textContent).not.toContain("crewDetail.notFoundTitle");
    const firstSignal = h.read.mock.calls[0][1] as AbortSignal;
    await act(async () => host.querySelector("button")!.click());
    expect(firstSignal.aborted).toBe(true);
    expect(host.textContent).toContain("crewDetail.notFoundTitle");
    expect(host.textContent).not.toContain("Openings offline");
  } finally {
    await act(async () => root.unmount());
  }
  expect(h.read.mock.calls[1][1].aborted).toBe(true);
});
