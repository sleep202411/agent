// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBibleStateVariable } from "@/lib/story-projects-api";
import type { StoryCondition, StoryStateEffect } from "@repo/shared/story-stats";
import {
  StoryChoiceAttachmentBar,
  StoryEffectsEditor,
  StoryStateVariablesPanel,
} from "./story-stats-editors";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));

const GOLD: StoryBibleStateVariable = {
  key: "gold",
  name: { en: "Gold" },
  valueType: "number",
  initialValue: 0,
};

const FLAG: StoryBibleStateVariable = {
  key: "flag",
  name: { en: "Flag" },
  valueType: "boolean",
  initialValue: false,
};

function Harness({
  initial,
  variables,
  onEffects,
}: {
  initial: StoryStateEffect[];
  variables: StoryBibleStateVariable[];
  onEffects: (effects: StoryStateEffect[]) => void;
}) {
  const [effects, setEffects] = useState(initial);
  onEffects(effects);
  return (
    <StoryEffectsEditor effects={effects} variables={variables} canEdit onChange={setEffects} />
  );
}

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("StoryEffectsEditor", () => {
  let container: HTMLDivElement;
  let root: Root;
  let effects: StoryStateEffect[];

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

  async function renderEditor(
    initial: StoryStateEffect[],
    variables: StoryBibleStateVariable[] = [GOLD, FLAG]
  ) {
    await act(async () => {
      root.render(
        <Harness initial={initial} variables={variables} onEffects={(next) => (effects = next)} />
      );
    });
  }

  const kindTrigger = (row: number) =>
    container.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')[
      row * 2 + 1
    ] as HTMLButtonElement;

  const valueInput = () => container.querySelector('input[type="number"]') as HTMLInputElement;

  async function setValue(value: string) {
    await act(async () => {
      setInputValue(valueInput(), value);
    });
  }

  it("shows the subtract option for a negative add amount with its magnitude", async () => {
    await renderEditor([{ kind: "add", key: "gold", amount: -3 }]);
    expect(kindTrigger(0).textContent).toContain("effectSubtract");
    expect(valueInput().value).toBe("3");
  });

  it("shows variable names in the interface language even for an English authoring project", async () => {
    await renderEditor(
      [{ kind: "set", key: "flag", value: false }],
      [{ ...FLAG, name: { "en-US": "Met", "zh-CN": "标记" } }]
    );
    expect(container.querySelector('[data-slot="select-trigger"]')?.textContent).toContain("标记");
  });

  it("shows the add option for non-negative amounts", async () => {
    await renderEditor([{ kind: "add", key: "gold", amount: 3 }]);
    expect(kindTrigger(0).textContent).toContain("effectAdd");
    expect(valueInput().value).toBe("3");
  });

  it("stores edited values as negative while the effect is subtract", async () => {
    await renderEditor([{ kind: "add", key: "gold", amount: -3 }]);
    await setValue("7");
    expect(effects).toEqual([{ kind: "add", key: "gold", amount: -7 }]);
    expect(valueInput().value).toBe("7");
  });

  it("stores edited values verbatim while the effect is add", async () => {
    await renderEditor([{ kind: "add", key: "gold", amount: 3 }]);
    await setValue("5");
    expect(effects).toEqual([{ kind: "add", key: "gold", amount: 5 }]);
  });

  it("disables the kind select for boolean variables", async () => {
    await renderEditor([{ kind: "set", key: "flag", value: true }], [FLAG]);
    expect(kindTrigger(0).disabled).toBe(true);
    expect(kindTrigger(0).getAttribute("aria-invalid")).toBeNull();
  });

  it("lets an old numeric effect be repaired after its variable becomes boolean", async () => {
    await renderEditor([{ kind: "add", key: "flag", amount: 1 }], [FLAG]);
    expect(kindTrigger(0).disabled).toBe(false);
    expect(kindTrigger(0).getAttribute("aria-invalid")).toBe("true");
    expect(kindTrigger(0).className).toContain("border-destructive!");
    expect(valueInput().getAttribute("aria-invalid")).toBe("true");
    expect(valueInput().disabled).toBe(true);
    expect(container.textContent).toContain("booleanEffectInvalid");

    const scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      await act(async () => {
        kindTrigger(0).focus();
        kindTrigger(0).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options.map((option) => option.textContent)).toEqual(["effectAdd", "effectSet"]);
      expect(options[0]?.getAttribute("data-disabled")).toBe("");
      await act(async () => options[1]?.click());
      expect(effects).toEqual([{ kind: "set", key: "flag", value: true }]);
      expect(container.textContent).not.toContain("booleanEffectInvalid");
    } finally {
      if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
      else delete (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
    }
  });
});

