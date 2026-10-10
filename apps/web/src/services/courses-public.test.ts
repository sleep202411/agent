import { expect, it } from "vitest";
import {
  matchesPublicCoursePriceRange,
  publicCourseCertificateId,
  publicCoursePriceCredits,
  resolveCertificateIconUrl,
  toPublicCertificate,
} from "./courses-public";

it("treats unconfigured or disabled courses as free", () => {
  expect(publicCoursePriceCredits({})).toBeNull();
  expect(publicCoursePriceCredits({ enrollmentEnabled: false, priceCredits: 200 })).toBeNull();
  expect(publicCoursePriceCredits({ enrollmentEnabled: true, priceCredits: 0 })).toBeNull();
});

it("reads the list price when enrollment is enabled", () => {
  expect(publicCoursePriceCredits({ enrollmentEnabled: true, priceCredits: 200 })).toBe(200);
  expect(publicCoursePriceCredits({ enrollmentEnabled: 1, priceCredits: "500" })).toBe(500);
});

it("filters catalog rows by free versus credit ranges", () => {
  expect(matchesPublicCoursePriceRange(null, null)).toBe(true);
  expect(matchesPublicCoursePriceRange(null, "free")).toBe(true);
  expect(matchesPublicCoursePriceRange(200, "free")).toBe(false);
  expect(matchesPublicCoursePriceRange(200, "100-300")).toBe(true);
  expect(matchesPublicCoursePriceRange(500, "500+")).toBe(true);
  expect(matchesPublicCoursePriceRange(40, "100-300")).toBe(false);
});

it("reads a skill certificate id only when it is a positive integer", () => {
  expect(publicCourseCertificateId({})).toBeNull();
  expect(publicCourseCertificateId({ certificateId: 0 })).toBeNull();
  expect(publicCourseCertificateId({ certificateId: 14 })).toBe(14);
  expect(publicCourseCertificateId({ certificateId: "14" })).toBe(14);
});

it("resolves assigned certificate artwork against the static CDN", () => {
  expect(resolveCertificateIconUrl(null)).toBe("");
  expect(resolveCertificateIconUrl("static/ai.png")).toBe(
    "https://static.fizzspace.cn/static/ai.png"
  );
  expect(resolveCertificateIconUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  expect(toPublicCertificate({ id: 14, name: "Director", imagePath: "static/ai.png" })).toEqual({
    id: 14,
    name: "Director",
    imagePath: "static/ai.png",
    iconUrl: "https://static.fizzspace.cn/static/ai.png",
  });
  expect(toPublicCertificate({ id: 0, name: "Director" })).toBeNull();
});
