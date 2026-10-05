import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CreatorWithdrawals, withdrawalPreview } from "./withdrawals";
import { crewApi, CrewApiError } from "../_hooks/api";

const session = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: session.id ? { id: session.id } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/region/cell", () => ({ CURRENT_CELL: "com" }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: { get: vi.fn(), post: vi.fn() },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
const recipient = {
  fullName: "Alice",
  accountNumber: "PRIVATE-ACCOUNT",
  address: "Private address",
  swift: "DBSSSGSG",
  branchAddress: "Bank branch",
};
const balance = {
  currency: "USD",
  availableAmountMinor: "3001",
  confirmedAmountMinor: "3001",
  reservedAmountMinor: "0",
  paidAmountMinor: "0",
};
function seed() {
  vi.mocked(crewApi.get).mockImplementation(async (path) => {
    if (path.endsWith("/balances")) return [balance];
    if (path.endsWith("/recipient")) return { recipient };
    return { items: [], nextCursor: null };
  });
}
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <CreatorWithdrawals />
        </QueryClientProvider>
      )
    );
  render();
  return render;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === label
  );
  expect(button).toBeDefined();
  act(() => button!.click());
}
async function open() {
  click("withdraw");
  await settle();
}
function submit() {
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  client?.clear();
  session.id = "alice";
  vi.resetAllMocks();
});

it("calculates percentages without floating-point loss and rejects sub-cent requests", () => {
  expect(withdrawalPreview("3001", "50")).toEqual({ percentageBps: 5000, amountMinor: "1500" });
  expect(withdrawalPreview("9007199254740993", "100")?.amountMinor).toBe("9007199254740993");
  for (const input of ["0", "100.01", "-1", "1e2", "10.001"])
    expect(withdrawalPreview("3001", input)).toBeNull();
  expect(withdrawalPreview("1", "1")).toBeNull();
});
it("loads bank details only on request and clears them on closing without caching them", async () => {
  seed();
  mount();
  await settle();
  expect(container.textContent).toContain("USD 30.01");
  expect(vi.mocked(crewApi.get).mock.calls.some(([path]) => path.endsWith("/recipient"))).toBe(
    false
  );
  await open();
  expect(container.querySelector<HTMLInputElement>('[name="accountNumber"]')?.value).toBe(
    recipient.accountNumber
  );
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data)
    )
  ).not.toContain(recipient.accountNumber);
  click("cancel");
  await settle();
  expect(container.querySelector('[name="accountNumber"]')).toBeNull();
});
it("sends one request despite duplicate submit and refreshes after success", async () => {
  seed();
  let resolve!: (value: unknown) => void;
  vi.mocked(crewApi.post).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  mount();
  await settle();
  await open();
  submit();
  submit();
  expect(crewApi.post).toHaveBeenCalledTimes(1);
  const body = vi.mocked(crewApi.post).mock.calls[0][1]?.body;
  expect(body).toEqual({
    requestId: expect.any(String),
    currency: "USD",
    percentageBps: 10000,
    expectedAvailableAmountMinor: "3001",
    recipient,
  });
  await act(async () => resolve({ id: "request" }));
  await settle();
  expect(container.textContent).toContain("submitted");
  expect(container.querySelector("form")).toBeNull();
});
it("retries an uncertain response with the identical request and locks its terms", async () => {
  seed();
  vi.mocked(crewApi.post)
    .mockRejectedValueOnce(new Error("Network response lost"))
    .mockResolvedValueOnce({});
  mount();
  await settle();
  await open();
  submit();
  await settle();
  expect(container.textContent).toContain("Network response lost");
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  const first = vi.mocked(crewApi.post).mock.calls[0][1]?.body;
  submit();
  await settle();
  expect(vi.mocked(crewApi.post).mock.calls[1][1]?.body).toEqual(first);
});
it("requires refreshing a stale balance instead of repeatedly sending stale terms", async () => {
  seed();
  vi.mocked(crewApi.post).mockRejectedValue(
    new CrewApiError(409, { message: "Your available earnings changed." })
  );
  mount();
  await settle();
  await open();
  submit();
  await settle();
  expect(container.textContent).toContain("Your available earnings changed.");
  submit();
  expect(crewApi.post).toHaveBeenCalledTimes(1);
  click("reviewBalance");
  await settle();
  expect(container.querySelector("form")).toBeNull();
});
it("clears bank details and old history immediately on account change and logout", async () => {
  seed();
  const render = mount();
  await settle();
  await open();
  session.id = "bob";
  render();
  expect(container.querySelector('[name="accountNumber"]')).toBeNull();
  session.id = null;
  render();
  expect(container.textContent).toBe("");
});
it("shows paid status and loads further withdrawal history", async () => {
  seed();
  vi.mocked(crewApi.get).mockImplementation(async (path, options) => {
    if (path.endsWith("/balances")) return [balance];
    return {
      items: [
        {
          id: options?.query?.cursor ? "second" : "first",
          currency: "USD",
          amountMinor: "100",
          status: "paid",
          createdAt: "2026-10-05T00:00:00Z",
          paidAt: "2026-10-05T01:00:00Z",
          resolutionReason: null,
        },
      ],
      nextCursor: options?.query?.cursor ? null : "first",
    };
  });
  mount();
  await settle();
  expect(container.textContent).toContain("states.paid");
  click("loadMore");
  await settle();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
});

