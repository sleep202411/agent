import { beforeEach, expect, it, vi } from "vitest";
import {
  acceptStudioInvite,
  canAcceptStudioInvite,
  parseStudioInviteLink,
  previewStudioInvite,
  studioInviteTargetUrl,
  StudioInviteAcceptError,
} from "./studio-invite-accept-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const token = "a".repeat(32),
  id = "11111111-1111-4111-8111-111111111111";
const preview = {
  scope: "workspace" as const,
  targetName: "Team",
  role: "editor" as const,
  status: "pending" as const,
  expiresAt: null,
  existingAccess: null,
};
const target = { scope: "workspace" as const, workspaceId: id, targetName: "Team" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(preview);
  h.post.mockResolvedValue(target);
});
it("parses only Studio links in the build region, including locale routes", () => {
  expect(
    parseStudioInviteLink(`https://studio.fizzdragon.com/en-US/invite/${token}`, "global")
  ).toBe(token);
  expect(parseStudioInviteLink(`https://studio.fizzspace.cn/invite/${token}`, "cn")).toBe(token);
  for (const link of [
    `https://studio.fizzspace.cn/invite/${token}`,
    `https://studio.fizzdragon.com.evil.test/invite/${token}`,
    `https://user@studio.fizzdragon.com/invite/${token}`,
    `http://studio.fizzdragon.com/invite/${token}`,
    `https://studio.fizzdragon.com/invite/${token}?next=evil`,
    `https://studio.fizzdragon.com/invite/${token}#hash`,
  ])
    expect(() => parseStudioInviteLink(link, "global")).toThrow();
});
it("previews permanent invitations and accepts only after fresh review", async () => {
  expect(await previewStudioInvite(token, 1)).toEqual(preview);
  expect(await acceptStudioInvite(token, preview, 1)).toEqual(target);
  expect(h.post).toHaveBeenCalledWith("/invites/accept", { service: "aurora", data: { token } });
});
it.each(["expired", "revoked", "accepted"] as const)("does not accept %s links", async (status) => {
  h.get.mockResolvedValue({ ...preview, status });
  await expect(acceptStudioInvite(token, preview, 1)).rejects.toThrow("no longer");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects elapsed expiry and changed terms", async () => {
  expect(canAcceptStudioInvite({ ...preview, expiresAt: "2000-01-01T00:00:00Z" })).toBe(false);
  h.get.mockResolvedValue({ ...preview, role: "admin" });
  await expect(acceptStudioInvite(token, preview, 1)).rejects.toThrow("changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("opens verified existing access even if the invitation was revoked", async () => {
  h.get.mockResolvedValue({
    ...preview,
    status: "revoked",
    existingAccess: target,
    currentRole: "owner",
  });
  expect(await acceptStudioInvite(token, preview, 1)).toEqual(target);
  expect(h.post).not.toHaveBeenCalled();
});
it("requires another review when existing access disappears", async () => {
  await expect(
    acceptStudioInvite(token, { ...preview, existingAccess: target }, 1)
  ).rejects.toThrow("access changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("stops a preflight after cancellation or account change", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return preview;
  });
  await expect(acceptStudioInvite(token, preview, 1, c.signal)).rejects.toThrow("cancelled");
  h.get.mockImplementation(async () => {
    h.generation++;
    return preview;
  });
  await expect(acceptStudioInvite(token, preview, 1)).rejects.toThrow("session expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("marks a lost receipt uncertain without retrying", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(acceptStudioInvite(token, preview, 1)).rejects.toBeInstanceOf(
    StudioInviteAcceptError
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects inconsistent preview or receipt scopes", async () => {
  h.get.mockResolvedValue({
    ...preview,
    existingAccess: { ...target, scope: "project", projectId: id },
  });
  await expect(previewStudioInvite(token, 1)).rejects.toThrow("scope mismatch");
  h.get.mockResolvedValue(preview);
  h.post.mockResolvedValue({ ...target, scope: "story-project", storyProjectId: id });
  await expect(acceptStudioInvite(token, preview, 1)).rejects.toBeInstanceOf(
    StudioInviteAcceptError
  );
});
it("routes platform targets to the correct regional Studio", () => {
  expect(studioInviteTargetUrl({ ...target, scope: "project", projectId: id }, "cn")).toBe(
    `https://studio.fizzspace.cn/project/${id}?ws=${id}`
  );
});
