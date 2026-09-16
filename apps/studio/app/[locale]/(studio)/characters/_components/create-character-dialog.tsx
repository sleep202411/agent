"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { IconLoader2, IconMasksTheater, IconUserScan } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FIELD_CONTROL, FIELD_CONTROL_TEXTAREA } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api";
import { useActiveWorkspace } from "@/app/_components/workspace-context";
import {
  characterApiErrorCode,
  createCharacter,
  REAL_PERSON_CONSENT_VERSION,
  type CharacterKind,
} from "@/lib/characters-api";
import { useCharacterOperation } from "../_lib/use-character-operation";
import { useApplyCharacterDetail } from "../_lib/use-characters";
import { RealPersonConsent } from "./real-person-consent";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;

type Step = "details" | "consent";

/**
 * Create a character in the active workspace's library. Two live kinds:
 * `virtual` creates immediately; `real_person` ("My likeness") first walks
 * through the versioned consent screen (scroll-through + adult attestation
 * gates) and creates a `draft` — the enrollment wizard on the detail surface
 * then drives the liveness verification. On success we seed the detail cache
 * and navigate straight to the detail surface.
 */
export function CreateCharacterDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
}) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const router = useRouter();
  const applyDetail = useApplyCharacterDetail();
  const activeWorkspace = useActiveWorkspace();
  // real_person v1 lives ONLY in the subject's default workspace (design §0);
  // the server 400s (REAL_PERSON_PERSONAL_ONLY) in a team, so gate the option
  // up front rather than after the whole consent walk.
  const realPersonAllowed = activeWorkspace?.isDefault === true;

  const [kind, setKind] = useState<CharacterKind>("virtual");
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [consentRead, setConsentRead] = useState(false);
  const [consentAttested, setConsentAttested] = useState(false);

  const resetForm = () => {
    setKind("virtual");
    setStep("details");
    setName("");
    setDescription("");
    setNameError(null);
    setConsentRead(false);
    setConsentAttested(false);
  };

  const operation = useCharacterOperation(JSON.stringify([workspaceId, open]), () => {
    resetForm();
    setBusy(false);
  });

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) resetForm();
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName || !workspaceId || busy) return;
    if (kind === "real_person" && !(consentRead && consentAttested)) return;
    const run = operation.start();
    if (!run) return;
    setBusy(true);
    setNameError(null);
    try {
      const detail = await createCharacter(
        {
          workspaceId,
          kind,
          name: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          ...(kind === "real_person"
            ? { consent: { version: REAL_PERSON_CONSENT_VERSION, adultAttested: true as const } }
            : {}),
        },
        run.signal
      );
      if (!operation.isCurrent(run)) return;
      applyDetail(detail);
      resetForm();
      onOpenChange(false);
      router.push(`/characters/${detail.id}`);
    } catch (error) {
      if (!operation.isCurrent(run)) return;
      const message = error instanceof Error ? error.message : tc("error");
      const code = characterApiErrorCode(error);
      // Name conflicts belong on the field (back on the details step);
      // the other typed refusals get honest, specific toasts.
      if (
        code === "CHARACTER_NAME_TAKEN" ||
        (!code && error instanceof ApiRequestError && error.status === 409)
      ) {
        setNameError(message);
        setStep("details");
      } else if (code === "REAL_PERSON_NOT_AVAILABLE") {
        toast.error(t("errorRealPersonUnavailable"));
      } else if (code === "CN_REAL_PERSON_UNAVAILABLE") {
        toast.error(t("errorRealPersonRegion"));
      } else if (code === "REAL_PERSON_PERSONAL_ONLY") {
        toast.error(t("errorRealPersonPersonalOnly"));
        setStep("details");
      } else if (code === "ACR_ENROLLMENT_PAUSED") {
        toast.error(t("errorEnrollmentPaused"));
      } else {
        toast.error(message);
      }
    } finally {
      if (operation.finish(run)) setBusy(false);
    }
  };

  const kindOption = (
    optionKind: CharacterKind,
    icon: React.ReactNode,
    label: string,
    hint: string,
    disabled?: boolean
  ) => {
    const selected = kind === optionKind;
    if (disabled) {
      // Honest disabled control (DESIGN.md): muted, not-allowed, reason inline.
      return (
        <div className="cursor-not-allowed rounded-xl bg-white/[0.02] px-3.5 py-3 text-left">
          <span className="flex items-center gap-1.5 text-sm font-medium text-white/35">
            {icon}
            {label}
          </span>
          <span className="mt-1 block text-xs text-white/25">{hint}</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => setKind(optionKind)}
        className={cn(
          "rounded-xl px-3.5 py-3 text-left transition-colors",
          selected
            ? "bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
            : "bg-white/[0.03] hover:bg-white/[0.06]"
        )}
      >
        <span
          className={cn(
            "flex items-center gap-1.5 text-sm font-medium",
            !selected && "text-white/70"
          )}
        >
          {icon}
          {label}
        </span>
        <span
          className={cn("mt-1 block text-xs", selected ? "text-muted-foreground" : "text-white/35")}
        >
          {hint}
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={step === "consent" ? "sm:max-w-lg" : "sm:max-w-md"}>
        {step === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("createCharacter")}</DialogTitle>
              <DialogDescription>{t("createCharacterDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Field label={t("kindLabel")}>
                <div className="grid grid-cols-2 gap-2">
                  {kindOption(
                    "virtual",
                    <IconMasksTheater className="size-4" stroke={1.8} />,
                    t("kindVirtual"),
                    t("kindVirtualDescription")
                  )}
                  {kindOption(
                    "real_person",
                    <IconUserScan className="size-4" stroke={1.8} />,
                    t("kindMyLikeness"),
                    realPersonAllowed
                      ? t("kindRealPersonDescription")
                      : t("realPersonPersonalOnlyHint"),
                    !realPersonAllowed
                  )}
                </div>
              </Field>

              <Field label={t("nameLabel")} htmlFor="character-name" error={nameError ?? undefined}>
                <Input
                  id="character-name"
                  value={name}
                  autoFocus
                  maxLength={NAME_MAX}
                  placeholder={t("namePlaceholder")}
                  className={FIELD_CONTROL}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (kind === "virtual") void submit();
                    else if (name.trim()) setStep("consent");
                  }}
                />
              </Field>

              <Field
                label={t("descriptionLabel")}
                htmlFor="character-description"
                hint={t("optionalHint")}
              >
                <Textarea
                  id="character-description"
                  value={description}
                  maxLength={DESCRIPTION_MAX}
                  placeholder={t("descriptionPlaceholder")}
                  className={FIELD_CONTROL_TEXTAREA}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
                {tc("cancel")}
              </Button>
              {kind === "virtual" ? (
                <Button
                  variant="primary-cta"
                  onClick={() => void submit()}
                  disabled={busy || !name.trim() || !workspaceId}
                >
                  {busy ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
                  {tc("create")}
                </Button>
              ) : (
                <Button
                  variant="primary-cta"
                  onClick={() => setStep("consent")}
                  disabled={busy || !name.trim() || !workspaceId}
                >
                  {tc("next")}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("consentTitle")}</DialogTitle>
              <DialogDescription>{t("consentSubtitle")}</DialogDescription>
            </DialogHeader>

            <RealPersonConsent
              read={consentRead}
              onRead={() => setConsentRead(true)}
              attested={consentAttested}
              onAttestedChange={setConsentAttested}
              disabled={busy}
            />

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("details")} disabled={busy}>
                {tc("back")}
              </Button>
              <Button
                variant="primary-cta"
                onClick={() => void submit()}
                disabled={busy || !consentRead || !consentAttested || !workspaceId}
              >
                {busy ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
                {t("consentAccept")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
