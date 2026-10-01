import { expect, it } from "vitest";
import type { AiObjectSchema } from "@repo/shared";
import { prepareFormValues } from "./form-values";
import { deriveInitialValues, fieldDescriptors, readOptions } from "./schema";
const schema: AiObjectSchema = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 2 },
    seed: { type: "integer", minimum: 0, maximum: 20 },
    references: { type: "array", items: { type: "string", format: "uri" }, maxItems: 2 },
    enabled: { type: "boolean", default: false },
    hidden: { type: "string", const: "fixed", "x-ui": { control: "hidden" } },
  },
};
it("preserves zero/false/constants and parses raw draft strings only at submit", () => {
  const raw = {
    ...deriveInitialValues(schema),
    prompt: "Lake",
    seed: "0",
    references: "https://one.test/a\nhttps://two.test/b\n",
  };
  expect(prepareFormValues(schema, raw)).toEqual({
    prompt: "Lake",
    seed: 0,
    references: ["https://one.test/a", "https://two.test/b"],
    enabled: false,
    hidden: "fixed",
  });
  expect(raw.references.endsWith("\n")).toBe(true);
});
it("rejects truncated numeric strings and invalid/insecure reference schemes", () => {
  for (const seed of ["1.5", "3junk", "Infinity", "-1", "21"])
    expect(() => prepareFormValues(schema, { prompt: "Lake", seed })).toThrow();
  expect(() =>
    prepareFormValues(schema, { prompt: "Lake", references: "file:///private/photo" })
  ).toThrow();
  expect(() => prepareFormValues(schema, { prompt: "" })).toThrow();
});
it("uses declared conditional visibility, enablement, options and cross-field constraints", () => {
  const conditional: AiObjectSchema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["text", "image"] },
      ref: {
        type: "string",
        "x-ui": {
          visibleWhen: { field: "mode", operator: "equals", value: "image" },
          enabledWhen: { field: "mode", operator: "equals", value: "image" },
        },
      },
    },
    "x-rules": [
      {
        when: { field: "mode", operator: "equals", value: "image" },
        id: "reference-required",
        effect: "require",
        fields: ["ref"],
        message: "Reference required",
      },
    ],
  };
  expect(fieldDescriptors(conditional, { mode: "text" }).map((f) => f.name)).toEqual(["mode"]);
  expect(readOptions(conditional.properties.mode!)).toHaveLength(2);
  expect(() => prepareFormValues(conditional, { mode: "image" })).toThrow("Reference required");
});
