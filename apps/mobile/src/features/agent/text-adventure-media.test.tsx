import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventureMedia } from "./text-adventure-media";
const h = vi.hoisted(() => ({ active: true }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/features/services/conversation-audio", () => ({
  ConversationAudio: ({ url }: { url: string }) => <span data-audio={url}>audio</span>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Image: ({ source }: { source: { uri: string } }) => <span data-image={source.uri} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("previews authorized HTTPS images and music through existing native controls", async () => {
  await act(async () =>
    root.render(
      <TextAdventureMedia
        stillUrls={["https://cdn.example/still.png"]}
        bgmUrl="https://cdn.example/music.mp3"
      />
    )
  );
  expect(host.querySelector("[data-image]")?.getAttribute("data-image")).toBe(
    "https://cdn.example/still.png"
  );
  expect(host.querySelector("[data-audio]")?.getAttribute("data-audio")).toBe(
    "https://cdn.example/music.mp3"
  );
});
it("does not hand insecure or credential-bearing URLs to native media components", async () => {
  await act(async () =>
    root.render(
      <TextAdventureMedia
        stillUrls={["file:///private/file", "https://user:secret@cdn.example/image"]}
        bgmUrl="http://cdn.example/music.mp3"
      />
    )
  );
  expect(host.querySelector("[data-image]")).toBeNull();
  expect(host.querySelector("[data-audio]")).toBeNull();
  expect(host.textContent).toContain("thread.previewFailed");
});

it("releases the music preview while the editor is backgrounded", async () => {
  const render = () =>
    act(async () =>
      root.render(<TextAdventureMedia stillUrls={[]} bgmUrl="https://cdn.example/music.mp3" />)
    );
  await render();
  expect(host.querySelector("[data-audio]")).not.toBeNull();
  h.active = false;
  await render();
  expect(host.querySelector("[data-audio]")).toBeNull();
  h.active = true;
  await render();
  expect(host.querySelector("[data-audio]")).not.toBeNull();
});
