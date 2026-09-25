// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CaseOperationsPanel } from "./case-operations-panel";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { caseCopy } from "./case-copy";
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  taskId: id,
  title: "Private case",
  status: "open",
  ownerAdminId: null as string | null,
  openedByUserId: "creator",
  respondentUserId: "reviewer",
  version: 2,
  createdAt: "2026-09-25T00:00:00Z",
};
const event = {
  id: "event",
  version: 2,
  actorId: "creator",
  actorKind: "user",
  action: "message",
  message: "Private evidence",
  submissionIds: [id],
  attachmentIds: [id],
  createdAt: row.createdAt,
};
let root: Root, host: HTMLDivElement, detail: typeof row, fetcher: ReturnType<typeof vi.fn>;
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  detail = { ...row };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetcher = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === "POST") return Promise.resolve(response({ ...detail, version: 3 }));
    if (url.includes("/read"))
      return Promise.resolve(
        response({
          url: "https://storage.test/evidence",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        })
      );
    if (url.includes(`/${id}?`))
      return Promise.resolve(response({ ...detail, events: [event], nextBeforeVersion: null }));
    return Promise.resolve(response({ code: 200, data: { items: [row], nextBeforeId: null } }));
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(scope = "admin/global/session") {
  await act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey={scope}>
        <CaseOperationsPanel adminId="admin" site="International" />
      </AdminSessionBoundary>
    )
  );
  await flush();
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text);
}
async function click(text: string) {
  expect(button(text)).toBeDefined();
  await act(async () => button(text)!.click());
  await flush();
}
async function open() {
  await render();
  await click("Review case");
}
async function draft(action = "Add discussion") {
  await click(action);
  await act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Recorded reason"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Review action");
}
const writes = () => fetcher.mock.calls.filter(([, opts]) => opts?.method === "POST");
it("requires reason and explicit confirmation, sending the reviewed version", async () => {
  await open();
  expect(button("Resolve case")).toBeUndefined();
  await draft("Claim / take over");
  expect(writes()).toHaveLength(0);
  await click("Confirm action");
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({
    action: "claim",
    message: "Recorded reason",
    expectedVersion: 2,
    submissionIds: [],
  });
  expect(host.textContent).toContain("Action recorded");
});
it.each(["admin", "someone-else"])(
  "permits resolution only for assigned owner %s",
  async (owner) => {
    detail = { ...row, status: "in_review", ownerAdminId: owner };
    await open();
    expect(Boolean(button("Resolve case"))).toBe(owner === "admin");
  }
);
it("resolved cases are read-only and cannot be reopened by operations", async () => {
  detail = { ...row, status: "resolved", ownerAdminId: "admin" };
  await open();
  expect(button("Claim / take over")).toBeUndefined();
  expect(button("Add discussion")).toBeUndefined();
  expect(host.textContent).toContain("Only a participant appeal");
});
it("retains the original version through refresh and requires discarding stale drafts", async () => {
  await open();
  await draft();
  detail = { ...row, version: 3 };
  await click("Refresh");
  expect(button("Confirm action")?.disabled).toBe(true);
  expect(host.textContent).toContain("The case changed");
});
it("recovers uncertain writes using the identical request even after resolution", async () => {
  await open();
  await draft();
  fetcher.mockImplementationOnce(() => Promise.reject(new Error("Lost response")));
  await click("Confirm action");
  expect(button("Retry same action")).toBeDefined();
  const original = writes()[0][1].body;
  detail = { ...row, status: "resolved", version: 3 };
  await click("Refresh");
  await click("Retry same action");
  expect(writes()[1][1].body).toBe(original);
  expect(host.textContent).toContain("Action recorded");
});
it.each([403, 409])("surfaces definitive %s without uncertain retry", async (status) => {
  await open();
  await draft();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(response({ message: "Permission or version changed" }, status))
  );
  await click("Confirm action");
  expect(host.textContent).toContain("Permission or version changed");
  expect(button("Retry same action")).toBeUndefined();
  if (status === 403) expect(host.textContent).not.toContain("Private evidence");
});
it("failed detail reads hide private history and all write controls", async () => {
  await open();
  fetcher.mockImplementationOnce(() => Promise.resolve(response({ message: "No access" }, 403)));
  await click("Refresh");
  expect(host.textContent).not.toContain("Private evidence");
  expect(button("Add discussion")).toBeUndefined();
});
it("authorizes evidence on demand using only a private read endpoint", async () => {
  await open();
  expect(host.querySelector('a[href*="storage"]')).toBeNull();
  await click("Authorize download");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://storage.test/evidence");
  expect(host.querySelector("a")?.getAttribute("referrerpolicy")).toBe("no-referrer");
});
it.each(["javascript:alert(1)", "http://storage.test/file"])(
  "rejects unsafe evidence link %s",
  async (url) => {
    await open();
    fetcher.mockImplementationOnce(() =>
      Promise.resolve(response({ url, expiresAt: new Date(Date.now() + 60000).toISOString() }))
    );
    await click("Authorize download");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("invalid or expired");
  }
);
it("clears cases and drafts when admin session/site changes", async () => {
  await open();
  await draft();
  fetcher.mockImplementation(() => new Promise(() => {}));
  await render("other/cn/session");
  expect(host.textContent).not.toContain("Private evidence");
  expect(host.querySelector("textarea")).toBeNull();
});
it("retains confirmed success when the following refresh fails", async () => {
  await open();
  await draft();
  fetcher
    .mockImplementationOnce(() => Promise.resolve(response({ ...row, version: 3 })))
    .mockImplementationOnce(() => Promise.reject(new Error("Refresh failed")));
  await click("Confirm action");
  expect(host.textContent).toContain("Action recorded");
  expect(host.textContent).toContain("Refresh failed");
  expect(button("Retry same action")).toBeUndefined();
});
it("changes language without discarding a draft", async () => {
  await open();
  await draft();
  await click("简体中文");
  expect(host.querySelector("textarea")?.value).toBe("Recorded reason");
  expect(button("确认操作")).toBeDefined();
  await click("繁體中文");
  expect(button("確認操作")).toBeDefined();
});
it("all three copy dictionaries have matching keys", () => {
  expect(Object.keys(caseCopy["zh-CN"]).sort()).toEqual(Object.keys(caseCopy["en-US"]).sort());
  expect(Object.keys(caseCopy["zh-HK"]).sort()).toEqual(Object.keys(caseCopy["en-US"]).sort());
});

