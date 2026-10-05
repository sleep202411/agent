import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
import { CreateCrewDialog } from "./create-crew-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  locale: "en-US",
  create: vi.fn(),
  update: vi.fn(),
  eligible: true,
  push: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { eligible: state.eligible },
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: "alice" }, isLoading: false }),
}));
const dictionaries = { "en-US": en, "zh-CN": cn, "zh-HK": hk };
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => state.locale,
  useTranslations: (ns: string) => (key: string) =>
    `${ns}.${key}`
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        dictionaries[state.locale as keyof typeof dictionaries]
      ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));
vi.mock("@/src/services/user", () => ({ uploadBanner: vi.fn() }));
vi.mock("@/app/(site)/creators/_components/center/dialogs/level-apply-dialog", () => ({
  AI_PRODUCER_LEVEL_ID: 13,
  LevelApplyDialog: () => null,
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class extends Error {},
  crewApi: { get: vi.fn().mockResolvedValue([]) },
  useCreateCrew: () => ({ mutate: state.create, isPending: false }),
  useUpdateCrew: () => ({ mutate: state.update, isPending: false }),
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.eligible = true;
});
function Fixture({
  edit = false,
  onCreated,
}: {
  edit?: boolean;
  onCreated?: (crew: { id: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <CreateCrewDialog
      open={open}
      onCreated={onCreated}
      onOpenChange={setOpen}
      initial={
        edit
          ? { id: "existing", name: "Existing", description: "Saved", logo: "logo.png" }
          : undefined
      }
    />
  );
}
it.each(["en-US", "zh-CN", "zh-HK"] as const)(
  "opens requirements from the %s creation form without submitting or losing input",
  async (locale) => {
    state.locale = locale;
    await act(async () => root.render(<Fixture />));
    const name = document.querySelector("input:not([type=file])") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Unsubmitted draft"
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const opener = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === dictionaries[locale].crew.creationRequirements.title
    )!;
    for (const dismissal of ["button", "escape"]) {
      await act(async () => {
        opener.focus();
        opener.click();
      });
      const notice = Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) =>
        dialog.querySelector('a[href^="mailto:"]')
      )!;
      expect(notice).toBeTruthy();
      await act(async () => {
        if (dismissal === "button") {
          const dismiss = Array.from(notice.querySelectorAll("button")).find(
            (button) =>
              button.textContent === dictionaries[locale].crew.creationRequirements.dismiss
          )!;
          dismiss.click();
        } else
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
      expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(name.value).toBe("Unsubmitted draft");
    }
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  }
);
it("does not show creation requirements in edit mode", async () => {
  state.locale = "en-US";
  await act(async () => root.render(<Fixture edit />));
  expect(
    Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent === en.crew.creationRequirements.title
    )
  ).toBe(false);
  expect((document.querySelector("input:not([type=file])") as HTMLInputElement).value).toBe(
    "Existing"
  );
});

it("shows the qualification notice instead of the form to an uncertified user", async () => {
  state.eligible = false;
  state.locale = "en-US";
  await act(async () => root.render(<Fixture />));
  expect(document.querySelector('a[href^="mailto:"]')).toBeTruthy();
  expect(document.querySelector("input")).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});

async function submitCreation(onCreated?: (crew: { id: string }) => void) {
  state.locale = "en-US";
  await act(async () => root.render(<Fixture onCreated={onCreated} />));
  await act(async () => {
    const name = document.querySelector("input:not([type=file])")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      name,
      "New Crew"
    );
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const description = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      description,
      "Production team"
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const form = document.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === en.crew.createSubmit)!
        .click();
  });
}
it("hands a successfully created Crew to task creation instead of setup", async () => {
  const onCreated = vi.fn();
  await submitCreation(onCreated);
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(onCreated).not.toHaveBeenCalled();
  await act(async () => state.create.mock.calls[0]![1].onSuccess({ id: "new-crew" }));
  expect(onCreated).toHaveBeenCalledWith({ id: "new-crew" });
  expect(state.push).not.toHaveBeenCalled();
});
it("retains setup navigation for ordinary Crew creation", async () => {
  await submitCreation();
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => state.create.mock.calls[0]![1].onSuccess({ id: "new-crew" }));
  expect(state.push).toHaveBeenCalledWith("/en-US/crews/new-crew/setup");
});
