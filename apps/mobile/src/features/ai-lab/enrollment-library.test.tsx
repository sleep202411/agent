import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { CharacterLibraryPanel } from "./character-library-panel";
const h = vi.hoisted(() => ({
  detail: {
    id: "c",
    workspaceId: "w",
    name: "My likeness",
    description: "",
    kind: "real_person",
    status: "draft",
    createdByUserId: "actor",
    mediaCounts: { image: 0, video: 0, audio: 0 },
    media: [],
  },
  generation: 1,
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ScrollView: ({ children }: any) => <div>{children}</div>,
  TextInput: () => null,
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }), useIsFocused: () => true }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "uuid" } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: async () => [{ id: "w", name: "Personal", isDefault: true, role: "owner" }],
  canCreateStudioProject: () => true,
}));
vi.mock("./character-library-api", () => ({
  loadCharacterLibrary: async () => [h.detail],
  loadLibraryCharacter: async () => h.detail,
  characterLibraryBox: () => ({ read: () => null }),
  prepareLibraryCommand: vi.fn(),
  prepareLikenessCreation: vi.fn(),
  libraryFields: { parse: vi.fn() },
  submitLibraryCommand: vi.fn(),
}));
vi.mock("./project-likeness-consent", () => ({ EnrollmentConsent: () => null }));
vi.mock("./character-media-panel", () => ({
  CharacterMediaPanel: ({ canEdit }: any) => (
    <div data-media>{canEdit ? "editable" : "locked"}</div>
  ),
}));
vi.mock("./enrollment-panel", () => ({
  EnrollmentPanel: ({ onDetail }: any) => (
    <button data-verification onClick={() => onDetail({ ...h.detail, status: "active" })}>
      provider-confirmed
    </button>
  ),
}));
it("removes the verification sibling and unlocks media/editing after completion without duplicate React keys", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"),
    root = createRoot(host),
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const button = (text: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <CharacterLibraryPanel userId="actor" generation={1} />
        </StrictMode>
      )
    );
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent?.startsWith("My likeness ·"))!
        .click()
    );
    await act(async () => button("enrollment.title").click());
    expect(button("characterLibrary.edit").disabled).toBe(true);
    expect(host.querySelector("[data-media]")?.textContent).toBe("locked");
    await act(async () => button("provider-confirmed").click());
    expect(host.querySelector("[data-verification]")).toBeNull();
    expect(host.querySelectorAll("[data-media]")).toHaveLength(1);
    expect(host.querySelector("[data-media]")?.textContent).toBe("editable");
    expect(button("characterLibrary.edit").disabled).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    errors.mockRestore();
  }
});
