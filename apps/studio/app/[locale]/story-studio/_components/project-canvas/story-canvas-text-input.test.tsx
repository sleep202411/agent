// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { StoryCanvasTextInput } from "./story-canvas-text-input";

describe("story text composition", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([false, true])(
    "preserves Chinese composition through parent updates (multiline=%s)",
    async (multiline) => {
      const onValueChange = vi.fn();
      const render = (value: string) =>
        root.render(
          <StoryCanvasTextInput multiline={multiline} value={value} onValueChange={onValueChange} />
        );
      await act(async () => render(""));
      const element = container.querySelector("input,textarea") as
        | HTMLInputElement
        | HTMLTextAreaElement;
      const setValue = Object.getOwnPropertyDescriptor(
        multiline ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      )!.set!;
      await act(async () => {
        element.focus();
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        setValue.call(element, "nihao");
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: "nihao",
            isComposing: true,
            inputType: "insertCompositionText",
          })
        );
      });
      expect(onValueChange).not.toHaveBeenCalled();
      await act(async () => render(""));
      expect(element.value).toBe("nihao");
      expect(document.activeElement).toBe(element);
      await act(async () => {
        setValue.call(element, "你好，选择道路");
        element.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: "你好，选择道路",
            isComposing: true,
            inputType: "insertCompositionText",
          })
        );
        element.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true, data: "你好，选择道路" })
        );
      });
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenLastCalledWith("你好，选择道路");
      expect(element.value).toBe("你好，选择道路");
      await act(async () => element.blur());
      expect(onValueChange).toHaveBeenCalledTimes(1);
      await act(async () => render("外部更新"));
      expect(element.value).toBe("外部更新");
    }
  );
});
