import { expect, it } from "vitest";
import { redirectCrewInvite, crewInviteRoute } from "./crew-invite-link";
const token = "a".repeat(32);
const globalLink = `https://fizzdragon.com/crew-invite/${token}`;
const cnLink = `https://fizzdragon.fizzspace.cn/crew-invite/${token}`;
it("rewrites regional HTTPS and configured app-scheme invites", () => {
  expect(redirectCrewInvite(globalLink, "global", [])).toBe(crewInviteRoute(globalLink, "global"));
  expect(redirectCrewInvite(cnLink, "cn", [])).toBe(crewInviteRoute(cnLink, "cn"));
  expect(
    redirectCrewInvite(`fizzdragon-dev://crew-invite/${token}`, "global", ["fizzdragon-dev"])
  ).toBe(crewInviteRoute(globalLink, "global"));
  expect(redirectCrewInvite(`fizzdragon-cn:///crew-invite/${token}`, "cn", ["fizzdragon-cn"])).toBe(
    crewInviteRoute(cnLink, "cn")
  );
});
it("rejects wrong regions and malformed recognized invites without crashing", () => {
  for (const link of [
    cnLink,
    `${globalLink}?token=other`,
    `${globalLink}#x`,
    `https://user@fizzdragon.com/crew-invite/${token}`,
    "https://fizzdragon.com/crew-invite/bad",
  ])
    expect(redirectCrewInvite(link, "global", [])).toBe("/crew-invite");
});
it("handles router-relative invitation paths", () => {
  expect(redirectCrewInvite(`/crew-invite/${token}`, "global", [])).toBe(
    crewInviteRoute(globalLink, "global")
  );
  expect(redirectCrewInvite(`/zh-HK/crew-invite/${token}`, "cn", [])).toBe(
    crewInviteRoute(cnLink, "cn")
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
    expect(redirectCrewInvite(link, "global", ["fizzdragon"])).toBe(link);
});