it("guards duplicate submissions and suppresses a late result after session change", async () => {
  await open();
  await draft();
  let resolve!: (r: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      })
  );
  await act(async () => {
    button("Confirm action")!.click();
    button("Confirm action")!.click();
  });
  expect(writes()).toHaveLength(1);
  const signal = writes()[0][1].signal;
  await render("new-admin/cn/session");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response({ ...row, version: 3 })));
  await flush();
  expect(host.textContent).not.toContain("Action recorded");
});
it("uses independent queue and history cursors and refreshes from the first page", async () => {
  fetcher.mockImplementation((url: string) => {
    if (url.includes(`/${id}?`))
      return Promise.resolve(
        response({
          ...detail,
          events: [
            {
              ...event,
              id: url.includes("beforeVersion") ? "older" : "event",
              version: url.includes("beforeVersion") ? 1 : 2,
            },
          ],
          nextBeforeVersion: url.includes("beforeVersion") ? null : 2,
        })
      );
    return Promise.resolve(
      response({
        items: [
          url.includes("beforeId")
            ? { ...row, id: "22222222-2222-4222-8222-222222222222", title: "Older case" }
            : row,
        ],
        nextBeforeId: url.includes("beforeId") ? null : id,
      })
    );
  });
  await render();
  await click("Load more");
  expect(fetcher.mock.calls.at(-1)![0]).toContain(`beforeId=${id}`);
  expect(host.textContent).toContain("Older case");
  await click("Review case");
  await click("Load more");
  expect(fetcher.mock.calls.at(-1)![0]).toContain("beforeVersion=2");
  expect(host.querySelectorAll("ol > li")).toHaveLength(2);
  await click("Refresh");
  expect(fetcher.mock.calls.at(-1)![0]).not.toContain("beforeVersion");
  expect(host.querySelectorAll("ol > li")).toHaveLength(1);
});
it("expires signed links locally instead of leaving stale evidence URLs", async () => {
  await open();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      response({
        url: "https://storage.test/short",
        expiresAt: new Date(Date.now() + 80).toISOString(),
      })
    )
  );
  await click("Authorize download");
  expect(host.querySelector("a")).not.toBeNull();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(host.querySelector("a")).toBeNull();
});
