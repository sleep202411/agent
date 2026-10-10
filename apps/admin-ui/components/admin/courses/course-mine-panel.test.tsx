// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminTeachingCourse } from "@/lib/admin-academy-learning";
import { CourseMinePanel, formatSharePercent } from "./course-mine-panel";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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

const item: AdminTeachingCourse = {
  courseId: "14",
  courseTitle: "测试课",
  shareBps: 5000,
  students: 3,
  earnedCredits: "100",
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

it("formats share basis points as a percent", () => {
  expect(formatSharePercent(5000)).toBe("50%");
  expect(formatSharePercent(3333)).toBe("33.3%");
  expect(formatSharePercent(null)).toBe("—");
});

it("lists taught courses with share, students and credits", async () => {
  await render(
    <CourseMinePanel
      siteLabel="FizzDragon.com"
      databaseLabel="国际站生产数据库"
      items={[item]}
      loadError={null}
    />
  );
  expect(container.textContent).toContain("我的课程");
  expect(container.textContent).toContain("测试课");
  expect(container.textContent).toContain("50%");
  expect(container.textContent).toContain("3");
  expect(container.textContent).toContain("100");
});
