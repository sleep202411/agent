import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CREW_CURRENCY } from "@/src/lib/crew-money";
import { ApplicationTermsPanel } from "./application-terms-panel";
import { exactMinorUnits } from "../_hooks/use-application-terms";
const h = vi.hoisted(() => ({ user: "applicant", get: vi.fn(), post: vi.fn(), ready: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", () => ({
  crewApi: { get: (...a: unknown[]) => h.get(...a), post: (...a: unknown[]) => h.post(...a) },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
const term = {
  version: 2,
  scope: "Two scenes",
  feeAmount: "12345",
  currency: "USD",
  feePeriod: "project",
  revenueShareBp: 0,
  shareBasis: null,
  confirmedAt: null,
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "applicant";
  vi.clearAllMocks();
  h.get.mockResolvedValue({ currentVersion: 2, items: [term] });
  h.post.mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function render(
  reviewer = false,
  advertisedPaymentTerms?: "monthly" | "half_upfront" | "on_completion" | null
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <ApplicationTermsPanel
          applicationId="app"
          applicantId="applicant"
          status="pending"
          reviewer={reviewer}
          advertisedPaymentTerms={advertisedPaymentTerms}
          taskLinked
          onReady={h.ready}
        />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
it("confirms only the displayed version and does not grant approval on a stale-version error", async () => {
  h.post.mockRejectedValueOnce(new Error("Version changed"));
  await render();
  expect(host.textContent).toContain("123.45");
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "confirm")!
      .click()
  );
  expect(h.post).toHaveBeenCalledWith("/applications/app/terms/confirm", { body: { version: 2 } });
  expect(host.textContent).toContain("Version changed");
  expect(h.ready).not.toHaveBeenCalledWith(true);
});
it("removes the previous account's terms while the new account request fails", async () => {
  await render();
  h.user = "outsider";
  h.get.mockRejectedValue(new Error("Forbidden"));
  await render();
  expect(host.textContent).not.toContain("Two scenes");
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("confirm");
});
it("allows approval only when the current version is confirmed", async () => {
  h.user = "reviewer";
  h.get.mockResolvedValue({ currentVersion: 2, items: [{ ...term, confirmedAt: "2026-09-25" }] });
  await render(true);
  expect(h.ready).toHaveBeenCalledWith(true);
  expect(host.textContent).not.toContain("confirm version");
});
it.each([
  ["0", "0"],
  ["123.45", "12345"],
  ["90071992547409.91", "9007199254740991"],
  ["1.001", null],
  ["-1", null],
  ["1e3", null],
])("parses exact money %s", (value, expected) => expect(exactMinorUnits(value!)).toBe(expected));
it("proposes the displayed base version with exact cash and share units", async () => {
  h.user = "reviewer";
  await render(true);
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  const fields = host.querySelectorAll("input,textarea");
  const values = [
    "Deliver two scenes",
    "123.45",
    "2.50",
    "Gross receipts under existing agreement",
  ];
  // Order: scope textarea, fee input, share input, share-basis textarea.
  await act(async () => {
    fields.forEach((field, index) => {
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, values[index]);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  await act(async () => {
    qc.setQueryData(["crew-application-terms", "app", "reviewer"], {
      currentVersion: 3,
      items: [{ ...term, version: 3 }],
    });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  // Collapsing/reopening must not silently attach the old draft to version 3.
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(h.post).toHaveBeenCalledWith("/applications/app/terms", {
    body: {
      expectedVersion: 2,
      scope: "Deliver two scenes",
      feeAmount: "12345",
      currency: CREW_CURRENCY,
      feePeriod: "project",
      paymentTerms: null,
      revenueShareBp: 250,
      shareBasis: "Gross receipts under existing agreement",
    },
  });
});
it("does not enable approval when an older confirmed version is returned", async () => {
  h.get.mockResolvedValue({ currentVersion: 3, items: [{ ...term, confirmedAt: "2026-09-25" }] });
  await render(true);
  expect(h.ready).not.toHaveBeenCalledWith(true);
});
it("discards old values before starting a proposal against the latest version", async () => {
  h.user = "reviewer";
  await render(true);
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  async function fill(values: string[]) {
    await act(async () => {
      host.querySelectorAll("input,textarea").forEach((field, index) => {
        const prototype =
          field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, values[index]);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  await fill(["Old scope", "100", "2.50", "Old basis"]);
  await act(async () => {
    qc.setQueryData(["crew-application-terms", "app", "reviewer"], {
      currentVersion: 3,
      items: [{ ...term, version: 3, scope: "Another reviewer's terms" }],
    });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.textContent).toContain("Another reviewer's terms");
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "discardDraft")!
      .click();
  });
  expect(
    Array.from(host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")).map(
      (field) => field.value
    )
  ).toEqual(["", "", "0", ""]);
  expect(h.post).not.toHaveBeenCalled();
  await fill(["Revised scope", "200", "0", ""]);
  let finish!: (value: unknown) => void;
  h.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(h.post).toHaveBeenCalledWith("/applications/app/terms", {
    body: {
      expectedVersion: 3,
      scope: "Revised scope",
      feeAmount: "20000",
      currency: CREW_CURRENCY,
      feePeriod: "project",
      paymentTerms: null,
      revenueShareBp: 0,
      shareBasis: null,
    },
  });
  expect(
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "discardDraft"
    )!.disabled
  ).toBe(true);
  await act(async () => {
    finish({});
  });
});

it("shows the offered payment timing to the applicant before confirmation", async () => {
  h.get.mockResolvedValue({
    currentVersion: 2,
    items: [{ ...term, paymentTerms: "half_upfront" }],
  });
  await render();
  expect(host.textContent).toContain("half_upfront");
  expect(h.post).not.toHaveBeenCalled();
});

it.each([
  [null, "monthly", "monthly"],
  ["half_upfront", "monthly", "half_upfront"],
  ["unspecified", "monthly", "unspecified"],
] as const)(
  "prefills %s existing timing with %s advertised timing as %s",
  async (existing, advertised, expected) => {
    h.user = "reviewer";
    h.get.mockResolvedValue(
      existing === null
        ? { currentVersion: 0, items: [] }
        : {
            currentVersion: 2,
            items: [{ ...term, paymentTerms: existing === "unspecified" ? null : existing }],
          }
    );
    await render(true, advertised);
    await act(async () => {
      const details = host.querySelector("details")!;
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.querySelector('[role="combobox"][aria-label="label"]')?.textContent).toContain(
      expected
    );
  }
);
