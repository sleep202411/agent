import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, beforeEach } from "vitest";
import CrewDetail from "@/app/crew/[id]";
vi.mock("@/lib/api-client", () => ({ ApiRequestError: class extends Error {} }));
const h = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  gate: vi.fn(),
  alert: vi.fn(),
  application: undefined as any,
  header: undefined as any,
  generation: 1,
  active: true,
  status: "authenticated",
  t: (key: string) => key,
}));
vi.mock("@/data/browse-service", () => ({ getCrewById: h.read, applyToCrewPosition: h.apply }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "crew" }),
  useRouter: () => ({}),
  Stack: {
    Screen: ({ options }: any) => {
      h.header = options.headerRight;
      return null;
    },
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.status }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
beforeEach(() => {
  h.read.mockReset();
  h.apply.mockReset();
  h.alert.mockReset();
  h.gate.mockReset().mockImplementation(({ onAuthenticated }) => onAuthenticated());
  h.active = true;
  h.status = "authenticated";
  h.generation = 1;
});
vi.mock("@/features/browse/use-crew-application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-crew-application")>();
  return {
    useCrewApplication: (id: string) => {
      h.application = actual.useCrewApplication(id);
      return h.application;
    },
  };
});
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
  Alert: { alert: h.alert },
  Modal: ({ visible, children }: any) => (visible ? <div data-modal>{children}</div> : null),
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

const crew = (name: string) => ({
  id: "crew",
  name,
  description: "Crew details",
  status: "closed",
  roles: [],
  members: [],
});
it("refreshes recruitment on return and ignores the old read even if its transport ignores abort", async () => {
  let resolveOld!: (value: unknown) => void;
  h.read
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    )
    .mockResolvedValueOnce(crew("Updated Crew"));
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<CrewDetail />));
    const oldSignal = h.read.mock.calls[0][1];
    h.active = false;
    await act(async () => root.render(<CrewDetail />));
    expect(oldSignal.aborted).toBe(true);
    expect(host.textContent).toBe("");
    await act(async () => resolveOld(crew("Old Crew")));
    h.active = true;
    await act(async () => root.render(<CrewDetail />));
    expect(host.textContent).toContain("Updated Crew");
    expect(host.textContent).not.toContain("Old Crew");
    expect(h.read).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
it("waits for authentication hydration and removes previous-account content during the next read", async () => {
  h.status = "hydrating";
  h.read.mockResolvedValueOnce(crew("Account One Crew")).mockReturnValueOnce(new Promise(() => {}));
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<CrewDetail />));
    expect(h.read).not.toHaveBeenCalled();
    h.status = "authenticated";
    await act(async () => root.render(<CrewDetail />));
    expect(host.textContent).toContain("Account One Crew");
    expect(h.header()).not.toBeNull();
    h.generation++;
    await act(async () => root.render(<CrewDetail />));
    expect(host.textContent).not.toContain("Account One Crew");
    expect(host.textContent).toBe("loading");
    expect(h.header()).toBeNull();
    expect(h.read.mock.calls[0][1].aborted).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a pending application serialized while recruitment is refreshed on return", async () => {
  let finish!: () => void;
  h.apply.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  h.read.mockResolvedValue(crew("Film Crew"));
  const host = document.createElement("div"),
    root = createRoot(host),
    success = vi.fn();
  let pending!: Promise<void>;
  try {
    await act(async () => root.render(<CrewDetail />));
    await act(async () => {
      pending = h.application.submit("position", success, vi.fn());
    });
    expect(h.application.applying).toBe(true);
    h.active = false;
    await act(async () => root.render(<CrewDetail />));
    h.active = true;
    await act(async () => root.render(<CrewDetail />));
    expect(h.application.applying).toBe(true);
    await act(async () => h.application.submit("position", success, vi.fn()));
    expect(h.apply).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await pending;
    });
    expect(success).toHaveBeenCalledTimes(1);
    expect(h.application.applying).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it("offers every opening and submits the selected one beyond Android's alert limit", async () => {
  h.read.mockResolvedValue({
    ...crew("Film Crew"),
    roles: Array.from({ length: 8 }, (_, i) => ({ id: `role${i}`, title: `Role ${i}`, count: 1 })),
  });
  h.apply.mockResolvedValue(undefined);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<CrewDetail />));
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "crewDetail.applyButton")!
        .click()
    );
    const modal = host.querySelector("[data-modal]")!;
    expect(modal.querySelectorAll("button").length).toBeGreaterThanOrEqual(9);
    await act(async () =>
      [...modal.querySelectorAll("button")].find((b) => b.textContent === "Role 7")!.click()
    );
    expect(h.apply).toHaveBeenCalledExactlyOnceWith("crew", "role7");
    expect(host.querySelector("[data-modal]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
it("uses refreshed openings after login and allows cancelling without an application", async () => {
  let resume!: () => void;
  h.gate.mockImplementation(({ onAuthenticated }) => {
    resume = onAuthenticated;
  });
  h.read
    .mockResolvedValueOnce({ ...crew("Crew"), roles: [{ id: "old", title: "Old job", count: 1 }] })
    .mockResolvedValueOnce({ ...crew("Crew"), roles: [{ id: "new", title: "New job", count: 1 }] });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<CrewDetail />));
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "crewDetail.applyButton")!
        .click()
    );
    h.generation++;
    await act(async () => {
      root.render(<CrewDetail />);
      resume();
    });
    const modal = host.querySelector("[data-modal]")!;
    expect(modal.textContent).toContain("New job");
    expect(modal.textContent).not.toContain("Old job");
    await act(async () =>
      [...modal.querySelectorAll("button")].find((b) => b.textContent === "report.cancel")!.click()
    );
    expect(h.apply).not.toHaveBeenCalled();
    expect(host.querySelector("[data-modal]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
