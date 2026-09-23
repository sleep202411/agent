// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionActivityComposer } from "./production-project-update";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", async () => {
  const actual = await vi.importActual<object>("@/app/(site)/crews/_hooks/use-crew");
  return {
    ...actual,
    useCreateCrewProductionActivity: () => ({
      mutateAsync: state.create,
      isPending: false,
    }),
  };
});
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => <div /> }));
vi.mock("./production-activity-editor", () => ({
  EMPTY_PRODUCTION_ACTIVITY_DOCUMENT: { type: "doc", content: [{ type: "paragraph" }] },
  ProductionActivityEditor: ({
    placeholder,
    value,
    onSubmit,
    onChange,
  }: {
    placeholder: string;
    value: { content?: Array<{ content?: Array<{ text?: string }> }> };
    onSubmit: () => void;
    onChange: (document: object, plainText: string) => void;
  }) => (
    <textarea
      placeholder={placeholder}
      value={value.content?.[0]?.content?.[0]?.text ?? ""}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.ctrlKey) onSubmit();
      }}
      onChange={(event) =>
        onChange(
          {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: event.target.value }] }],
          },
          event.target.value.trim()
        )
      }
    />
  ),
  ProductionActivityRichText: () => null,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderComposer() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ProductionActivityComposer
        crewId="crew-1"
        viewerUserId="user-1"
        canManage
        startDate="2026-09-09"
        projectCreatedAt="2026-08-01T00:00:00.000Z"
        latestUpdate={null}
        progress={45}
      />
    )
  );
}

function setTextarea(value: string) {
  const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  state.create.mockReset();
  state.create.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ProductionActivityComposer", () => {
  it("posts the default update with computed project progress", async () => {
    renderComposer();
    act(() => setTextarea("Episode one moved into rough cut."));
    const postUpdate = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "updates.post"
    )!;

    await act(async () => {
      postUpdate.click();
      await Promise.resolve();
    });

    expect(state.create).toHaveBeenCalledWith({
      kind: "update",
      health: "on_track",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Episode one moved into rough cut." }],
          },
        ],
      },
      progress: 45,
    });
  });

  it("switches to a real comment contract without update metadata", async () => {
    renderComposer();
    const commentTab = [...container!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === "activity.comment"
    )!;
    act(() => commentTab.click());
    act(() => setTextarea("The opening shot is ready for review."));

    const commentButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "activity.postComment"
    )!;
    await act(async () => {
      commentButton.click();
      await Promise.resolve();
    });

    expect(state.create).toHaveBeenCalledWith({
      kind: "comment",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "The opening shot is ready for review." }],
          },
        ],
      },
    });
  });
});

it("keeps text entered while the previous post is saving", async () => {
  let finish!: () => void;
  state.create.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  renderComposer();
  act(() => setTextarea("First update"));
  act(() =>
    [...container!.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "updates.post")!
      .click()
  );
  act(() => setTextarea("Next update in progress"));
  await act(async () => finish());
  expect(container!.querySelector("textarea")!.value).toBe("Next update in progress");
});

it("ignores repeated keyboard submissions while a post is saving", async () => {
  let finish!: () => void;
  state.create.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  renderComposer();
  act(() => setTextarea("One update"));
  act(() => {
    const input = container!.querySelector("textarea")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );
  });
  const calls = state.create.mock.calls.length;
  await act(async () => finish());
  expect(calls).toBe(1);
});

it("retains a rejected draft and allows retry", async () => {
  state.create.mockRejectedValueOnce(new Error("Try again")).mockResolvedValueOnce(undefined);
  renderComposer();
  act(() => setTextarea("Retry this update"));
  const submit = () =>
    [...container!.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "updates.post")!
      .click();
  await act(async () => submit());
  expect(container!.querySelector("textarea")!.value).toBe("Retry this update");
  await act(async () => submit());
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(container!.querySelector("textarea")!.value).toBe("");
});

it("preserves a draft as a comment after production-management access is revoked", async () => {
  renderComposer();
  act(() => setTextarea("Keep this production note"));
  act(() =>
    root!.render(
      <ProductionActivityComposer
        crewId="crew-1"
        viewerUserId="user-1"
        canManage={false}
        startDate="2026-09-09"
        projectCreatedAt="2026-08-01T00:00:00.000Z"
        latestUpdate={null}
        progress={45}
      />
    )
  );
  expect(container!.querySelector("textarea")!.value).toBe("Keep this production note");
  expect(container!.querySelector("textarea")!.getAttribute("placeholder")).toBe(
    "activity.commentPlaceholder"
  );
  expect(container!.textContent).not.toContain("updates.post");
  await act(async () =>
    [...container!.querySelectorAll("button")]
      .find((b) => b.textContent === "activity.postComment")!
      .click()
  );
  expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "comment" }));
  expect(state.create.mock.calls[0][0]).not.toHaveProperty("health");
});
