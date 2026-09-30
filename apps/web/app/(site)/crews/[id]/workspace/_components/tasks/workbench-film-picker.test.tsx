import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { WorkbenchFilmPicker } from "./workbench-film-picker";
const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), select: vi.fn() }));
vi.mock("@/app/(site)/crews/_hooks/api", () => ({ crewApi: { get: state.get, post: state.post } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({
  getStudioHref: () => "https://studio.fizzdragon.com/en-US",
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  act(() =>
    root.render(<WorkbenchFilmPicker crewId="crew" disabled={false} onSelect={state.select} />)
  );
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const click = async (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
it("lists every page from the linked workspace and selects a canvas without creating", async () => {
  state.get.mockResolvedValueOnce({ studioWorkspace: { id: "workspace" } }).mockResolvedValueOnce({
    code: 200,
    data: { items: [{ id: "one", title: "Film One" }], nextCursor: "next" },
  });
  await click("chooseFilm");
  state.get.mockResolvedValueOnce({ studioWorkspace: { id: "workspace" } }).mockResolvedValueOnce({
    code: 200,
    data: { items: [{ id: "two", title: "Film Two" }], nextCursor: null },
  });
  await click("loadMoreFilms");
  await click("Film Two");
  expect(state.get.mock.calls[3][0]).toContain("cursor=next");
  expect(state.select).toHaveBeenCalledWith(
    "https://studio.fizzdragon.com/en-US/story-studio/projects/two/canvas"
  );
  expect(state.post).not.toHaveBeenCalled();
});
it("creates in the linked workspace and uses the returned project identity", async () => {
  state.get
    .mockResolvedValueOnce({ studioWorkspace: { id: "workspace" } })
    .mockResolvedValueOnce({ code: 200, data: { items: [], nextCursor: null } });
  await click("chooseFilm");
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "New Film"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state.post.mockResolvedValue({
    code: 200,
    data: { project: { id: "created", title: "New Film" } },
  });
  await act(async () => {
    const b = [...host.querySelectorAll("button")].find((b) => b.textContent === "createFilm")!;
    b.click();
    b.click();
  });
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledWith("/story-projects", {
    body: { workspaceId: "workspace", title: "New Film", defaultLocale: "en-US" },
  });
  expect(host.querySelector("a")?.getAttribute("href")).toContain("/created/canvas");
});
it("does not list or create without a linked workspace", async () => {
  state.get.mockResolvedValue({ studioWorkspace: null });
  await click("chooseFilm");
  expect(host.textContent).toContain("linkWorkspaceFirst");
  expect(host.querySelector("input")).toBeNull();
  expect(state.get).toHaveBeenCalledTimes(1);
});
it("surfaces an application error instead of treating it as an empty list", async () => {
  state.get
    .mockResolvedValueOnce({ studioWorkspace: { id: "workspace" } })
    .mockResolvedValueOnce({ code: 403, msg: "No project access" });
  await click("chooseFilm");
  expect(host.textContent).toContain("No project access");
});
