import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecruitmentCreatorSummary } from "./recruitment-creator-summary";
const h = vi.hoisted(() => ({ post: vi.fn(), postForm: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api: h }));
vi.mock("@/src/env", () => ({ env: { USER_BASE_URL: "", OSS_BASE_URL: "", BANNER_BASE_URL: "" } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
let root: Root, host: HTMLDivElement, queryClient: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.post.mockReset().mockResolvedValue({
    info: { nickName: "Applicant A" },
    level: [
      { id: 13, name: "Producer" },
      { id: 99, type: 2, name: "Free viewing" },
    ],
  });
  h.postForm.mockReset().mockResolvedValue([{ id: 1, title: "Published film" }]);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  host.remove();
});
async function render(id = "applicant-a") {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RecruitmentCreatorSummary applicantId={id} viewerId="reviewer" name="Fallback" />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("shows assigned qualifications and public work for the applicant, not the reviewer", async () => {
  await render();
  expect(h.post).toHaveBeenCalledWith(
    "/user/other/user/info",
    expect.objectContaining({
      params: { UserId: "applicant-a" },
      raw: true,
      signal: expect.any(AbortSignal),
    })
  );
  expect(h.postForm).toHaveBeenCalledWith(
    "/vedio/query/user/personal",
    { userId: "applicant-a", page: "1", pageSize: "3" },
    expect.anything()
  );
  expect(host.textContent).toContain("Applicant A");
  expect(host.textContent).toContain("Producer");
  expect(host.textContent).not.toContain("Free viewing");
  expect(host.textContent).toContain("Published film");
  expect(host.querySelector('a[href$="#creator-section-works"]')?.getAttribute("href")).toMatch(
    /^\/zh-CN\/creators\//
  );
});
it("does not retain another applicant's profile or work while the next query loads", async () => {
  await render();
  h.post.mockImplementation(() => new Promise(() => {}));
  h.postForm.mockImplementation(() => new Promise(() => {}));
  await render("applicant-b");
  expect(host.textContent).not.toContain("Applicant A");
  expect(host.textContent).not.toContain("Published film");
  expect(host.textContent).toContain("profileLoading");
  expect(host.textContent).toContain("worksLoading");
});
it("keeps errors distinct from empty qualifications and permits retry", async () => {
  h.post.mockRejectedValue(new Error("Profile unavailable"));
  h.postForm.mockResolvedValue([]);
  await render();
  expect(host.textContent).toContain("Profile unavailable");
  expect(host.textContent).not.toContain("noQualifications");
  expect(host.textContent).toContain("noPastWork");
  h.post.mockResolvedValue({ info: { nickName: "Recovered" }, level: [] });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(host.textContent).toContain("Recovered");
  expect(host.textContent).toContain("noQualifications");
});
