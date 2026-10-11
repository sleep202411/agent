import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchApplicationInterview,
  updateApplicationInterview,
  type InterviewUpdate,
} from "./application-interview-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const body: InterviewUpdate = {
  expectedVersion: 1,
  requestKey: "00000000-0000-4000-8000-000000000001",
  action: "confirm",
  message: "Yes",
};
const row = {
  id: "00000000-0000-4000-8000-000000000002",
  applicationId: "app",
  version: 2,
  requestKey: body.requestKey,
  actorUserId: "creator",
  action: "confirm",
  state: "confirmed",
  scheduledAt: "2026-10-01T12:00:00Z",
  message: "Yes",
  createdAt: "2026-09-30T12:00:00Z",
};
const page = {
  applicationStatus: "pending",
  canUpdate: true,
  canMessage: true,
  version: 2,
  state: "confirmed",
  scheduledAt: row.scheduledAt,
  items: [row],
  nextBeforeVersion: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockResolvedValue(page);
  vi.mocked(api.post).mockResolvedValue(row);
});
it("loads scoped current history", async () => {
  expect(await fetchApplicationInterview("app", null, signal())).toEqual(page);
});
it.each([
  { items: [{ ...row, applicationId: "other" }] },
  { items: [row, row] },
  { items: [] },
  { state: "cancelled" },
  { canUpdate: false },
  { nextBeforeVersion: 1 },
])("rejects inconsistent history %j", async (patch) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, ...patch });
  await expect(fetchApplicationInterview("app", null, signal())).rejects.toThrow();
});
it("rejects cursor overlap", async () => {
  await expect(fetchApplicationInterview("app", 2, signal())).rejects.toThrow();
});
it("writes exact version and request key", async () => {
  expect(await updateApplicationInterview("app", "creator", 1, body)).toEqual(row);
  expect(api.post).toHaveBeenCalledWith("/applications/app/interview", {
    service: "aurora",
    data: body,
  });
});
it.each([
  { applicationId: "other" },
  { actorUserId: "other" },
  { version: 3 },
  { message: "Different" },
  { state: "proposed" },
  { requestKey: row.id },
])("rejects mismatched receipt %j", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...row, ...patch });
  await expect(updateApplicationInterview("app", "creator", 1, body)).rejects.toThrow();
});
it("rejects stale session before write", async () => {
  h.generation = 2;
  await expect(updateApplicationInterview("app", "creator", 1, body)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("discards receipts after account change", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return row;
  });
  await expect(updateApplicationInterview("app", "creator", 1, body)).rejects.toThrow();
});

it("verifies a scheduling receipt time and proposed state", async () => {
  const input = { ...body, action: "schedule" as const, scheduledAt: "2099-01-01T00:00:00Z" };
  vi.mocked(api.post).mockResolvedValue({
    ...row,
    action: "schedule",
    state: "proposed",
    scheduledAt: "2099-01-01T00:00:00.000Z",
  });
  await expect(updateApplicationInterview("app", "creator", 1, input)).resolves.toMatchObject({
    state: "proposed",
  });
  vi.mocked(api.post).mockResolvedValue({
    ...row,
    action: "schedule",
    state: "proposed",
    scheduledAt: "2099-01-02T00:00:00Z",
  });
  await expect(updateApplicationInterview("app", "creator", 1, input)).rejects.toThrow();
});
it("rejects missing schedule time and extraneous time on other actions", async () => {
  await expect(
    updateApplicationInterview("app", "creator", 1, { ...body, action: "schedule" })
  ).rejects.toThrow();
  await expect(
    updateApplicationInterview("app", "creator", 1, {
      ...body,
      scheduledAt: "2099-01-01T00:00:00Z",
    })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("requires a completed receipt for completion", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...row, action: "complete", state: "confirmed" });
  await expect(
    updateApplicationInterview("app", "creator", 1, { ...body, action: "complete" })
  ).rejects.toThrow();
});

it.each([true, false])(
  "accepts server messaging permission for approved applicants: %s",
  async (canMessage) => {
    vi.mocked(api.get).mockResolvedValue({
      ...page,
      applicationStatus: "approved",
      canUpdate: false,
      canMessage,
    });
    await expect(fetchApplicationInterview("app", null, signal())).resolves.toMatchObject({
      canUpdate: false,
      canMessage,
    });
  }
);
it.each([
  { applicationStatus: "rejected", canUpdate: false, canMessage: true },
  { canMessage: false },
  { canMessage: undefined },
])("rejects inconsistent or missing messaging permission %j", async (patch) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, ...patch });
  await expect(fetchApplicationInterview("app", null, signal())).rejects.toThrow();
});
