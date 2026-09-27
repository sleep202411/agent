import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PositionInvitationsPanel } from "./position-invitations-panel";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "applicant",
  get: vi.fn(),
  post: vi.fn(),
  ready: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("../_hooks/use-users", () => ({
  useUserLookup: ({ query }: { query: string }) =>
    query
      ? { kind: "found", user: { userId: query, nickname: "Matched creator" } }
      : { kind: "idle" },
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
const invitation = {
  id: "invite",
  positionId: "position",
  inviteeUserId: "applicant",
  status: "pending",
  expiresAt: "2099-09-25T10:00:00Z",
  applicationId: null,
};
const page = { items: [invitation], nextCursor: null };
const preview = {
  ...invitation,
  expired: false,
  position: {
    positionType: "Director",
    description: "Private script",
    experienceLevel: "any",
    requiredSkills: ["Editing"],
  },
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "applicant";
  vi.clearAllMocks();
  h.get
    .mockReset()
    .mockImplementation((url: string) => Promise.resolve(url.endsWith("/invite") ? preview : page));
  h.post.mockReset().mockResolvedValue({});
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
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function render(positionId?: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <PositionInvitationsPanel positionId={positionId} />
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(key: string) {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key);
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key)!.click());
  await flush();
}
async function field(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector(selector)!;
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("accepts a private invitation through the application API, never membership acceptance", async () => {
  await render();
  await click("view");
  expect(host.textContent).toContain("Private script");
  await field("textarea", "My application");
  await field("input", "https://example.com/portfolio");
  await click("accept");
  expect(h.post).toHaveBeenCalledWith("/crew-position-invitations/invite/accept", {
    body: { message: "My application", portfolioUrl: "https://example.com/portfolio" },
  });
});
it.each(["expired", "revoked", "foreign"])(
  "does not allow %s invitation acceptance",
  async (reason) => {
    h.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/invite")
          ? {
              ...preview,
              expired: reason === "expired",
              status: reason === "revoked" ? "revoked" : "pending",
              inviteeUserId: reason === "foreign" ? "other" : "applicant",
            }
          : page
      )
    );
    await render();
    await click("view");
    expect(button("accept")).toBeUndefined();
  }
);
it("creates recipient-bound invitations and revokes through the dedicated endpoint", async () => {
  h.user = "manager";
  await render("position");
  await field("input", "applicant");
  await field('input[type="number"]', "14");
  await click("invite");
  expect(h.post).toHaveBeenCalledWith("/crew-positions/position/invitations", {
    body: { inviteeUserId: "applicant", expiresInDays: 14 },
  });
  await click("revoke");
  expect(h.post).toHaveBeenLastCalledWith("/crew-position-invitations/invite/revoke", undefined);
});
it("rejects self-invitations and invalid expiry without a write", async () => {
  await render("position");
  await field("input", "applicant");
  await click("invite");
  expect(h.post).not.toHaveBeenCalled();
  await field("input", "other");
  await field('input[type="number"]', "31");
  await click("invite");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains the exact acceptance after an ambiguous failure", async () => {
  h.post.mockRejectedValueOnce(new Error("Network interrupted"));
  await render();
  await click("view");
  await field("textarea", "Original");
  await click("accept");
  const first = h.post.mock.calls[0];
  expect(button("accept")?.closest("fieldset")?.disabled).toBe(true);
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("hides private records after a denied refresh", async () => {
  await render();
  await click("view");
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await click("refresh");
  expect(host.textContent).not.toContain("Private script");
  expect(button("accept")).toBeUndefined();
});
it("isolates account switches and ignores late write completion", async () => {
  let finish!: () => void;
  h.post.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("view");
  await click("accept");
  await click("accept");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "other";
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await render();
  await act(async () => finish());
  await flush();
  expect(host.textContent).not.toContain("Private script");
  expect(button("accept")).toBeUndefined();
});
it("paginates the recipient inbox with its scoped cursor", async () => {
  h.get
    .mockResolvedValueOnce({ ...page, nextCursor: "invite" })
    .mockResolvedValue({ items: [{ ...invitation, id: "second" }], nextCursor: null });
  await render();
  await click("more");
  expect(h.get.mock.calls[1][1].query.cursor).toBe("invite");
  expect(host.querySelectorAll("li")).toHaveLength(2);
});

it("rejects invalid portfolio URLs but still permits declining", async () => {
  await render();
  await click("view");
  await field("input", "javascript:alert(1)");
  await click("accept");
  expect(h.post).not.toHaveBeenCalled();
  await click("decline");
  expect(h.post).toHaveBeenCalledWith("/crew-position-invitations/invite/decline", undefined);
});
it("clears an old application draft when selecting another invitation", async () => {
  h.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/invite")
        ? preview
        : url.endsWith("/second")
          ? { ...preview, id: "second" }
          : { items: [invitation, { ...invitation, id: "second" }], nextCursor: null }
    )
  );
  await render();
  await click("view");
  await field("textarea", "First invitation only");
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .filter((b) => b.textContent === "view")[1]!
      .click()
  );
  await flush();
  expect(host.querySelector("textarea")?.value).toBe("");
  await click("accept");
  expect(h.post).toHaveBeenCalledWith("/crew-position-invitations/second/accept", {
    body: { message: null, portfolioUrl: null },
  });
});
