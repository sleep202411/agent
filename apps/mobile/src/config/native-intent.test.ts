import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectSystemPath } from "@/app/+native-intent";

const config = vi.hoisted(() => ({
  appRegion: "global" as "global" | "cn",
  scheme: ["fizzdragon"] as string | string[],
}));
vi.mock("@/config/app-env", () => ({ appEnv: config }));
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      get scheme() {
        return config.scheme;
      },
    },
  },
}));

const token = "a".repeat(32);
const invitationId = "11111111-1111-4111-8111-111111111111";

// Exercise the actual composed router, not individual converters: a later
// converter must preserve an earlier converter's target and invitation context.
for (const region of ["global", "cn"] as const) {
  describe(`${region} incoming links`, () => {
    const site = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
    const studio =
      region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
    const scheme = region === "cn" ? "fizzdragon-cn" : "fizzdragon";
    beforeEach(() => {
      config.appRegion = region;
      config.scheme = [scheme];
    });

    const cases = [
      [
        site,
        `/crew-invite/${token}`,
        `/crew-invite?link=${encodeURIComponent(`${site}/crew-invite/${token}`)}`,
      ],
      [
        studio,
        `/invite/${token}`,
        `/studio-invite?link=${encodeURIComponent(`${studio}/invite/${token}`)}`,
      ],
      [
        studio,
        `/casting/accept?token=${token}`,
        `/casting-invite?link=${encodeURIComponent(`${studio}/casting/accept?token=${token}`)}`,
      ],
      [site, `/crew-invitations/${invitationId}`, `/crew-invitation-response/${invitationId}`],
      [
        site,
        "/messages?tab=recruitment&application=application-1",
        "/crew-applications?application=application-1",
      ],
      [site, "/crews/crew-1/positions/job-1", "/crew-opening?crewId=crew-1&positionId=job-1"],
      [site, "/tags/science-fiction", "/tags/science-fiction"],
      [site, "/ips/gps?selected=ip-1", "/content-gps?selected=ip-1"],
      [site, "/creators/studios?text=Animation&remote=1", "/studios?text=Animation&remote=1"],
    ];
    for (const initial of [true, false]) {
      it.each(cases)(
        `routes %s%s on ${initial ? "cold" : "warm"} entry`,
        (origin, path, expected) => {
          for (const input of [
            `${origin}${path}`,
            `${origin}/zh-HK${path}`,
            path,
            `${scheme}://${path.slice(1)}`,
          ]) {
            expect(redirectSystemPath({ path: input!, initial })).toBe(expected);
          }
          // Expo can provide a single scheme instead of an array.
          config.scheme = scheme;
          expect(redirectSystemPath({ path: `${scheme}://${path!.slice(1)}`, initial })).toBe(
            expected
          );
        }
      );
    }

    it("rejects opposite-region invitations without carrying their tokens forward", () => {
      const otherSite =
        region === "cn" ? "https://fizzdragon.com" : "https://fizzdragon.fizzspace.cn";
      const otherStudio =
        region === "cn" ? "https://studio.fizzdragon.com" : "https://studio.fizzspace.cn";
      for (const [input, expected] of [
        [`${otherSite}/crew-invite/${token}`, "/crew-invite"],
        [`${otherStudio}/invite/${token}`, "/studio-invite"],
        [`${otherStudio}/casting/accept?token=${token}`, "/casting-invite"],
        [`${otherSite}/crew-invitations/${invitationId}`, "/crew-invitation-response/invalid"],
      ])
        expect(redirectSystemPath({ path: input!, initial: true })).toBe(expected);
    });

    it("preserves auth, payment and already-normalized routes byte-for-byte", () => {
      const inputs = [
        "wx123://pay?code=abc&state=123",
        `${scheme}://auth/callback?code=a%2Bb&state=s%2Ft`,
        "/agent?workspace=workspace-1",
        "/paywall?returnTo=%2Fcrews",
        ...cases.map(([, , target]) => target!),
      ];
      for (const path of inputs)
        for (const initial of [true, false])
          expect(redirectSystemPath({ path, initial })).toBe(path);
    });
  });
}
