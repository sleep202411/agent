import { expect, it } from "vitest";
import { overlayCertificateCatalogue } from "./course-certificate-catalogue";

it("replaces a filtered Nest catalogue with the full Java level list", () => {
  expect(
    overlayCertificateCatalogue(
      {
        courseId: "42",
        certificateId: 1,
        version: 0,
        certificates: [{ id: 13, name: "AI制片人" }],
      },
      [
        { id: 13, name: "AI制片人" },
        { id: 1, name: "FD-I · 附属创作者" },
        { id: 20, name: "荣誉认证" },
      ]
    )
  ).toEqual({
    courseId: "42",
    certificateId: 1,
    version: 0,
    certificates: [
      { id: 1, name: "FD-I · 附属创作者" },
      { id: 13, name: "AI制片人" },
      { id: 20, name: "荣誉认证" },
    ],
  });
});

it("keeps the Nest catalogue when Java returns no levels", () => {
  const mapping = {
    certificates: [{ id: 13, name: "AI制片人" }],
  };
  expect(overlayCertificateCatalogue(mapping, [])).toBe(mapping);
});
