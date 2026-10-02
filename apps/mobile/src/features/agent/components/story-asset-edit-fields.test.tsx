import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryAssetEditFields } from "./story-asset-edit-fields";
import { Alert } from "react-native";
import type { StoryAssetSpec } from "../api/story-production-api";
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000009" },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Alert: { alert: vi.fn() },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
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
    <input
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asset = {
  id: id(1),
  version: 2,
  name: "Asset",
  imagePrompt: "Prompt",
  description: null,
  selectedMediaVersion: { id: id(2) },
  mediaVersions: [{ id: id(2), versionNumber: 1 }],
} as StoryAssetSpec;
const submit = vi.fn();
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = async (locked = false) => {
  await act(async () =>
    root.render(<StoryAssetEditFields asset={asset} locked={locked} submit={submit} />)
  );
};
const click = async (label: string) => {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
};
it("saves versioned fields", async () => {
  await render();
  await click("assetEdit.save");
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "patch",
      assetId: id(1),
      input: { expectedVersion: 2, name: "Asset", description: null, imagePrompt: "Prompt" },
    })
  );
});
it("selects existing media with current field values", async () => {
  await render();
  await click("✓ assetEdit.select 1");
  expect(submit.mock.calls[0][0].input.selectedMediaVersionId).toBe(id(2));
});
it("can clear a selection", async () => {
  await render();
  await click("assetEdit.clearSelection");
  expect(submit.mock.calls[0][0].input.selectedMediaVersionId).toBeNull();
});
it("requires archive confirmation", async () => {
  await render();
  await click("assetEdit.archive");
  expect(submit).not.toHaveBeenCalled();
  const buttons = vi.mocked(Alert.alert).mock.calls[0][2]!;
  await act(async () => buttons[1].onPress!());
  expect(submit.mock.calls[0][0]).toMatchObject({
    action: "archive",
    input: { expectedVersion: 2 },
  });
});
it("blocks all edits while recovery is pending or permission is absent", async () => {
  await render(true);
  await click("assetEdit.save");
  await click("assetEdit.archive");
  expect(submit).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect([...host.querySelectorAll("input")].every((i) => i.disabled)).toBe(true);
});
