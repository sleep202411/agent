import { expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { crewApplicationError } from "./crew-qualification-error";
import en from "@/i18n/messages/en-US.json";
import cn from "@/i18n/messages/zh-CN.json";
import hk from "@/i18n/messages/zh-HK.json";
const body = {
  code: "CREW_QUALIFICATIONS_REQUIRED",
  requiredFdRank: 3,
  missingSkills: ["Editing", "Lighting"],
};
it.each([en, cn, hk])(
  "explains authoritative missing skills and FD rank in the selected locale",
  (messages) => {
    const t = (key: keyof typeof en) => messages[key];
    const message = crewApplicationError(
      new ApiRequestError("HTTP_403", "Upstream eligibility detail", 403, JSON.stringify(body)),
      t
    );
    expect(message).toContain("Upstream eligibility detail");
    expect(message).toContain("Editing, Lighting");
    expect(message).toContain(messages["crewSkills.minimumRank"].replace("{rank}", "3"));
    expect(message).toContain(messages["crewSkills.qualificationHint"]);
  }
);
it("does not reinterpret unrelated or malformed denials or expose arbitrary response fields", () => {
  for (const response of [
    "not json",
    JSON.stringify({ ...body, code: "FORBIDDEN" }),
    JSON.stringify({ ...body, requiredFdRank: "3" }),
    JSON.stringify({ ...body, missingSkills: [123] }),
  ]) {
    expect(
      crewApplicationError(
        new ApiRequestError("HTTP_403", "Original detail", 403, response),
        (k) => en[k]
      )
    ).toBe("Original detail");
  }
  expect(
    crewApplicationError(
      new ApiRequestError("HTTP_503", "Retry later", 503, JSON.stringify(body)),
      (k) => en[k]
    )
  ).toBe("Retry later");
});
it("retains ordinary errors and avoids inventing a rank requirement", () => {
  expect(crewApplicationError(new Error("Network unavailable"), (k) => en[k])).toBe(
    "Network unavailable"
  );
  const text = crewApplicationError(
    new ApiRequestError(
      "HTTP_403",
      "Missing skill",
      403,
      JSON.stringify({ ...body, requiredFdRank: 0 })
    ),
    (k) => en[k]
  );
  expect(text).not.toContain("Required FD level:");
  expect(text).toContain("Editing");
});

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/config", () => ({
  appEnv: {
    appVariant: "production",
    api: {
      contentBaseUrl: "https://fixture.invalid",
      studioBaseUrl: "https://fixture.invalid",
      auroraBaseUrl: "https://fixture.invalid",
    },
  },
}));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
