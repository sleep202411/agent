import { beforeEach, expect, it, vi } from "vitest";
import {
  acceptCrewInvite,
  previewCrewInvite,
  CrewInviteAcceptError,
  crewInviteTargetRoute,
} from "./crew-invite-accept-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const token = "a".repeat(32);
const preview = {
  scope: "crew" as const,
  crewId: "crew1",
  targetName: "Team",
  logo: null,
  tagline: null,
  memberCount: 2,
  status: "active" as const,
  expiresAt: null,
};
const target = { scope: "crew" as const, crewId: "crew1", memberId: "member1", targetName: "Team" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(preview);
  h.post.mockResolvedValue(target);
});
it("previews without joining and freshly checks the target before explicit acceptance", async () => {
  expect(await previewCrewInvite(token, 1)).toEqual(preview);
  expect(h.post).not.toHaveBeenCalled();
  expect(await acceptCrewInvite(token, preview, 1)).toEqual(target);
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(h.post).toHaveBeenCalledWith("/invites/accept", {
    service: "aurora",
    data: { token },
    retry: false,
  });
  expect(crewInviteTargetRoute(target)).toBe("/crew-tasks/crew1");
});
it("joins community chat without treating it as Crew membership or trusting server URLs", async () => {
  const p = { ...preview, scope: "crew_community" as const };
  h.get.mockResolvedValue(p);
  h.post.mockResolvedValue({
    scope: p.scope,
    crewId: "crew1",
    conversationId: "chat1",
    targetName: "Team",
    channelHref: "https://evil.test",
  });
  expect(crewInviteTargetRoute(await acceptCrewInvite(token, p, 1))).toBe("/conversation/chat1");
});
it.each(["revoked", "expired", "exhausted"])(
  "does not first join %s invitations",
  async (status) => {
    h.get.mockResolvedValue({ ...preview, status });
    await expect(acceptCrewInvite(token, preview, 1)).rejects.toThrow("no longer");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("allows explicit recovery of an already redeemed exhausted link", async () => {
  h.get.mockResolvedValue({ ...preview, status: "exhausted" });
  expect(await acceptCrewInvite(token, preview, 1, undefined, true)).toEqual(target);
});
it.each([
  { crewId: "other" },
  { scope: "crew_community" },
  { targetName: "Other" },
  { expiresAt: "2099-01-01T00:00:00Z" },
])("requires review of changed invitation %j", async (change) => {
  h.get.mockResolvedValue({ ...preview, ...change });
  await expect(acceptCrewInvite(token, preview, 1)).rejects.toThrow("changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects elapsed expiry and non-Crew previews", async () => {
  h.get.mockResolvedValue({ ...preview, expiresAt: "2000-01-01T00:00:00Z" });
  await expect(
    acceptCrewInvite(token, { ...preview, expiresAt: "2000-01-01T00:00:00Z" }, 1)
  ).rejects.toThrow("no longer");
  h.get.mockResolvedValue({ ...preview, scope: "workspace" });
  await expect(previewCrewInvite(token, 1)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects malformed tokens before network access", async () => {
  await expect(previewCrewInvite("bad", 1)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("stops before a mutation after account change or cancellation", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return preview;
  });
  await expect(acceptCrewInvite(token, preview, 1, c.signal)).rejects.toThrow("cancelled");
  h.get.mockImplementation(async () => {
    h.generation++;
    return preview;
  });
  await expect(acceptCrewInvite(token, preview, 1)).rejects.toThrow("session expired");
  expect(h.post).not.toHaveBeenCalled();
});
it.each([
  { ...target, crewId: "wrong" },
  { ...target, scope: "crew_community", conversationId: "chat1" },
  { ...target, memberId: "../bad" },
])("treats unverifiable receipts as uncertain %j", async (receipt) => {
  h.post.mockResolvedValue(receipt);
  await expect(acceptCrewInvite(token, preview, 1)).rejects.toBeInstanceOf(CrewInviteAcceptError);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("does not retry lost receipts automatically", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(acceptCrewInvite(token, preview, 1)).rejects.toThrow("Lost response");
  expect(h.post).toHaveBeenCalledTimes(1);
});

const taskId = "00000000-0000-4000-8000-000000000001";
const offer = {
  id: taskId,
  version: 3,
  title: "Pilot",
  description: "Storyboard work",
  dueAt: null,
  requiredSkills: ["storyboard"],
  paymentTerms: "half_upfront" as const,
  rewardUsdMinor: 12500,
  profitShareBps: 250,
};
const taskHref = `/crews/crew1/workspace?tab=tasks&task=${taskId}`;
it("preserves reviewed task terms and opens the accepted native task", async () => {
  const p = { ...preview, task: offer };
  h.get.mockResolvedValue(p);
  h.post.mockResolvedValue({ ...target, workspaceHref: taskHref });
  expect((await previewCrewInvite(token, 1)).task).toEqual(offer);
  expect(crewInviteTargetRoute(await acceptCrewInvite(token, p, 1))).toBe(
    `/crew-tasks/crew1?task=${taskId}`
  );
});
it("rejects changed task terms before accepting and mismatched task receipts", async () => {
  const p = { ...preview, task: offer };
  h.get.mockResolvedValue({ ...p, task: { ...offer, rewardUsdMinor: 10000 } });
  await expect(acceptCrewInvite(token, p, 1)).rejects.toThrow("terms changed");
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue(p);
  h.post.mockResolvedValue(target);
  await expect(acceptCrewInvite(token, p, 1)).rejects.toThrow("could not be verified");
});
it("recovers a previously redeemed task without reaccepting different terms", async () => {
  const p = { ...preview, task: offer };
  h.get.mockResolvedValue({ ...preview, status: "exhausted", task: null, acceptedHref: taskHref });
  h.post.mockResolvedValue({ ...target, workspaceHref: taskHref });
  expect(crewInviteTargetRoute(await acceptCrewInvite(token, p, 1, undefined, true))).toContain(
    `task=${taskId}`
  );
});
it("rejects unsafe or foreign task destinations", async () => {
  for (const href of [
    "https://evil.test/crews/crew1/workspace",
    `/crews/other/workspace?tab=tasks&task=${taskId}`,
    `${taskHref}&redirect=evil`,
  ]) {
    h.get.mockResolvedValue({ ...preview, acceptedHref: href });
    await expect(previewCrewInvite(token, 1)).rejects.toThrow();
  }
});
it.each([
  [403, "CREW_QUALIFICATIONS_REQUIRED", true],
  [403, "CREW_ACCESS_DENIED", false],
  [503, "CREW_QUALIFICATIONS_REQUIRED", false],
])("classifies acceptance failure %s/%s", async (status, code, expected) => {
  h.post.mockRejectedValue(Object.assign(new Error("Request rejected"), { status, code }));
  await expect(acceptCrewInvite(token, preview, 1)).rejects.toMatchObject({
    qualificationRequired: expected,
    message: "Request rejected",
  });
});
