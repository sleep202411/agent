import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskDetailSchema, type TaskDetail } from "./task-detail-api";
import { customField, type CustomField, type CustomValue } from "./task-custom-fields-api";
export function normalizeCustomValue(field: CustomField, value: CustomValue): CustomValue {
  customField.parse(field);
  let result: CustomValue = value;
  if (typeof value === "string" && !value.trim()) result = null;
  if (Array.isArray(value) && !value.length) result = null;
  if (result === null) {
    if (field.required) throw new Error("This field is required.");
    return null;
  }
  const invalid = () => {
    throw new Error("Enter a valid value for this field.");
  };
  switch (field.type) {
    case "text":
      return z.string().trim().min(1).max(4000).parse(result);
    case "number":
      if (typeof result !== "number" && typeof result !== "string") return invalid();
      return z.number().finite().parse(Number(result));
    case "checkbox":
      return z.boolean().parse(result);
    case "date": {
      const date = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(result);
      const stamp = Date.parse(`${date}T00:00:00.000Z`);
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date)
        return invalid();
      return date;
    }
    case "single_select": {
      const id = z.string().parse(result);
      if (!field.options.some((o) => o.id === id)) return invalid();
      return id;
    }
    case "multi_select": {
      const ids = z.array(z.string().max(128)).max(50).parse(result);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !field.options.some((o) => o.id === id))
      )
        return invalid();
      return ids;
    }
    case "user":
      return z.string().trim().min(1).max(64).parse(result);
  }
}
export async function updateCustomField(task: TaskDetail, field: CustomField, draft: CustomValue) {
  z.string().uuid().parse(task.id);
  z.number().int().positive().parse(task.version);
  if (field.crewId !== task.crewId || ["approved", "cancelled"].includes(task.status))
    throw new Error("This task cannot be edited.");
  const value = normalizeCustomValue(field, draft);
  const result = taskDetailSchema
    .extend({
      customFieldValues: z.array(z.object({ fieldId: z.string().uuid(), value: z.unknown() })),
    })
    .parse(
      await api.patch(`/crew-tasks/${task.id}`, {
        service: "aurora",
        data: { expectedVersion: task.version, customFieldValues: [{ fieldId: field.id, value }] },
      })
    );
  const found = result.customFieldValues.filter((v) => v.fieldId === field.id);
  const actual = found[0]?.value;
  const matches =
    value === null
      ? found.length === 0
      : found.length === 1 &&
        (Array.isArray(value)
          ? Array.isArray(actual) &&
            actual.length === value.length &&
            value.every((v, i) => v === actual[i])
          : actual === value);
  if (
    result.id !== task.id ||
    result.crewId !== task.crewId ||
    result.version !== task.version + 1 ||
    !matches
  )
    throw new Error(
      "Custom-field acknowledgement mismatch. Refresh the task before editing again."
    );
  return result;
}
