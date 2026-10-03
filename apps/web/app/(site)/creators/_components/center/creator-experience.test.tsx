import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorExperience } from "./creator-experience";
import type { ExperienceEntry } from "@/app/(site)/profile/_hooks/use-profile-extras";

const state = vi.hoisted(() => ({
  user: "owner" as string | null,
  get: vi.fn(),
  post: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user ? { id: state.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/src/env", () => ({ env: {} }));
vi.mock("@/src/lib/api", () => ({ api: { get: state.get, post: state.post } }));
vi.mock("sonner", () => ({
  toast: { error: state.error, success: state.success, warning: vi.fn() },
}));
let root: Root, host: HTMLDivElement, client: QueryClient, rows: ExperienceEntry[];
const entry = (id: string | number = 0): ExperienceEntry => ({
  id,
  title: "Editor",
  organization: "Film crew",
  location: "Singapore",
  startTime: "2024-01-01",
  endTime: "",
  description: "Film editing",
});
beforeEach(() => {
  vi.clearAllMocks();
  state.user = "owner";
  rows = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.get.mockImplementation(async () => rows.map((e) => ({ ...e })));
  state.post.mockImplementation(async (url: string, args?: { data: ExperienceEntry }) => {
    if (url.endsWith("/add")) rows.push({ ...args!.data, id: 0 });
    else if (url.endsWith("/update"))
      rows = rows.map((e) => (e.id === args!.data.id ? args!.data : e));
    else rows = [];
    return {};
  });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}
async function render(owner = true, creatorId = "owner") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <CreatorExperience creatorId={creatorId} isOwner={owner} />
      </QueryClientProvider>
    )
  );
  await settle();
}
const button = (label: string) => {
  const scope = document.querySelector('[role="alertdialog"], [role="dialog"]') ?? document;
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label
  )!;
};
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
function edit(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="experienceTitle"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("adds, edits id zero, cancels deletion and confirms deletion with visible refresh", async () => {
  await render();
  await click("addExperience");
  edit(" Editor ");
  await click("save");
  expect(host.textContent).toContain("Editor");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("editExperience: Editor");
  edit("Director");
  await click("save");
  expect(state.post).toHaveBeenCalledWith(
    "/user/resumer/update",
    expect.objectContaining({ data: expect.objectContaining({ id: 0, title: "Director" }) })
  );
  expect(host.textContent).toContain("Director");
  await click("delete: Director");
  await click("cancel");
  expect(rows).toHaveLength(1);
  await click("delete: Director");
  await click("delete");
  expect(rows).toHaveLength(0);
  expect(host.textContent).toContain("about.experienceEmptyOwner");
});
it("keeps the draft and specific error after a failed save, then retries", async () => {
  state.post.mockRejectedValueOnce(new Error("Resume service unavailable"));
  await render();
  await click("addExperience");
  edit("Unsaved role");
  await click("save");
  expect(state.error).toHaveBeenCalledWith("Resume service unavailable");
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="experienceTitle"]')!.value
  ).toBe("Unsaved role");
  await click("save");
  expect(host.textContent).toContain("Unsaved role");
});
it("does not replace a draft on refresh and cancels without saving", async () => {
  rows = [entry()];
  await render();
  await click("editExperience: Editor");
  edit("Draft");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["creator", "experience"] });
  });
  await settle();
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="experienceTitle"]')!.value
  ).toBe("Draft");
  await click("cancel");
  expect(state.post).not.toHaveBeenCalled();
  await click("editExperience: Editor");
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="experienceTitle"]')!.value
  ).toBe("Editor");
});
it("closes owner editing on account change and ignores an old save completion", async () => {
  let resolve!: () => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await click("addExperience");
  edit("Owner draft");
  await click("save");
  state.user = "visitor";
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("addExperience")).toBeUndefined();
  await act(async () => resolve());
  await settle();
  expect(state.success).not.toHaveBeenCalled();
});
it("deduplicates same-tick save clicks", async () => {
  await render();
  await click("addExperience");
  edit("One role");
  await act(async () => {
    button("save").click();
    button("save").click();
  });
  await settle();
  expect(state.post).toHaveBeenCalledTimes(1);
});
it("keeps failed deletion open for retry and encodes the entry id", async () => {
  rows = [entry("id/one")];
  state.post.mockRejectedValueOnce(new Error("Try again"));
  await render();
  await click("delete: Editor");
  await click("delete");
  expect(state.error).toHaveBeenCalledWith("Try again");
  expect(rows).toHaveLength(1);
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click("delete");
  expect(state.post).toHaveBeenLastCalledWith("/user/resumer/delete/id%2Fone");
  expect(rows).toHaveLength(0);
});
it("renders visitor entries read-only and recovers a list failure without showing stale rows", async () => {
  rows = [entry()];
  await render(false);
  expect(host.textContent).toContain("Editor");
  expect(host.querySelector("button")).toBeNull();
  state.get.mockRejectedValueOnce(new Error("Access denied"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["creator", "experience"] });
  });
  await settle();
  expect(host.textContent).not.toContain("Editor");
  expect(host.textContent).toContain("Access denied");
  await click("retry");
  expect(host.textContent).toContain("Editor");
});
