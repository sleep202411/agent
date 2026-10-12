import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { StoryAssetMediaVersions } from "./story-asset-media-versions";
import type { StoryAssetSpec } from "../api/story-production-api";
vi.mock("./story-asset-candidate-picker", () => ({
  AssetCandidatePicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect("00000000-0000-4000-8000-000000000005")}>candidate</button>
  ),
}));
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
  kind: "character",
  selectedMediaVersion: { id: id(2) },
  mediaVersions: [
    { id: id(2), versionNumber: 1, purpose: "primary" },
    { id: id(3), versionNumber: 4, purpose: "turnaround" },
    { id: id(4), versionNumber: 3, purpose: "primary" },
    { id: id(5), versionNumber: 2, purpose: "turnaround" },
  ],
} as StoryAssetSpec;
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
it("sorts primary choices newest first without allowing references as the primary image", async () => {
  const select = vi.fn();
  const original = [...asset.mediaVersions];
  await act(async () => root.render(<StoryAssetMediaVersions asset={asset} onSelect={select} />));
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual([
    "assetEdit.select 3",
    "✓ assetEdit.select 1",
    "assetEdit.clearSelection",
  ]);
  await act(async () => buttons[0].click());
  expect(select).toHaveBeenCalledWith(id(4));
  expect(host.textContent).toContain("✓ assetEdit.version 4");
  expect(host.textContent).toContain("assetEdit.latestTurnaround");
  expect(asset.mediaVersions).toEqual(original);
});
it("shows both histories without write actions for read-only viewers", async () => {
  await act(async () => root.render(<StoryAssetMediaVersions asset={asset} />));
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("assetEdit.primaryVersions");
  expect(host.textContent).toContain("assetEdit.turnaroundVersions");
  expect(host.textContent).toContain("✓ assetEdit.version 1");
});
it("blocks selection and clearing during an unresolved mutation", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(<StoryAssetMediaVersions asset={asset} onSelect={select} locked />)
  );
  for (const button of host.querySelectorAll("button")) {
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
  }
  expect(select).not.toHaveBeenCalled();
});
it("keeps unclassified official primary versions available", async () => {
  await act(async () =>
    root.render(
      <StoryAssetMediaVersions
        asset={{
          ...asset,
          kind: "prop",
          mediaVersions: [{ ...asset.mediaVersions[0], purpose: undefined }],
        }}
      />
    )
  );
  expect(host.textContent).toContain("✓ assetEdit.version 1");
  expect(host.textContent).not.toContain("assetEdit.turnaroundVersions");
});

it("saves the media asset identity, not the version id, only for ready reusable media", async () => {
  const save = vi.fn();
  const source = {
    ...asset,
    mediaVersions: [
      { ...asset.mediaVersions[0], mediaAssetId: id(8), mediaKind: "image", mediaStatus: "ready" },
      {
        ...asset.mediaVersions[1],
        mediaAssetId: id(9),
        mediaKind: "image",
        mediaStatus: "uploading",
      },
    ],
  };
  await act(async () =>
    root.render(<StoryAssetMediaVersions asset={source} onSaveCandidate={save} />)
  );
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons).toHaveLength(1);
  await act(async () => buttons[0].click());
  expect(save).toHaveBeenCalledWith(id(8));
  await act(async () =>
    root.render(<StoryAssetMediaVersions asset={source} onSaveCandidate={save} locked />)
  );
  expect(host.querySelector("button")?.disabled).toBe(true);
});
