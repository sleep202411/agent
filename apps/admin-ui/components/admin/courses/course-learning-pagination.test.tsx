import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import HomeworkPage from "@/app/(admin)/courses/homework/page";
import IncomePage from "@/app/(admin)/courses/income/page";

const mocks = vi.hoisted(() => ({ homework: vi.fn(), income: vi.fn() }));
vi.mock("@/lib/admin-academy-learning", () => ({
  loadAdminHomework: mocks.homework,
  loadAdminTeachingIncome: mocks.income,
}));
vi.mock("@/lib/admin-content-permission", () => ({
  requireContentPagePermission: async () => ({
    site: { label: "CN", databaseLabel: "CN" },
    user: { displayName: "Teacher", permissions: ["courses.write"], platformUserId: "201" },
  }),
}));
vi.mock("./course-homework-panel", () => ({ CourseHomeworkPanel: () => null }));
vi.mock("./course-income-panel", () => ({ CourseIncomePanel: () => null }));

beforeEach(() => {
  mocks.homework.mockReset();
  mocks.income.mockResolvedValue({ data: null, error: null });
});

it.each([
  ["homework", HomeworkPage, "submitted"],
  ["income", IncomePage, "all"],
] as const)(
  "keeps %s pagination reachable even when the visible page is empty",
  async (path, Page, status) => {
    mocks.homework.mockResolvedValue({
      data: { items: [], nextCursor: "next-boundary", scope: "lecturer" },
      error: null,
    });
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ after: "current-boundary" }) })
    );
    expect(mocks.homework).toHaveBeenCalledWith(status, "current-boundary");
    expect(html).toContain(`href="/courses/${path}?after=next-boundary"`);
    expect(html).toContain(`href="/courses/${path}"`);
  }
);

it.each([HomeworkPage, IncomePage])("omits pagination on a single terminal page", async (Page) => {
  mocks.homework.mockResolvedValue({
    data: { items: [], nextCursor: null, scope: "lecturer" },
    error: null,
  });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).not.toContain("Next page");
  expect(html).not.toContain("First page");
});
