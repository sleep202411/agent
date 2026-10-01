"use client";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "@/src/i18n/i18n";
import type {
  CrewTaskFieldDTO,
  CrewTaskCustomValue,
  CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/types";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { TaskSelect } from "./task-select";
export function CustomFieldControl({
  field,
  value,
  members,
  displays,
  onChange,
}: {
  field: CrewTaskFieldDTO;
  value: CrewTaskCustomValue;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  onChange: (value: CrewTaskCustomValue) => void;
}) {
  const t = useTranslations("crewTasks");
  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[11px]">
        <Checkbox
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        {t("customFieldYes")}
      </label>
    );
  }
  if (field.type === "single_select" || field.type === "user") {
    const options =
      field.type === "user"
        ? members.map((member) => ({
            id: member.userId,
            label: displayNameOf(member.userId, displays),
          }))
        : field.options;
    return (
      <TaskSelect
        value={typeof value === "string" ? value : ""}
        onValueChange={(nextValue) => onChange(nextValue || null)}
        className="h-9"
        options={[
          { value: "", label: t("customFieldUnset") },
          ...options.map((option) => ({ value: option.id, label: option.label })),
        ]}
      />
    );
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1">
        {field.options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-white/[0.045]"
          >
            <Checkbox
              checked={selected.includes(option.id)}
              onCheckedChange={() =>
                onChange(
                  selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id]
                )
              }
            />
            <span className="text-[11px]">{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <Input
      aria-label={field.name}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value == null || Array.isArray(value) ? "" : String(value)}
      onChange={(event) => onChange(event.target.value || null)}
      maxLength={field.type === "text" ? 4000 : undefined}
    />
  );
}

export function normalizeCustomFieldDraft(
  field: CrewTaskFieldDTO,
  value: CrewTaskCustomValue
): CrewTaskCustomValue {
  if (field.type === "number") {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.type === "text" && typeof value === "string") return value.trim() || null;
  if (field.type === "multi_select" && Array.isArray(value)) return value.length ? value : null;
  return value;
}
