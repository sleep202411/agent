"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { certificationEntry } from "../../creators/_components/center/certification-guide-data";
import { crewApi } from "../_hooks/api";

/** Uses the same regional catalog as server-side application eligibility. */
export function RequiredSkillsSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("crewSkills");
  const guide = useTranslations("certificationGuide");
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: ["crew-qualification-catalog", user?.id],
    enabled: Boolean(user),
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<{ skills: string[] }>("/crew-qualification-catalog", {
        signal,
        cache: "no-store",
      }),
  });
  const skills = [...new Set([...(query.data?.skills ?? []), ...value])];
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{t("label")}</legend>
      {query.isPending && user ? (
        <p role="status" className="text-xs">
          {t("loading")}
        </p>
      ) : null}
      {query.error ? (
        <div role="alert" className="space-y-2 text-xs">
          <p>{query.error.message}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {skills.map((skill) => (
          <label
            key={skill}
            className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-xs"
          >
            <Checkbox
              checked={value.includes(skill)}
              disabled={
                disabled || (!value.includes(skill) && (value.length >= 20 || query.isError))
              }
              onCheckedChange={() =>
                onChange(
                  value.includes(skill) ? value.filter((item) => item !== skill) : [...value, skill]
                )
              }
            />
            {certificationEntry(skill) ? guide(`${certificationEntry(skill)}Name`) : skill}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
