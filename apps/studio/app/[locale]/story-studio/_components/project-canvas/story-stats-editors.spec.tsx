// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBibleStateVariable } from "@/lib/story-projects-api";
import type { StoryCondition, StoryStateEffect } from "@repo/shared/story-stats";
import { StoryChoiceAttachmentBar, StoryEffectsEditor } from "./story-stats-editors";

vi.mock("next-intl", () => ({
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
    <StoryEffectsEditor
      effects={effects}
      variables={variables}
      locale="en"
      canEdit
      onChange={setEffects}
    />
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
