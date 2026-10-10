// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminHomeworkRow, AdminTeachingIncome } from "@/lib/admin-academy-learning";
import { CourseIncomePanel } from "./course-income-panel";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;

const item: AdminHomeworkRow = {
  id: "e1",
  courseId: "14",
  courseTitle: "测试课",
  studentId: "1",
  studentName: "学员1",
  teacherId: "137996",
  teacherName: "袁铮",
  version: 3,
  status: "approved",
  description: "作业",
  assetIds: [],
  score: 90,
  feedback: "通过",
  teacherCredits: "100",
  priceCredits: "100",
  createdAt: "2026-10-10T01:00:00.000Z",
  reviewedAt: "2026-10-10T02:30:00.000Z",
};

const summary: AdminTeachingIncome = {
  courses: 0,
  students: 1,
  pending: 0,
  monthlyNewStudents: 1,
  previousMonthNewStudents: 0,
  earnedCredits: "100",
  scope: "lecturer",
  platformUserId: "137996",
};

async function render(view: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(view);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
});

it("counts opened courses from income rows when offerings are empty", async () => {
  await render(
    <CourseIncomePanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      summary={summary}
      items={[item]}
      loadError={null}
    />
  );
  expect(container.textContent).toContain("已开课");
  expect(container.textContent).toContain("收入详情");
  expect(container.textContent).toContain("测试课");
  expect(container.textContent).toContain("学员1");
  expect(container.textContent).toContain("已通过");
  expect(container.textContent).toContain("+100");
  expect(container.textContent).toContain("已结算");
  expect(container.textContent).not.toContain("剧组提现");
});

it("filters income rows by status", async () => {
  await render(
    <CourseIncomePanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      summary={summary}
      items={[
        item,
        { ...item, id: "e2", studentName: "学员2", status: "submitted", teacherCredits: "80" },
      ]}
      loadError={null}
    />
  );
  const status = container.querySelector("select[aria-label='状态']") as HTMLSelectElement;
  await act(async () => {
    status.value = "submitted";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("学员2");
  expect(container.textContent).not.toContain("学员1");
});
