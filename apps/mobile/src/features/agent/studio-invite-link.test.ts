import { expect, it } from "vitest";
import { redirectStudioInvite, studioInviteRoute } from "./studio-invite-link";
const token = "a".repeat(32);
const globalLink = `https://studio.fizzdragon.com/invite/${token}`;
const cnLink = `https://studio.fizzspace.cn/invite/${token}`;
it("rewrites regional HTTPS and configured app-scheme invites", () => {
  expect(redirectStudioInvite(globalLink, "global", [])).toBe(
    studioInviteRoute(globalLink, "global")
  );
  expect(redirectStudioInvite(cnLink, "cn", [])).toBe(studioInviteRoute(cnLink, "cn"));
  expect(
    redirectStudioInvite(`fizzdragon-dev://invite/${token}`, "global", ["fizzdragon-dev"])
  ).toBe(studioInviteRoute(globalLink, "global"));
  expect(redirectStudioInvite(`fizzdragon-cn:///invite/${token}`, "cn", ["fizzdragon-cn"])).toBe(
    studioInviteRoute(cnLink, "cn")
  );
});
it("rejects wrong regions and malformed recognized invites without crashing", () => {
  for (const link of [
    cnLink,
    `${globalLink}?token=other`,
    `${globalLink}#x`,
    `https://user@studio.fizzdragon.com/invite/${token}`,
    "https://studio.fizzdragon.com/invite/bad",
  ])
    expect(redirectStudioInvite(link, "global", [])).toBe("/studio-invite");
});
it("handles router-relative invitation paths", () => {
  expect(redirectStudioInvite(`/invite/${token}`, "global", [])).toBe(
    studioInviteRoute(globalLink, "global")
  );
  expect(redirectStudioInvite(`/zh-HK/invite/${token}`, "cn", [])).toBe(
    studioInviteRoute(cnLink, "cn")
  );
});
it("preserves unrelated routes and payment/auth callbacks", () => {
  for (const link of [
    "/",
    "/agent?workspace=x",
    "fizzdragon://ip/123",
    "wx123://pay?code=abc",
    "exp://localhost:8081/--/agent",
    "https://other.test/article",
  ])
    expect(redirectStudioInvite(link, "global", ["fizzdragon"])).toBe(link);
});