it("offers payment proof only for paid attached rows and preserves retry after failure", async () => {
  seed();
  const base = {
    currency: "USD",
    amountMinor: "100",
    percentageBps: 10000,
    createdAt: "2026-10-06T00:00:00Z",
    paidAt: null,
    resolutionReason: null,
  };
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.endsWith("/balances")
      ? [balance]
      : {
          items: [
            { ...base, id: "paid-proof", status: "paid", hasPaymentProof: true },
            { ...base, id: "paid-legacy", status: "paid", hasPaymentProof: false },
            { ...base, id: "processing", status: "processing", hasPaymentProof: true },
          ],
          nextCursor: null,
        }
  );
  vi.mocked(crewApi.post).mockRejectedValue(new Error("Proof storage temporarily unavailable"));
  mount();
  await settle();
  expect(
    [...container.querySelectorAll("button")].filter(
      (node) => node.textContent === "viewPaymentProof"
    )
  ).toHaveLength(1);
  click("viewPaymentProof");
  await settle();
  expect(container.textContent).toContain("Proof storage temporarily unavailable");
  expect(crewApi.post).toHaveBeenLastCalledWith(
    "/me/withdrawals/paid-proof/payment-proof/download",
    {}
  );
  click("viewPaymentProof");
  await settle();
  expect(
    vi.mocked(crewApi.post).mock.calls.filter(([path]) => path.includes("payment-proof"))
  ).toHaveLength(2);
});

it("ignores a previous account's late payment-proof failure", async () => {
  seed();
  vi.mocked(crewApi.get).mockImplementation(async (path) =>
    path.endsWith("/balances")
      ? [balance]
      : {
          items:
            session.id === "alice"
              ? [
                  {
                    id: "alice-proof",
                    currency: "USD",
                    amountMinor: "100",
                    status: "paid",
                    createdAt: "2026-10-06T00:00:00Z",
                    paidAt: "2026-10-06T01:00:00Z",
                    hasPaymentProof: true,
                  },
                ]
              : [],
          nextCursor: null,
        }
  );
  let fail!: (cause: Error) => void;
  vi.mocked(crewApi.post).mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  const render = mount();
  await settle();
  click("viewPaymentProof");
  session.id = "bob";
  render();
  await settle();
  await act(async () => fail(new Error("Previous account private error")));
  expect(container.textContent).not.toContain("Previous account private error");
  expect(container.textContent).not.toContain("viewPaymentProof");
});
