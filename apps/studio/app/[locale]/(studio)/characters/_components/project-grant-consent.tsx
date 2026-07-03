"use client";

import { useTranslations } from "next-intl";
import { REAL_PERSON_GRANT_CONSENT_VERSION } from "@/lib/characters-api";
import { ConsentScreen, type ConsentSection } from "./consent-screen";

/**
 * The versioned PER-PROJECT grant consent screen — shown before a likeness is
 * authorized into one project (subject "Authorize a project" AND actor casting
 * accept). Names the project + purpose limitation + prohibited uses +
 * cross-border processing + the subject's controls + 18+. The copy IS the
 * consented text for `REAL_PERSON_GRANT_CONSENT_VERSION`; acceptance is implicit
 * in the grant/accept POST the parent fires once both gates pass.
 */
export function ProjectGrantConsent({
  projectName,
  read,
  onRead,
  attested,
  onAttestedChange,
  disabled,
}: {
  projectName: string;
  read: boolean;
  onRead: () => void;
  attested: boolean;
  onAttestedChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("characters");
  const sections: ConsentSection[] = [
    {
      key: "project",
      title: t("grantProjectTitle"),
      body: t("grantProjectBody", { project: projectName }),
    },
    { key: "purpose", title: t("grantPurposeTitle"), body: t("grantPurposeBody") },
    { key: "prohibited", title: t("grantProhibitedTitle"), body: t("grantProhibitedBody") },
    { key: "transfer", title: t("grantTransferTitle"), body: t("grantTransferBody") },
    { key: "controls", title: t("grantControlsTitle"), body: t("grantControlsBody") },
  ];

  return (
    <ConsentScreen
      versionLabel={t("consentVersionLabel", { version: REAL_PERSON_GRANT_CONSENT_VERSION })}
      sections={sections}
      attestationLabel={t("grantAttestation")}
      scrollHint={t("consentScrollHint")}
      read={read}
      onRead={onRead}
      attested={attested}
      onAttestedChange={onAttestedChange}
      disabled={disabled}
    />
  );
}
