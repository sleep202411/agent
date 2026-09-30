import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createTaskCycle,
  cycleChanges,
  cycleDateText,
  deleteTaskCycle,
  fetchManagedCycles,
  managedCycle,
  parseCycleDate,
  updateTaskCycle,
} from "./task-cycle-management-api";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = {
  name: "Sprint",
  goal: "Finish shots",
  startAt: "2026-10-01T08:12:15.123Z",
  endAt: "2026-10-05T09:13:16.456Z",
};
const cycle = () =>
  managedCycle.parse({
    ...input,
    id: uid(1),
    crewId: "crew",
    number: 1,
    status: "planned",
    updatedAt: "2026-09-30T00:00:00.000Z",
  });
const read = () => fetchManagedCycles("crew", "1", 1, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.get).mockResolvedValue({ cycles: [cycle()] });
  vi.mocked(api.post).mockResolvedValue({ ...cycle(), id: uid(2), number: 2 });
  vi.mocked(api.patch).mockImplementation(async (_path, options) => ({
    ...cycle(),
    ...(options?.data as object),
    updatedAt: "2026-09-30T00:00:01.000Z",
  }));
  vi.mocked(api.delete).mockResolvedValue(undefined);
});
it.each(["2026-10-01", "2026-03-08", "2026-11-01"])(
  "creates full local calendar-day boundaries for %s",
  (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const start = new Date(parseCycleDate(value, false));
    const end = new Date(parseCycleDate(value, true));
    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    ]).toEqual([year, month! - 1, day, 0, 0, 0, 0]);
    expect([
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
      end.getSeconds(),
      end.getMilliseconds(),
    ]).toEqual([year, month! - 1, day, 23, 59, 59, 999]);
  }
);
it.each([
  "",
  "2026-02-29",
  "2026-04-31",
  "2026-13-01",
  "2026-00-01",
  "2026-10-00",
  "01/10/2026",
  "2026-1-1",
])("rejects invalid date %s", (date) => {
  expect(() => parseCycleDate(date, false)).toThrow();
});
it("accepts leap days and preserves exact unchanged timestamps", () => {
  expect(cycleDateText(parseCycleDate("2028-02-29", true))).toBe("2028-02-29");
  expect(parseCycleDate(cycleDateText(input.startAt), false, input.startAt)).toBe(input.startAt);
  expect(parseCycleDate(cycleDateText(input.endAt), true, input.endAt)).toBe(input.endAt);
});
it("reads scoped cycles", async () => {
  expect(await read()).toEqual([cycle()]);
});
it.each(["scope", "id", "number"])("rejects invalid %s in project", async (mode) => {
  const other = { ...cycle(), id: uid(2), number: 2 };
  if (mode === "scope") other.crewId = "other";
  if (mode === "id") other.id = uid(1);
  if (mode === "number") other.number = 1;
  vi.mocked(api.get).mockResolvedValue({ cycles: [cycle(), other] });
  await expect(read()).rejects.toThrow("scope mismatch");
});
it("requires manager permission before reads or writes", async () => {
  h.access.mockResolvedValue({ canManage: false });
  await expect(createTaskCycle("crew", "1", 1, input)).rejects.toThrow("permission");
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it("creates planned cycles without sending server-owned number or status", async () => {
  await createTaskCycle("crew", "1", 1, input);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/task-cycles", {
    service: "aurora",
    data: input,
  });
});
it.each(["status", "number", "scope", "dates"])("rejects wrong create receipt %s", async (mode) => {
  const receipt = { ...cycle(), id: uid(2), number: 2 };
  if (mode === "status") receipt.status = "active";
  if (mode === "number") receipt.number = 1;
  if (mode === "scope") receipt.crewId = "other";
  if (mode === "dates") receipt.endAt = "2026-10-06T00:00:00.000Z";
  vi.mocked(api.post).mockResolvedValue(receipt);
  await expect(createTaskCycle("crew", "1", 1, input)).rejects.toThrow("could not be verified");
});
it("sends only changed fields with the captured timestamp", async () => {
  await updateTaskCycle(cycle(), "1", 1, { ...input, status: "active" });
  expect(api.patch).toHaveBeenCalledWith(`/crew-task-cycles/${uid(1)}`, {
    service: "aurora",
    data: { status: "active", expectedUpdatedAt: cycle().updatedAt },
  });
});
it("treats equivalent offsets as unchanged and skips no-op writes", async () => {
  const settings = {
    ...input,
    startAt: "2026-10-01T16:12:15.123+08:00",
    status: "planned" as const,
  };
  expect(cycleChanges(cycle(), settings)).toEqual({});
  await updateTaskCycle(cycle(), "1", 1, settings);
  expect(api.patch).not.toHaveBeenCalled();
});
it("surfaces server active-cycle and version conflicts without retry", async () => {
  vi.mocked(api.patch).mockRejectedValue(
    new Error('Complete the active cycle "Other" before starting another.')
  );
  await expect(updateTaskCycle(cycle(), "1", 1, { ...input, status: "active" })).rejects.toThrow(
    "Other"
  );
  expect(api.patch).toHaveBeenCalledOnce();
});
it.each(["version", "number", "status"])("rejects incorrect update %s receipt", async (mode) => {
  const receipt = { ...cycle(), status: "active", updatedAt: "2026-09-30T00:00:01.000Z" };
  if (mode === "version") receipt.updatedAt = cycle().updatedAt;
  if (mode === "number") receipt.number = 2;
  if (mode === "status") receipt.status = "planned";
  vi.mocked(api.patch).mockResolvedValue(receipt);
  await expect(updateTaskCycle(cycle(), "1", 1, { ...input, status: "active" })).rejects.toThrow(
    "could not be verified"
  );
});
it("deletes only the cycle after checking the latest snapshot", async () => {
  await deleteTaskCycle(cycle(), "1", 1);
  expect(api.delete).toHaveBeenCalledExactlyOnceWith(`/crew-task-cycles/${uid(1)}`, {
    service: "aurora",
  });
});
it.each(["missing", "version", "status"])("rejects deleting %s cycle", async (mode) => {
  const fresh = cycle();
  if (mode === "version") fresh.updatedAt = "2026-09-30T00:00:01.000Z";
  if (mode === "status") fresh.status = "active";
  vi.mocked(api.get).mockResolvedValue({ cycles: mode === "missing" ? [] : [fresh] });
  await expect(deleteTaskCycle(cycle(), "1", 1)).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("does not retry uncertain creation or swallow deletion failure", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(createTaskCycle("crew", "1", 1, input)).rejects.toThrow("Connection lost");
  expect(api.post).toHaveBeenCalledOnce();
  vi.mocked(api.delete).mockRejectedValue(new Error("Not found"));
  await expect(deleteTaskCycle(cycle(), "1", 1)).rejects.toThrow("Not found");
});
it("guards account changes before and after writes", async () => {
  h.access.mockImplementation(async () => {
    h.generation++;
    return { canManage: true };
  });
  await expect(createTaskCycle("crew", "1", 1, input)).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  vi.mocked(api.delete).mockImplementation(async () => {
    h.generation++;
  });
  await expect(deleteTaskCycle(cycle(), "1", 1)).rejects.toThrow("expired");
});
it.each([
  { name: " " },
  { goal: "x".repeat(2001) },
  { name: "x".repeat(101) },
  { endAt: input.startAt },
  { endAt: "2026-09-01T00:00:00Z" },
])("rejects invalid dates/fields %j before network", async (change) => {
  await expect(createTaskCycle("crew", "1", 1, { ...input, ...change })).rejects.toThrow();
  expect(h.access).not.toHaveBeenCalled();
});
