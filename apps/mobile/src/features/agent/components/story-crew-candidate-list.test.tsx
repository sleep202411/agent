import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewCandidateList } from "./story-crew-candidate-list";
const h = vi.hoisted(() => ({ load: vi.fn(), add: vi.fn(), preview: vi.fn() }));
vi.mock("../api/story-crew-candidates", () => ({ loadStoryCrewCandidates: h.load }));
vi.mock("@/features/services/conversation-file", () => ({
  ConversationFile: (props: unknown) => {
    h.preview(props);
    return <span>Authorized preview</span>;
  },
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const kinds = ["image", "video", "audio"];
beforeEach(() => {
  vi.resetAllMocks();
  h.load.mockResolvedValue({
    crew: { id: "crew", name: "Crew" },
    items: kinds.map((kind) => ({
      id: `node-${kind}`,
      name: `Shared ${kind}`,
      media: {
        id: `media-${kind}`,
        kind,
        contentType: `${kind}/fixture`,
        previewUrl: "untrusted-list-url",
      },
    })),
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const render = async (filter: "all" | "visual" | "image", savedIds: string[] = []) => {
  await act(async () =>
    root.render(
      <CrewCandidateList
        scope={{ projectId: "project", generation: 1 }}
        savedIds={savedIds}
        filter={filter}
        disabled={false}
        add={h.add}
      />
    )
  );
};
it("previews by authorized media identity rather than using list URLs", async () => {
  await render("all");
  expect(h.preview).toHaveBeenCalledTimes(3);
  for (const kind of kinds)
    expect(h.preview).toHaveBeenCalledWith({
      mediaAssetId: `media-${kind}`,
      name: `Shared ${kind}`,
      mediaKind: kind,
      contentType: `${kind}/fixture`,
    });
  expect(host.textContent).not.toContain("untrusted-list-url");
  expect(h.add).not.toHaveBeenCalled();
});
it.each(["visual", "image"] as const)("mounts previews only for the %s slot", async (filter) => {
  await render(filter);
  expect(h.preview.mock.calls.map(([props]) => props.mediaKind)).toEqual(
    filter === "visual" ? ["image", "video"] : ["image"]
  );
});
it("keeps previews available for already saved media without offering duplicate import", async () => {
  await render("image", ["media-image"]);
  expect(h.preview).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("storyCandidates.saved");
  expect(
    [...host.querySelectorAll("button")].some(
      (button) => button.textContent === "storyCandidates.save"
    )
  ).toBe(false);
});
