import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskContractField } from "./task-contract-field";
vi.mock("@/features/crew-assets/file-upload", () => ({
  AssetFileUpload: (props: any) => {
    h.upload = props;
    return <span>Upload</span>;
  },
}));
const h = vi.hoisted(() => ({ generation: 1, picker: undefined as any, upload: undefined as any }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./task-contract", () => ({
  TaskContract: ({ assetId }: { assetId: string }) => <span>Contract {assetId}</span>,
}));
vi.mock("@/features/crew-assets/asset-picker", () => ({
  CrewAssetPicker: (props: any) => {
    h.picker = props;
    return <span>Picker</span>;
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
function Harness({ locked = false }: { locked?: boolean }) {
  const [value, setValue] = useState<string | null>("old");
  return (
    <TaskContractField
      crewId="crew"
      userId="owner"
      generation={1}
      value={value}
      onChange={setValue}
      locked={locked}
    />
  );
}
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
beforeEach(() => {
  h.generation = 1;
  h.picker = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("limits selection to one file and supports replacement and removal", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => button("taskContract.choose").click());
  expect(h.picker).toMatchObject({ crewId: "crew", remaining: 1, excludedIds: ["old"] });
  await act(async () =>
    h.picker.onSelect([{ id: "new", kind: "file", status: "active", media: { id: "media" } }])
  );
  expect(host.textContent).toContain("Contract new");
  expect(host.textContent).not.toContain("Picker");
  await act(async () => button("taskContract.remove").click());
  expect(host.textContent).not.toContain("Contract new");
});
it("ignores folders, deleted files, missing media and stale account callbacks", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => button("taskContract.choose").click());
  for (const asset of [
    { kind: "folder", status: "active", media: {} },
    { kind: "file", status: "deleted", media: {} },
    { kind: "file", status: "active", media: null },
  ])
    await act(async () => h.picker.onSelect([{ id: "bad", ...asset }]));
  expect(host.textContent).toContain("Contract old");
  h.generation = 2;
  await act(async () =>
    h.picker.onSelect([{ id: "new", kind: "file", status: "active", media: {} }])
  );
  expect(host.textContent).toContain("Contract old");
});
it("disables selection and removal while saving", async () => {
  await act(async () => root.render(<Harness locked />));
  expect(button("taskContract.choose").disabled).toBe(true);
  expect(button("taskContract.remove").disabled).toBe(true);
});

it("attaches a newly uploaded contract and ignores completion after the dialog closes", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => button("thread.uploadFile").click());
  const upload = h.upload;
  expect(upload).toMatchObject({ crewId: "crew", userId: "owner", parentId: null });
  await act(async () =>
    upload.onAttached({ id: "uploaded", kind: "file", status: "active", media: { id: "media" } })
  );
  expect(host.textContent).toContain("Contract uploaded");
  await act(async () => upload.onClose());
  await act(async () =>
    upload.onAttached({ id: "late", kind: "file", status: "active", media: { id: "media" } })
  );
  expect(host.textContent).toContain("Contract uploaded");
});
