import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TaskPaymentTermsField } from "./task-payment-terms-field";
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
    accessibilityRole: string;
    accessibilityLabel: string;
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      onClick={onPress}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));
it("offers the three approved choices and accessible help, retaining monthly only for an existing agreement", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <TaskPaymentTermsField required locked={false} value="on_completion" onChange={change} />
      )
    );
    expect(host.querySelectorAll("[role=radio]")).toHaveLength(3);
    expect(host.textContent).not.toContain("taskPaymentTerms.monthly");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="taskPaymentTerms.help"]')!.click()
    );
    expect(host.textContent).toContain("taskPaymentTerms.demo_promiseHelp");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")]
        .find((x) => x.textContent?.includes("demo_promise"))!
        .click()
    );
    expect(change).toHaveBeenCalledWith("demo_promise");
    await act(async () =>
      root.render(<TaskPaymentTermsField required locked value="monthly" onChange={change} />)
    );
    expect(host.textContent).toContain("taskPaymentTerms.monthly");
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].every((x) => x.disabled)
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
