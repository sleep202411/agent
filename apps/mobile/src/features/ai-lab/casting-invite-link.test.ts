import { expect, it } from "vitest";
import {
  castingInviteRoute,
  parseCastingInviteLink,
  redirectCastingInvite,
} from "./casting-invite-link";
const token = "a".repeat(32),
  link = `https://studio.fizzdragon.com/casting/accept?token=${token}`;
it("routes regional and localized links while preserving the invitation", () => {
  expect(parseCastingInviteLink(link, "global")).toBe(token);
  expect(parseCastingInviteLink(link.replace("/casting/", "/zh-HK/casting/"), "global")).toBe(
    token
  );
  expect(redirectCastingInvite(link, "global", [])).toBe(castingInviteRoute(link, "global"));
  expect(redirectCastingInvite(`/casting/accept?token=${token}`, "global", [])).toBe(
    castingInviteRoute(link, "global")
  );
  expect(
    redirectCastingInvite(`fizzdragon://casting/accept?token=${token}`, "global", ["fizzdragon"])
  ).toBe(castingInviteRoute(link, "global"));
  expect(redirectCastingInvite(link, "cn", [])).toBe("/casting-invite");
});
it.each([
  link + "&token=" + token,
  link + "&redirect=evil",
  link + "#other",
  link.replace("https:", "http:"),
  link.replace("studio.", "user@studio."),
  link.replace(".com/", ".com.evil/"),
  link + "\\",
  link.replace(token, "bad"),
])("rejects malformed or untrusted links: %s", (value) =>
  expect(() => parseCastingInviteLink(value, "global")).toThrow()
);
it("leaves payments, membership invitations and unrelated content intact", () => {
  for (const path of [
    "/studio-invite?link=abc",
    "fizzdragon://payment/success",
    "/agent",
    "https://example.test/casting/accept?token=abc",
  ])
    expect(redirectCastingInvite(path, "global", ["fizzdragon"])).toBe(path);
});
