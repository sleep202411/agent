import { useEffect, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  fetchTaskFieldDefinitions,
  type CustomField,
  type CustomValue,
} from "./task-custom-fields-api";
import { normalizeCustomValue } from "./task-custom-field-edit-api";
export function useTaskCreationCustomFields(
  crewId: string,
  generation: number,
  initial: { fieldId: string; value: CustomValue }[] = []
) {
  const [fields, setFields] = useState<CustomField[]>(),
    [error, setError] = useState<string>(),
    [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, CustomValue>>(() =>
    Object.fromEntries(initial.map((row) => [row.fieldId, row.value]))
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskFieldDefinitions(crewId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setFields(data);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [crewId, generation, attempt]);
  let values: { fieldId: string; value: CustomValue }[] | undefined;
  if (fields)
    try {
      values = fields
        .map((field) => ({
          fieldId: field.id,
          value: normalizeCustomValue(field, drafts[field.id] ?? null),
        }))
        .filter((row) => row.value !== null);
      if (values.length > 50) values = undefined;
    } catch {
      /* Invalid or missing required values block submission. */
    }
  return {
    fields,
    error,
    values,
    drafts,
    retry: () => {
      setError(undefined);
      setAttempt((n) => n + 1);
    },
    change: (fieldId: string, value: CustomValue) => {
      if (generation === getAuthGeneration())
        setDrafts((current) => ({ ...current, [fieldId]: value }));
    },
  };
}
