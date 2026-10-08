import { expect, it } from "vitest";
import { AppearanceDesignRequestSchema, AppearanceDesignResultSchema } from "./index.js";

const request = {
  requestId: "135b85a7-1c82-4b1f-8f7c-fbc174f19ea2",
  locale: "en-US",
  prompt: "Center the choices",
  appearance: { version: 1 },
  context: { title: "A story", choiceLabels: ["Continue"] },
  history: [],
};

it("accepts the existing Studio authoring payload without Agent OS metadata", () => {
  expect(AppearanceDesignRequestSchema.parse(request)).toEqual(request);
});

it("rejects execution identities and host paths outside the authoring contract", () => {
  expect(
    AppearanceDesignRequestSchema.safeParse({ ...request, runId: "other-runtime" }).success
  ).toBe(false);
  expect(
    AppearanceDesignRequestSchema.safeParse({
      ...request,
      context: { ...request.context, cwd: "/etc" },
    }).success
  ).toBe(false);
});

it("rejects an empty success result and accepts an explicit native-menu restoration", () => {
  const result = { requestId: request.requestId, appearance: request.appearance, message: "Done" };
  expect(AppearanceDesignResultSchema.safeParse(result).success).toBe(false);
  expect(AppearanceDesignResultSchema.parse({ ...result, gameUi: null }).gameUi).toBeNull();
});
