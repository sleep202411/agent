import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseLearning } from "./learning-ui";
import { TeachingScreen } from "./teaching";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  user: "1",
  course: vi.fn(),
  enroll: vi.fn(),
  submit: vi.fn(),
  review: vi.fn(),
  teaching: vi.fn(),
  summary: vi.fn(),
  attachment: vi.fn(),
  pick: vi.fn(),
  push: vi.fn(),
  login: vi.fn(),
  enrolled: vi.fn(),
}));
vi.mock("./learning-api", () => ({ learningApi: h }));
vi.mock("./homework-upload", () => ({ pickHomework: h.pick }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.user ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.user },
  }),
  useAuthGate: () => ({ openLogin: h.login }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/constants/theme", () => ({ MaxContentWidth: 430 }));
vi.mock("@/features/services/crew-finance-api", () => ({
  formatFinanceMoney: (value: string) => value,
}));
type Box = { children?: ReactNode };
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: Box) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: Box) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: Box) => <div>{children}</div>,
  ScrollView: ({ children }: Box) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Linking: { openURL: vi.fn() },
  Pressable: ({
    children,
    onPress,
    disabled,
  }: Box & { onPress: () => void; disabled: boolean }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    editable,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      readOnly={!editable}
      onInput={(e) => onChangeText(e.currentTarget.value)}
    />
  ),
}));
const row = {
  id: "enrollment",
  courseId: "21",
  studentId: "1",
  teacherId: "2",
  version: 4,
  status: "enrolled",
  priceCredits: "100",
  teacherCredits: "50",
  description: null,
  assetIds: [],
  score: null,
  feedback: null,
  badgeIssuedAt: null,
  createdAt: "2026-10-07",
  studentName: "Student",
  courseTitle: "Course",
};
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () => root.render(<CourseLearning courseId="21" onEnrolled={h.enrolled} />));
const click = (key: string) =>
  act(async () => {
    const button = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === `academyLearning.${key}`
    );
    expect(button).toBeTruthy();
    button!.click();
  });
const input = (key: string, value: string) =>
  act(async () => {
    const field = host.querySelector(
      `input[aria-label="academyLearning.${key}"]`
    ) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.user = "1";
  h.active = true;
  h.course.mockResolvedValue({
    offering: { enabled: true, priceCredits: "100", version: 3, teacherId: "2" },
    enrollment: null,
  });
  h.summary.mockResolvedValue({ courses: 1, students: 1, pending: 1, earnedCredits: "50" });
  h.teaching.mockResolvedValue({
    items: [{ ...row, status: "submitted", description: "Homework" }],
    nextCursor: null,
  });
  h.review.mockResolvedValue({ ...row, status: "approved" });
  h.enroll.mockResolvedValue(row);
  h.submit.mockResolvedValue({ ...row, status: "submitted" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("purchases only on explicit action and refreshes playback after success", async () => {
  await mount();
  expect(h.enroll).not.toHaveBeenCalled();
  await click("enroll");
  expect(h.enroll).toHaveBeenCalledWith("21", 3, expect.any(AbortSignal));
  expect(h.enrolled).toHaveBeenCalledOnce();
});
it("shows purchase errors without granting access", async () => {
  h.enroll.mockRejectedValueOnce(new Error("Insufficient credits"));
  await mount();
  await click("enroll");
  expect(host.textContent).toContain("Insufficient credits");
  expect(h.enrolled).not.toHaveBeenCalled();
});
it("uploads and submits homework with the current enrollment version", async () => {
  h.course.mockResolvedValue({ offering: null, enrollment: row });
  h.pick.mockResolvedValue({ id: "asset", name: "work.pdf" });
  await mount();
  await input("description", "My work");
  await click("add");
  await click("submit");
  expect(h.submit).toHaveBeenCalledWith(
    "enrollment",
    { expectedVersion: 4, description: "My work", assetIds: ["asset"] },
    expect.any(AbortSignal)
  );
});
it("aborts pending uploads and clears drafts on account switch", async () => {
  h.course.mockResolvedValue({ offering: null, enrollment: row });
  let signal: AbortSignal | undefined;
  let finish: ((value: { id: string; name: string }) => void) | undefined;
  h.pick.mockImplementation((value: AbortSignal) => {
    signal = value;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await mount();
  await input("description", "Private draft");
  await click("add");
  h.generation = 2;
  h.user = "3";
  await mount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish?.({ id: "old", name: "old.pdf" }));
  expect(host.textContent).not.toContain("old.pdf");
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
  expect(h.submit).not.toHaveBeenCalled();
});
it("reviews submitted homework only after score and feedback are entered", async () => {
  await act(async () => root.render(<TeachingScreen />));
  await click("review");
  expect(
    [...host.querySelectorAll("button")].find((b) => b.textContent === "academyLearning.approve")!
      .disabled
  ).toBe(true);
  await input("score", "85");
  await input("feedback", "Good work");
  await click("approve");
  expect(h.review).toHaveBeenCalledWith(
    "enrollment",
    { expectedVersion: 4, decision: "approved", score: 85, feedback: "Good work" },
    expect.any(AbortSignal)
  );
});
it("loads teacher pages without duplicating students", async () => {
  h.teaching
    .mockResolvedValueOnce({ items: [row], nextCursor: "cursor" })
    .mockResolvedValueOnce({ items: [row], nextCursor: "cursor" })
    .mockResolvedValueOnce({
      items: [{ ...row, id: "second", studentName: "Second" }],
      nextCursor: null,
    });
  await act(async () => root.render(<TeachingScreen />));
  await click("more");
  expect(h.teaching).toHaveBeenLastCalledWith("cursor", expect.any(AbortSignal));
  expect(host.textContent).toContain("Second");
  expect(
    [...host.querySelectorAll("button")].filter((b) => b.textContent === "academyLearning.review")
  ).toHaveLength(2);
});
it("refreshes badge status automatically while active", async () => {
  vi.useFakeTimers();
  h.course.mockResolvedValue({
    offering: null,
    enrollment: { ...row, status: "approved", badgeIssuedAt: null },
  });
  await mount();
  expect(host.textContent).toContain("academyLearning.badgePending");
  h.course.mockResolvedValue({
    offering: null,
    enrollment: { ...row, status: "approved", badgeIssuedAt: "2026-10-07" },
  });
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(host.textContent).toContain("academyLearning.badgeIssued");
});
