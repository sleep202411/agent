"use client";

import { SaveOpening } from "./save-opening";
import { JoinFanCommunity } from "./join-fan-community";
import { ApplyToOpening } from "./apply-to-opening";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useCrewDetail, useCrewPositions } from "../_hooks/use-crew";
import { useCrewPermissions } from "../_hooks/use-crew-permissions";
import { useTranslatePositionValue } from "../_hooks/use-position-label";
import { CrewSectionNavigation } from "./crew-section-navigation";
import {
  formatSalaryString,
  employmentTypeKey,
  experienceKey,
  workModeKey,
} from "../[id]/workspace/_components/positions/position-meta";

export function OpeningDetails({
  id,
  positionId,
  embedded = false,
}: {
  id: string;
  positionId: string;
  embedded?: boolean;
}) {
  const locale = useLocale();
  const paymentT = useTranslations("taskPaymentTerms");
  const t = useTranslations("crewOpening");
  const common = useTranslations("common");
  const crewT = useTranslations("crew");
  const workspace = useTranslations("workspace");
  const label = useTranslatePositionValue();
  const crew = useCrewDetail(id);
  const positions = useCrewPositions(id);
  const viewer = useCrewPermissions(id);
  const position = positions.data.find(
    (item) =>
      item.id === positionId && item.status !== "frozen" && item.recruitmentVisibility !== "private"
  );
  const failed = crew.isError || positions.isError;
  const loading = crew.isLoading || positions.isPending || (!position && positions.hasNextPage);
  const full =
    position && (position.status === "full" || position.recruitedCount >= position.targetCount);
  const salary = position ? formatSalaryString(position, workspace) : null;
  return (
    <div className={embedded ? "min-w-0 px-5 py-6 lg:px-8" : "mx-auto max-w-5xl px-4 py-8 sm:px-6"}>
      {!embedded && <CrewSectionNavigation active="positions" />}
      {!embedded && (
        <Link href={`/${locale}/crews?view=positions`} className="text-sm text-muted-foreground">
          {t("back")}
        </Link>
      )}
      {failed ? (
        <div role="alert" className="mt-6 space-y-3">
          <p>{(crew.error ?? positions.error)?.message}</p>
          <Button
            onClick={() => {
              void crew.refetch();
              void positions.refetch();
            }}
            disabled={crew.isFetching || positions.isFetching}
          >
            {common("retry")}
          </Button>
        </div>
      ) : loading ? (
        <p className="mt-6">{common("loading")}</p>
      ) : !position || !crew.data ? (
        <p className="mt-6">{t("unavailable")}</p>
      ) : (
        <article className="mt-6 space-y-6">
          <header className="space-y-3">
            <Link href={`/${locale}/crews/${id}`} className="text-sm text-muted-foreground">
              {crew.data.name}
            </Link>
            <h1 className="text-2xl font-semibold">{label(position.positionType)}</h1>
            <p className="text-sm text-muted-foreground">
              {[
                workspace(employmentTypeKey(position.employmentType)),
                workspace(workModeKey(position.workMode)),
                position.location,
                workspace(experienceKey(position.experienceLevel)),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {position.paymentTerms && (
              <p>
                {paymentT("label")}: {paymentT(position.paymentTerms)}
              </p>
            )}
            {salary && <p className="font-medium">{salary}</p>}
          </header>
          <div className="flex flex-wrap gap-3">
            {viewer.isOwner ? (
              <span className="inline-flex items-center rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
                {t("ownOpening")}
              </span>
            ) : (
              <ApplyToOpening
                crewId={id}
                positionId={position.id}
                disabled={Boolean(full)}
                label={full ? crewT("ctaFull") : crewT("ctaApply")}
              />
            )}
            <SaveOpening positionId={position.id} />
          </div>
          <section className="space-y-2">
            <h2 className="text-base font-semibold">{t("description")}</h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              {position.description || crewT("noPositionDescription")}
            </p>
          </section>
          {position.requiredSkills.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">{t("skills")}</h2>
              <ul className="list-disc pl-5 text-sm">
                {position.requiredSkills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </section>
          )}
          {position.closeDate && (
            <p className="text-sm">
              {t("deadline")}: {position.closeDate}
            </p>
          )}

          <section className="space-y-3 rounded-xl bg-white/[0.025] p-5">
            <Link
              href={`/${locale}/crews/${encodeURIComponent(id)}`}
              className="text-base font-semibold hover:underline"
            >
              {crew.data.name}
            </Link>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {crew.data.description}
            </p>
            <JoinFanCommunity crewId={id} />
          </section>
        </article>
      )}
    </div>
  );
}
