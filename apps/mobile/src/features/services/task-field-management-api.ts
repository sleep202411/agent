import { z } from "zod";
import { api } from "@/lib/api-client";
import { customField } from "./task-custom-fields-api";
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const option = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();
const options = z
  .array(option)
  .max(50)
  .refine((rows) => new Set(rows.map((o) => o.id)).size === rows.length, "Duplicate option IDs");
const definitionBase = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240),
    type: customField.shape.type,
    required: z.boolean(),
    options,
  })
  .strict();
export const fieldDefinitionInput = definitionBase.refine(
  (v) => ["single_select", "multi_select"].includes(v.type) || v.options.length === 0,
  "Only select fields can have options"
);
export const managedField = customField.extend({
  description: z.string(),
  options,
  updatedAt: z.string().datetime({ offset: true }),
});
export type ManagedField = z.infer<typeof managedField>;
export type FieldDefinitionInput = z.infer<typeof fieldDefinitionInput>;
const editInput = definitionBase
  .omit({ type: true })
  .partial()
  .extend({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), "No field changes");
export async function fetchManagedFields(crewId: string, signal: AbortSignal) {
  crew.parse(crewId);
  const { fields } = z.object({ fields: z.array(managedField) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/task-project`, {
      service: "aurora",
      signal,
    })
  );
  if (
    fields.some((f) => f.crewId !== crewId) ||
    new Set(fields.map((f) => f.id)).size !== fields.length
  )
    throw new Error("Custom field scope mismatch");
  return fields;
}
function matches(field: ManagedField, input: FieldDefinitionInput) {
  return (
    field.name === input.name &&
    field.description === input.description &&
    field.type === input.type &&
    field.required === input.required &&
    field.options.length === input.options.length &&
    field.options.every(
      (o, i) =>
        o.id === input.options[i]!.id &&
        o.label === input.options[i]!.label &&
        o.color === input.options[i]!.color
    )
  );
}
export async function createFieldDefinition(crewId: string, input: FieldDefinitionInput) {
  crew.parse(crewId);
  const data = fieldDefinitionInput.parse(input);
  const result = managedField.parse(
    await api.post(`/crews/${encodeURIComponent(crewId)}/task-fields`, { service: "aurora", data })
  );
  if (result.crewId !== crewId || !matches(result, data))
    throw new Error(
      "Field creation acknowledgement mismatch. Refresh settings before trying again."
    );
  return result;
}
export async function updateFieldDefinition(field: ManagedField, input: z.infer<typeof editInput>) {
  const snapshot = managedField.parse(field);
  const data = editInput.parse(input);
  if (data.expectedUpdatedAt !== snapshot.updatedAt)
    throw new Error("Refresh this field before editing.");
  const expected = fieldDefinitionInput.parse({
    name: snapshot.name,
    description: snapshot.description,
    type: snapshot.type,
    required: snapshot.required,
    options: snapshot.options,
    ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== "expectedUpdatedAt")),
  });
  const result = managedField.parse(
    await api.patch(`/crew-task-fields/${snapshot.id}`, { service: "aurora", data })
  );
  if (result.id !== snapshot.id || result.crewId !== snapshot.crewId || !matches(result, expected))
    throw new Error("Field update acknowledgement mismatch. Refresh settings before trying again.");
  return result;
}
export async function deleteFieldDefinition(field: ManagedField) {
  const snapshot = managedField.parse(field);
  // This server route has no timestamp precondition. UI confirmation must precede this call.
  await api.delete(`/crew-task-fields/${snapshot.id}`, { service: "aurora" });
}
/** Match Web: comma-separated unique labels; retain IDs and colors for unchanged labels. */
export function fieldOptionsFromLabels(
  text: string,
  previous: ManagedField["options"],
  makeId: () => string
) {
  const labels = [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
  return options.parse(
    labels.map((label) => previous.find((o) => o.label === label) ?? { id: makeId(), label })
  );
}
