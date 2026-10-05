// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RevenuePanel } from "./revenue-panel";
import { revenueMinorUnits, revenueMoney, revenueShareBps } from "./revenue-api";

const contract = "11111111-1111-4111-8111-111111111111";
const allocation = {
  currency: "USD",
  amountMinor: "301",
  participants: [{ crewMemberId: "member", shareBps: 10000, amountMinor: "301" }],
};
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
const page = (items: unknown[]) => ok({ items, nextCursor: null });
const fetcher = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    if (url.includes("/crews?"))
      return Promise.resolve(page([{ id: "crew", name: "Fixture Crew" }]));
    if (url.endsWith("/members"))
      return Promise.resolve(
        page([{ id: "member", name: "Creator One", publicId: "273848", status: "removed" }])
      );
    if (url.endsWith("/contracts"))
      return Promise.resolve(
        page([{ id: contract, filename: "Agreement.pdf", verifiedAt: "2026-10-05T00:00:00Z" }])
      );
    if (url.endsWith("/crews/crew/distributions")) return Promise.resolve(page([]));
    if (url.endsWith("/preview")) return Promise.resolve(ok(allocation));
    if (url.endsWith("/distributions")) return Promise.resolve(ok({ id: "receipt" }));
    throw new Error(`Unexpected request: ${url}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function input(label: string, value: string) {
  const element = host.querySelector(`[aria-label="${label}"]`) as
    | HTMLInputElement
    | HTMLSelectElement;
  await act(async () => {
    const prototype =
      element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })
    );
  });
}
async function prepare(share = "100") {
  await act(async () => root.render(<RevenuePanel currency="USD" />));
  await click("Select");
  await input("Saved contract", contract);
  await input("Revenue title", "October revenue");
  await input("Revenue reference", "OCT-001");
  await input("Confirmed revenue", "3.01");
  await act(async () =>
    (host.querySelector('[aria-label="Include Creator One"]') as HTMLInputElement).click()
  );
  await input("Share for Creator One", share);
  await click("Preview allocation");
}
it("shows exact server preview and posts only after deliberate confirmation", async () => {
  await prepare();
  expect(host.textContent).toContain("Confirm USD 3.01");
  expect(host.textContent).toContain("Public ID 273848");
  expect(host.textContent).toContain("removed");
  const posts = () =>
    fetcher.mock.calls.filter(([url]) => url === "/api/admin/creator-revenue/distributions");
  expect(posts()).toHaveLength(0);
  expect(
    (host.querySelector('[aria-label="Confirmed revenue"]') as HTMLInputElement).closest("fieldset")
      ?.disabled
  ).toBe(true);
  await click("Post confirmed revenue");
  expect(posts()).toHaveLength(1);
  const body = JSON.parse(posts()[0][1].body);
  expect(body).toMatchObject({
    contractId: contract,
    title: "October revenue",
    revenueReference: "OCT-001",
    allocation: {
      currency: "USD",
      amountMinor: "301",
      participants: [{ crewMemberId: "member", shareBps: 10000 }],
    },
  });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(host.textContent).toContain("Revenue posted. Receipt receipt");
  expect(host.querySelector('[aria-label="Allocation preview"]')).toBeNull();
});
it("rejects shares that do not total 100% without posting or requesting a preview", async () => {
  await prepare("50");
  expect(host.textContent).toContain("total exactly 100%");
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/preview"))).toBe(false);
});
it.each(["USD", "CNY"] as const)(
  "shows the deployment currency %s as read-only",
  async (currency) => {
    await act(async () => root.render(<RevenuePanel currency={currency} />));
    await click("Select");
    const field = host.querySelector('[aria-label="Currency"]') as HTMLInputElement;
    expect(field.value).toBe(currency);
    expect(field.readOnly).toBe(true);
    expect(host.querySelector('select[aria-label="Currency"]')).toBeNull();
  }
);
it("retries an unknown posting result with identical terms and request ID", async () => {
  await prepare();
  fetcher.mockImplementationOnce(() => Promise.reject(new Error("Connection lost")));
  await click("Post confirmed revenue");
  expect(host.textContent).toContain("Connection lost");
  expect(button("Edit allocation").disabled).toBe(true);
  expect(button("Change Crew").disabled).toBe(true);
  await click("Retry posting");
  const posts = fetcher.mock.calls.filter(
    ([url]) => url === "/api/admin/creator-revenue/distributions"
  );
  expect(posts).toHaveLength(2);
  expect(posts[1][1].body).toBe(posts[0][1].body);
  expect(host.textContent).toContain("Revenue posted");
});
it("keeps a definitive conflict visible and allows correction", async () => {
  await prepare();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      new Response('{"message":"This revenue reference has different terms."}', { status: 409 })
    )
  );
  await click("Post confirmed revenue");
  expect(host.textContent).toContain("This revenue reference has different terms.");
  expect(button("Edit allocation").disabled).toBe(false);
  await click("Edit allocation");
  expect((host.querySelector('[aria-label="Revenue reference"]') as HTMLInputElement).value).toBe(
    "OCT-001"
  );
});
it("does not issue duplicate writes while posting is in flight", async () => {
  await prepare();
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  await click("Post confirmed revenue");
  await click("Post confirmed revenue");
  expect(
    fetcher.mock.calls.filter(([url]) => url === "/api/admin/creator-revenue/distributions")
  ).toHaveLength(1);
  await act(async () => resolve(ok({ id: "receipt" })));
});
it("retains exact cents above Number.MAX_SAFE_INTEGER and rejects invalid percentages", () => {
  expect(revenueMinorUnits("90071992547409.93")).toBe("9007199254740993");
  expect(revenueMoney("9007199254740993", "USD")).toBe("USD 90,071,992,547,409.93");
  expect(revenueShareBps("33.33")).toBe(3333);
  for (const value of ["0", "100.01", "1e2", "12.345", "-1"])
    expect(() => revenueShareBps(value)).toThrow();
});
it("loads beneficiary receipt detail only on request and clears it when leaving the Crew", async () => {
  const original = fetcher.getMockImplementation()!;
  const receipt = {
    id: contract,
    title: "October revenue",
    revenueReference: "OCT-001",
    currency: "USD",
    amountMinor: "301",
    postedAt: "2026-10-05T00:00:00Z",
    postedByAdminId: "finance",
  };
  fetcher.mockImplementation((url: string) => {
    if (url.endsWith("/crews/crew/distributions")) return Promise.resolve(page([receipt]));
    if (url.endsWith(`/distributions/${contract}`))
      return Promise.resolve(
        ok({
          ...receipt,
          crew: { id: "crew", name: "Fixture Crew" },
          contract: { id: contract, filename: "Agreement.pdf" },
          participants: [
            {
              crewMemberId: "member",
              publicId: "273848",
              shareBps: 9999,
              amountMinor: "301",
              earningId: "earning",
              status: "posted",
              reversalReason: null,
            },
            {
              crewMemberId: "tiny",
              publicId: "698155",
              shareBps: 1,
              amountMinor: "0",
              earningId: null,
              status: "zero_amount",
              reversalReason: null,
            },
          ],
        })
      );
    return original(url);
  });
  await act(async () => root.render(<RevenuePanel currency="USD" />));
  await click("Select");
  expect(fetcher.mock.calls.some(([url]) => url.endsWith(`/distributions/${contract}`))).toBe(
    false
  );
  await click("View receipt");
  const detail = host.querySelector('[aria-label="Revenue receipt"]');
  expect(detail?.textContent).toContain("99.99%");
  expect(detail?.textContent).toContain("698155");
  expect(detail?.textContent).toContain("No earning (rounded to zero)");
  await click("Change Crew");
  expect(host.querySelector('[aria-label="Revenue receipt"]')).toBeNull();
});
it.each([false, true])(
  "requires confirmation and retains reversal errors (ambiguous: %s)",
  async (ambiguous) => {
    const original = fetcher.getMockImplementation()!;
    const row = {
      id: contract,
      title: "October revenue",
      revenueReference: "OCT-001",
      currency: "USD",
      amountMinor: "301",
      postedAt: "2026-10-05T00:00:00Z",
      postedByAdminId: "finance",
    };
    let attempts = 0;
    fetcher.mockImplementation((url: string) => {
      if (url.endsWith("/crews/crew/distributions")) return Promise.resolve(page([row]));
      if (url.endsWith(`/distributions/${contract}`))
        return Promise.resolve(
          ok({
            ...row,
            crew: { id: "crew", name: "Fixture Crew" },
            contract: { id: contract, filename: "Agreement.pdf" },
            participants: [
              {
                crewMemberId: "member",
                publicId: "273848",
                shareBps: 10000,
                amountMinor: "301",
                earningId: "earning",
                status: "posted",
                reversalReason: null,
              },
            ],
          })
        );
      if (url.endsWith("/reverse")) {
        attempts++;
        if (attempts === 1)
          return ambiguous
            ? Promise.reject(new Error("Connection lost"))
            : Promise.resolve(
                new Response('{"message":"Revenue is already reserved."}', { status: 409 })
              );
        return Promise.resolve(ok({ id: contract, status: "reversed" }));
      }
      return original(url);
    });
    await act(async () => root.render(<RevenuePanel currency="USD" />));
    await click("Select");
    await click("View receipt");
    await input("Reversal reason", "Incorrect amount");
    await click("Reverse allocation");
    expect(attempts).toBe(0);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((node) => node.textContent === "Confirm reversal")!
        .click()
    );
    expect(attempts).toBe(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      ambiguous ? "Connection lost" : "Revenue is already reserved."
    );
    if (ambiguous) {
      expect(
        (host.querySelector('[aria-label="Reversal reason"]') as HTMLInputElement).disabled
      ).toBe(true);
      await act(async () =>
        [...document.querySelectorAll("button")]
          .find((node) => node.textContent === "Confirm reversal")!
          .click()
      );
      expect(attempts).toBe(2);
      const calls = fetcher.mock.calls.filter(([url]) => url.endsWith("/reverse"));
      expect(calls[0][1].body).toBe(calls[1][1].body);
      expect(host.textContent).toContain("Allocation reversed. Receipt");
      expect(host.querySelector('[aria-label="Revenue receipt"]')?.textContent).toContain(
        "reversed"
      );
    }
  }
);
