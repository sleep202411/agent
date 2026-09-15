import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ user: "a", projectId: "p", dict: vi.fn(), submit: vi.fn() }));
const translate = (key: string) => key;
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => translate }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/store", () => ({
  useAppSelector: (selector: (state: object) => unknown) =>
    selector({ project: { currentProjectId: s.projectId }, assistant: { projects: {} } }),
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  selectCurrentInstance: () => ({ detail: null }),
}));
vi.mock("@/src/lib/project-dictionaries", () => ({ fetchProjectDictionaries: s.dict }));
vi.mock("@/src/lib/uploads/workspace-upload", () => ({ buildOssUrl: (value: string) => value }));
import {
  ProjectParamsForm,
  isProjectParamsComplete,
  type ProjectParamsSuggestion,
} from "./project-params-form";
let root: Root;
let node: HTMLDivElement;
const defaults = {
  aspectRatioType: "wide",
  stylePainting: "style",
  chapterLength: 5,
  targetEpisodeCount: 3,
};
const dictionary = {
  typeOptions: [],
  sizeOptions: [{ value: "wide", label: "16:9" }],
  styleOptions: [{ id: "style", info: "Style" }],
};
async function render(suggested: ProjectParamsSuggestion = defaults) {
  await act(async () =>
    root.render(<ProjectParamsForm suggested={suggested} onSubmitted={s.submit} />)
  );
}
const button = (text: string) =>
  [...node.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.projectId = "p";
  s.dict.mockReset().mockResolvedValue(dictionary);
  s.submit.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("blocks suggested-value submission after configuration failure and recovers on remount", async () => {
  s.dict.mockRejectedValueOnce(new Error("Unavailable"));
  await render();
  expect(button("paramsFormSubmit").disabled).toBe(true);
  await act(async () => root.render(null));
  await render();
  expect(button("paramsFormSubmit").disabled).toBe(false);
  await act(async () => button("paramsFormSubmit").click());
  expect(s.submit).toHaveBeenCalledWith(expect.objectContaining(defaults));
});
it.each(["account", "project"])(
  "cancels reads and resets drafts after changing %s",
  async (change) => {
    let reject!: (error: Error) => void;
    s.dict.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    await render();
    const signal = s.dict.mock.calls[0][0] as AbortSignal;
    if (change === "account") s.user = "b";
    else s.projectId = "q";
    await render({ ...defaults, chapterLength: 8 });
    expect(signal.aborted).toBe(true);
    await act(async () => reject(new Error("Old failure")));
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(node.querySelector<HTMLInputElement>("input")?.value).toBe("8");
  }
);
it.each([
  { targetEpisodeCount: 2.5 },
  { chapterLength: Infinity },
  { chapterLength: 1.5 },
  { stylePainting: "removed" },
  { aspectRatioType: "removed" },
])("rejects invalid suggested parameters %j", async (invalid) => {
  await render({ ...defaults, ...invalid });
  expect(button("paramsFormSubmit").disabled).toBe(true);
});

it("does not auto-confirm corrupt persisted values or invalid episode counts", () => {
  const detail = { aspectRatioType: "wide", stylePainting: "style", chapterLength: 5 };
  type Detail = Parameters<typeof isProjectParamsComplete>[0];
  for (const chapterLength of [NaN, Infinity, -Infinity, 0])
    expect(isProjectParamsComplete({ ...detail, chapterLength } as Detail, 3)).toBe(false);
  for (const episodes of [NaN, Infinity, 1, 2.5, 41])
    expect(isProjectParamsComplete(detail as Detail, episodes)).toBe(false);
  expect(isProjectParamsComplete({ ...detail, stylePainting: " " } as Detail, 3)).toBe(false);
  expect(isProjectParamsComplete(detail as Detail, 2)).toBe(true);
  expect(isProjectParamsComplete(detail as Detail, 40)).toBe(true);
});
