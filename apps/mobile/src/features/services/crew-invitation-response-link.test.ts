import { expect, it, vi } from "vitest";
import { redirectCrewInvitationResponse } from "./crew-invitation-response-link";
import { redirectSystemPath } from "@/app/+native-intent";
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "fizzdragon-dev" } } }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
const id = "abcdef12-3456-4789-8abc-123456789abc";
const route = `/crew-invitation-response/${id}`;
const invalid = "/crew-invitation-response/invalid";
it.each(["global", "cn"] as const)("handles localized regional links in %s", (region) => {
  const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  for (const locale of ["", "/en-US", "/zh-CN", "/zh-HK"])
    for (const suffix of ["", "/"])
      expect(
        redirectCrewInvitationResponse(
          `${origin}${locale}/crew-invitations/${id}${suffix}`,
          region,
          []
        )
      ).toBe(route);
});
it("rewrites relative and configured app-scheme paths, normalizing UUID case", () => {
  for (const input of [
    `/crew-invitations/${id}`,
    `/zh-HK/crew-invitations/${id.toUpperCase()}`,
    `fizzdragon-dev://crew-invitations/${id}`,
    `fizzdragon-dev:///crew-invitations/${id}`,
  ])
    expect(redirectCrewInvitationResponse(input, "global", ["fizzdragon-dev"])).toBe(route);
});
it.each([
  `https://fizzdragon.fizzspace.cn/crew-invitations/${id}`,
  `http://fizzdragon.com/crew-invitations/${id}`,
  `https://foreign.test/crew-invitations/${id}`,
  `https://user:password@fizzdragon.com/crew-invitations/${id}`,
  `https://fizzdragon.com:444/crew-invitations/${id}`,
  `https://fizzdragon.com/crew-invitations/${id}?other=1`,
  `https://fizzdragon.com/crew-invitations/${id}#fragment`,
  `https://fizzdragon.com/crew-invitations/${id}/more`,
  `https://fizzdragon.com/%63rew-invitations/${id}`,
  `/crew-invitations/%61bcdef12-3456-4789-8abc-123456789abc`,
  `/crew-invitations/${id}\n`,
  `/crew-invitations/${id}\\more`,
  `/crew-invitations/bad`,
  `/crew-invitations/`,
  `fizzdragon-dev://user@crew-invitations/${id}`,
  `fizzdragon-dev://crew-invitations:444/${id}`,
  `fizzdragon-dev://crew-invitations/${id}?other=1`,
  `unknown://crew-invitations/${id}`,
])("rejects unsafe or out-of-region recognized links: %s", (input) => {
  expect(redirectCrewInvitationResponse(input, "global", ["fizzdragon-dev"])).toBe(invalid);
});
it("does not rewrite unrelated navigation or auth/payment callbacks", () => {
  for (const input of [
    "/",
    "/crew-tasks/crew",
    `/crew-invitation-response/${id}`,
    "/crew-invite/" + "a".repeat(32),
    "wx123://pay?code=abc",
    `/login?returnTo=/crew-invitations/${id}`,
    `fizzdragon-dev://auth?returnTo=/crew-invitations/${id}`,
    "https://foreign.test/article",
  ])
    expect(redirectCrewInvitationResponse(input, "global", ["fizzdragon-dev"])).toBe(input);
});
it("uses the acceptance route through the real native-intent composition", () => {
  expect(
    redirectSystemPath({
      path: `https://fizzdragon.com/en-US/crew-invitations/${id}`,
      initial: true,
    })
  ).toBe(route);
  expect(
    redirectSystemPath({ path: `fizzdragon-dev://crew-invitations/${id}`, initial: false })
  ).toBe(route);
  expect(redirectSystemPath({ path: "wx123://pay?code=abc", initial: true })).toBe(
    "wx123://pay?code=abc"
  );
});