describe("StoryChoiceAttachmentBar visibility condition", () => {
  let container: HTMLDivElement;
  let root: Root;
  let condition: StoryCondition | undefined;

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

  it("uses the interface language for condition variable names", async () => {
    await act(async () => {
      root.render(
        <StoryChoiceAttachmentBar
          effects={[]}
          visibleWhen={{ kind: "compare", variableKey: "flag", operator: "equals", value: false }}
          variables={[{ ...FLAG, name: { "en-US": "Met", "zh-CN": "标记" } }]}
          locale="en-US"
          canEdit
          onEffectsChange={() => {}}
          onVisibleWhenChange={() => {}}
        />
      );
    });
    expect(container.querySelector('[data-slot="select-trigger"]')?.textContent).toContain("标记");
  });

  it("preserves nested conditions instead of silently flattening away rules", async () => {
    const nested: StoryCondition = {
      kind: "all",
      conditions: [
        { kind: "compare", variableKey: "gold", operator: "at-least", value: 2 },
        {
          kind: "any",
          conditions: [
            { kind: "compare", variableKey: "flag", operator: "equals", value: true },
            { kind: "compare", variableKey: "gold", operator: "at-least", value: 5 },
          ],
        },
      ],
    };
    const onVisibleWhenChange = vi.fn();
    await act(async () => {
      root.render(
        <StoryChoiceAttachmentBar
          effects={[]}
          visibleWhen={nested}
          variables={[GOLD, FLAG]}
          locale="en-US"
          canEdit
          onEffectsChange={() => {}}
          onVisibleWhenChange={onVisibleWhenChange}
        />
      );
    });
    expect(container.textContent).toContain("Gold ≥ 2 ∧ (Flag = true ∨ Gold ≥ 5)");
    expect(container.textContent).toContain("complexConditionHint");
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(onVisibleWhenChange).not.toHaveBeenCalled();
  });

  it("offers the add-condition action and reports cleared conditions as undefined", async () => {
    await act(async () => {
      root.render(
        <StoryChoiceAttachmentBar
          effects={[]}
          variables={[GOLD, FLAG]}
          locale="en"
          canEdit
          onEffectsChange={() => {}}
          onVisibleWhenChange={(next) => (condition = next)}
        />
      );
    });
    expect(container.textContent).toContain("visibleWhenTitle");
    expect(container.textContent).toContain("addCondition");

    // The add button wires the first default compare through onChange.
    const add = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "addCondition"
    ) as HTMLButtonElement;
    await act(async () => {
      add.click();
    });
    expect(condition).toEqual({
      kind: "compare",
      variableKey: "gold",
      operator: "at-least",
      value: 0,
    });
  });
});

describe("StoryStateVariablesPanel", () => {
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

  it("keeps Chinese IME composition local until the variable name is committed", async () => {
    let variables: StoryBibleStateVariable[] = [
      { ...GOLD, name: { "zh-CN": "金币" }, note: "初始描述" },
    ];
    const render = () =>
      root.render(
        <StoryStateVariablesPanel
          variables={variables}
          locale="zh-CN"
          defaultLocale="zh-CN"
          canEdit
          onChange={(next) => {
            variables = next;
            render();
          }}
        />
      );
    await act(async () => render());
    await act(async () =>
      (container.querySelector("article > button") as HTMLButtonElement).click()
    );
    const input = container.querySelector('article input:not([type="number"])') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

    await act(async () => {
      input.focus();
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setValue.call(input, "yongqi");
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "yongqi",
          inputType: "insertCompositionText",
          isComposing: true,
        })
      );
    });
    expect(variables[0]?.name["zh-CN"]).toBe("金币");
    expect(input.value).toBe("yongqi");

    await act(async () => {
      setValue.call(input, "勇气");
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "勇气",
          inputType: "insertCompositionText",
          isComposing: true,
        })
      );
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "勇气" }));
    });
    expect(variables[0]?.name["zh-CN"]).toBe("勇气");
    expect(input.value).toBe("勇气");
  });

  it("requires a named add action instead of creating preset variables on click", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <StoryStateVariablesPanel
          variables={[GOLD]}
          locale="en"
          defaultLocale="en"
          canEdit
          onChange={onChange}
        />
      );
    });

    expect(container.textContent).not.toContain("presetResource");
    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "addVariable"
    ) as HTMLButtonElement;
    await act(async () => addButton.click());
    expect(onChange).not.toHaveBeenCalled();

    const form = container.querySelector("form") as HTMLFormElement;
    const saveButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    await act(async () => setInputValue(form.querySelector("input")!, "Bravery"));
    expect(saveButton.disabled).toBe(false);
    await act(async () => saveButton.click());
    expect(onChange).toHaveBeenCalledWith([
      GOLD,
      { key: "state_1", name: { en: "Bravery" }, valueType: "number", initialValue: 0 },
    ]);
  });

  it("includes the project default language when adding from a different interface language", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <StoryStateVariablesPanel
          variables={[]}
          locale="zh-CN"
          defaultLocale="en-US"
          canEdit
          onChange={onChange}
        />
      );
    });
    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "addVariable"
    ) as HTMLButtonElement;
    await act(async () => addButton.click());
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => setInputValue(form.querySelector("input")!, "勇气"));
    await act(async () =>
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).click()
    );
    expect(onChange).toHaveBeenCalledWith([
      {
        key: "state_1",
        name: { "en-US": "勇气", "zh-CN": "勇气" },
        valueType: "number",
        initialValue: 0,
      },
    ]);
  });
});
