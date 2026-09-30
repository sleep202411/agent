import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchPositionInvitations,
  fetchPositionInvitation,
  decidePositionInvitation,
  type InvitationPreview,
} from "./position-invitation-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const row: InvitationPreview = {
  id: "00000000-0000-4000-8000-000000000001",
  positionId: "position",
  inviteeUserId: "creator",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  applicationId: null,
  expired: false,
  position: {
    id: "position",
    crewId: "crew",
    taskId: null,
    positionType: "Director",
    description: "Create film",
    experienceLevel: "any",
    requiredSkills: [],
  },
};
const application = {
  id: "application",
  crewId: "crew",
  positionId: "position",
  applicantId: "creator",
  status: "pending",
};
const body = { action: "accept" as const, message: null, portfolioUrl: null };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockResolvedValue(row);
  vi.mocked(api.post).mockResolvedValue(application);
});
it("reads scoped preview", async () => {
  expect(await fetchPositionInvitation(row.id, "creator", signal())).toEqual(row);
});
it.each([
  { inviteeUserId: "foreign" },
  { id: "00000000-0000-4000-8000-000000000002" },
  { positionId: "foreign" },
])("rejects foreign preview %j", async (patch) => {
  vi.mocked(api.get).mockResolvedValue({ ...row, ...patch });
  await expect(fetchPositionInvitation(row.id, "creator", signal())).rejects.toThrow();
});
it("lists recipient invitations", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [row], nextCursor: null });
  expect((await fetchPositionInvitations("creator", null, signal())).items).toHaveLength(1);
});
it.each([
  { items: [row, row], nextCursor: null },
  { items: [{ ...row, inviteeUserId: "foreign" }], nextCursor: null },
  { items: [], nextCursor: row.id },
])("rejects invalid list %j", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchPositionInvitations("creator", null, signal())).rejects.toThrow();
});
it("accepts using the existing application contract", async () => {
  expect(await decidePositionInvitation(row, "creator", 1, body)).toEqual({
    status: "accepted",
    applicationId: "application",
  });
  expect(api.post).toHaveBeenCalledWith(`/crew-position-invitations/${row.id}/accept`, {
    service: "aurora",
    data: { message: null, portfolioUrl: null },
  });
});
it("declines without application payload", async () => {
  vi.mocked(api.post).mockResolvedValue({ id: row.id, status: "declined" });
  expect(await decidePositionInvitation(row, "creator", 1, { action: "decline" })).toEqual({
    status: "declined",
  });
});
it.each([{ crewId: "foreign" }, { positionId: "foreign" }, { applicantId: "foreign" }])(
  "rejects mismatched application %j",
  async (patch) => {
    vi.mocked(api.post).mockResolvedValue({ ...application, ...patch });
    await expect(decidePositionInvitation(row, "creator", 1, body)).rejects.toThrow();
  }
);
it.each([
  { expired: true },
  { status: "revoked" },
  { expiresAt: "2000-01-01T00:00:00Z" },
  { inviteeUserId: "foreign" },
])("rejects unavailable invitation %j", async (patch) => {
  await expect(
    decidePositionInvitation({ ...row, ...patch } as InvitationPreview, "creator", 1, body)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("allows recovery of accepted request after expiry", async () => {
  expect(
    (
      await decidePositionInvitation(
        { ...row, expiresAt: "2000-01-01T00:00:00Z" },
        "creator",
        1,
        body,
        true
      )
    ).status
  ).toBe("accepted");
});
it("rejects unsafe portfolio schemes", async () => {
  await expect(
    decidePositionInvitation(row, "creator", 1, { ...body, portfolioUrl: "javascript:alert(1)" })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks stale session before mutation", async () => {
  h.generation = 2;
  await expect(decidePositionInvitation(row, "creator", 1, body)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects late receipt after account switch", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return application;
  });
  await expect(decidePositionInvitation(row, "creator", 1, body)).rejects.toThrow();
});
