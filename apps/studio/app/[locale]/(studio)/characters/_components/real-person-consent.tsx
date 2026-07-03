"use client";

import { useTranslations } from "next-intl";
import { REAL_PERSON_CONSENT_VERSION } from "@/lib/characters-api";
import { ConsentScreen, type ConsentSection } from "./consent-screen";

/**
 * The versioned real-person ENROLLMENT consent screen (design doc §5.3
 * mandatory clauses). The copy rendered here IS the consented text for
 * `REAL_PERSON_CONSENT_VERSION` — changing the wording requires a new version
 * string (the server ledgers version + text hash as legal evidence).
 *
 * Thin wrapper over the shared {@link ConsentScreen} primitive; reports the two
 * gates (scrolled-to-end + adult attestation) up to the parent.
 */
export function RealPersonConsent({
  read,
  onRead,
  attested,
  onAttestedChange,
  disabled,
}: {
  read: boolean;
  onRead: () => void;
  attested: boolean;
  onAttestedChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("characters");
  const sections: ConsentSection[] = [
    { key: "purpose", title: t("consentPurposeTitle"), body: t("consentPurposeBody") },
    { key: "data", title: t("consentDataTitle"), body: t("consentDataBody") },
    { key: "transfer", title: t("consentTransferTitle"), body: t("consentTransferBody") },
    { key: "retention", title: t("consentRetentionTitle"), body: t("consentRetentionBody") },
    { key: "scope", title: t("consentScopeTitle"), body: t("consentScopeBody") },
    { key: "withdraw", title: t("consentWithdrawTitle"), body: t("consentWithdrawBody") },
    { key: "outputs", title: t("consentOutputsTitle"), body: t("consentOutputsBody") },
  ];

  return (
    <ConsentScreen
      versionLabel={t("consentVersionLabel", { version: REAL_PERSON_CONSENT_VERSION })}
      sections={sections}
      attestationLabel={t("consentAttestation")}
      scrollHint={t("consentScrollHint")}
      read={read}
      onRead={onRead}
      attested={attested}
      onAttestedChange={onAttestedChange}
      disabled={disabled}
    />
  );
}
