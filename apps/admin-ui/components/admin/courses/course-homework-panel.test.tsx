// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminHomeworkRow, AdminTeachingIncome } from "@/lib/admin-academy-learning";
import {
  CourseHomeworkPanel,
  formatSubmittedAt,
  homeworkTitle,
  queueMetrics,
  waitHours,
  waitTone,
} from "./course-homework-panel";

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

const row: AdminHomeworkRow = {
  id: "e1",
  courseId: "14",
  courseTitle: "测试课",
  studentId: "1",
  studentName: "Meliantern",
  teacherId: "137996",
  teacherName: "Elena",
  version: 2,
  status: "submitted",
  description: "第3课：分镜脚本设计\n细节",
  assetIds: [],
  score: null,
  feedback: null,
  teacherCredits: "0",
  priceCredits: "0",
  createdAt: "2026-10-10T01:00:00.000Z",
  submittedAt: "2026-10-10T01:00:00.000Z",
};

const summary: AdminTeachingIncome = {
  courses: 12,
  students: 1842,
  pending: 23,
  monthlyNewStudents: 186,
  previousMonthNewStudents: 0,
  earnedCredits: "0",
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

it("fills course and monthly counts from the review queue when offerings are empty", () => {
  expect(queueMetrics([row], new Date("2026-10-10T12:00:00.000Z"))).toEqual({
    pending: 1,
    courses: 1,
    students: 1,
    monthly: 1,
  });
});

it("uses the first homework line as the table title", () => {
  expect(homeworkTitle("第3课：分镜脚本设计\n细节")).toBe("第3课：分镜脚本设计");
  expect(homeworkTitle("  \n")).toBe("作业");
});

it("colors wait time after a day and after two days", () => {
  expect(waitHours("2026-10-10T00:00:00.000Z", Date.parse("2026-10-10T06:00:00.000Z"))).toBe(6);
  expect(waitTone(6)).toBe("ok");
  expect(waitTone(29)).toBe("warn");
  expect(waitTone(53)).toBe("late");
});

it("keeps course and monthly counts after homework is approved", async () => {
  await render(
    <CourseHomeworkPanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      displayName="Elena"
      initialItems={[]}
      metricItems={[{ ...row, status: "approved" }]}
      summary={{ ...summary, courses: 0, pending: 0, monthlyNewStudents: 0, students: 0 }}
      loadError={null}
      canReview
      scope="lecturer"
    />
  );
  expect(container.textContent).toContain("今天共有0份作业等待审批");
  expect(container.textContent).toContain("暂无待审作业");
  expect(container.textContent).toMatch(/我的课程数/);
  expect(container.textContent).toContain("1");
});

it("renders the lecturer workbench from the review queue", async () => {
  await render(
    <CourseHomeworkPanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      displayName="Elena"
      initialItems={[row]}
      summary={summary}
      loadError={null}
      canReview
      scope="lecturer"
    />
  );
  expect(container.textContent).toContain("Elena老师");
  expect(container.textContent).toContain("今天共有1份作业等待审批");
  expect(container.textContent).toContain("我的课程数");
  expect(container.textContent).toContain("1,842");
  expect(container.textContent).toContain("本月新增购买人数");
  expect(container.textContent).toContain("第3课：分镜脚本设计");
  expect(container.textContent).toContain("待审核");
  expect(container.textContent).toContain(formatSubmittedAt(row.submittedAt!));
});

it("filters the queue by course", async () => {
  await render(
    <CourseHomeworkPanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      displayName="Elena"
      initialItems={[
        row,
        { ...row, id: "e2", courseId: "99", courseTitle: "叙事课", studentName: "Nova" },
      ]}
      summary={summary}
      loadError={null}
      canReview
      scope="lecturer"
    />
  );
  const course = container.querySelector("select[aria-label='课程']") as HTMLSelectElement;
  await act(async () => {
    course.value = "99";
    course.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("Nova");
  expect(container.textContent).toContain("叙事课");
  expect(container.textContent).not.toContain("Meliantern");
});

it("opens a review dialog with student, homework and scoring fields", async () => {
  await render(
    <CourseHomeworkPanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      displayName="Elena"
      initialItems={[{ ...row, assetIds: ["a1"] }]}
      summary={summary}
      loadError={null}
      canReview
      scope="lecturer"
    />
  );
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "审批")
      ?.click();
  });
  const dialog = container.querySelector("[role='dialog']");
  expect(dialog?.textContent).toContain("作业详情");
  expect(dialog?.textContent).toContain("Meliantern");
  expect(dialog?.textContent).toContain("测试课");
  expect(dialog?.textContent).toContain("提交内容");
  expect(dialog?.textContent).toContain("附件 · 1");
  expect(dialog?.querySelector("input[aria-label='评分']")).toBeTruthy();
  expect(dialog?.textContent).toContain("通过并提交");
  expect(dialog?.textContent).toContain("退回修改");
});
