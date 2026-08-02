"use client";

/**
 * Add-member dialog — email/phone → live lookup → add.
 *
 * UX flow:
 *   1. User types/pastes an email or phone
 *   2. Debounce 400ms → GET /aurora/users/lookup?{email|phone}=…
 *      (the hook detects which mode and picks the right query param)
 *   3. Server returns profile PLUS membership context (isCrewMember,
 *      isCrewOwner) so the dialog renders a live preview card in
 *      one roundtrip
 *   4. Owners may grant additive access policies
 *   5. Submit → invitation. Membership is created only after acceptance.
 *      and the server resolves the contact again before inserting.
 */

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconCheck,
  IconCrown,
  IconInfoCircle,
  IconLoader2,
  IconCoin,
  IconShield,
  IconSignature,
  IconUserCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  CrewApiError,
  useCrewAgreements,
  useInviteCrewMember,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useDebouncedValue, useUserLookup } from "@/app/(site)/crews/_hooks/use-users";
import type { CrewPolicyKey } from "@repo/shared/crew";

const ADD_MEMBER_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface AddCrewMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  canGrantPolicies: boolean;
}

export function AddCrewMemberDialog({
  open,
  onOpenChange,
  crewId,
  canGrantPolicies,
}: AddCrewMemberDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const [queryInput, setQueryInput] = useState("");
  const [policyKeys, setPolicyKeys] = useState<CrewPolicyKey[]>([]);
  const [agreementEnabled, setAgreementEnabled] = useState(false);
  const [agreementTitle, setAgreementTitle] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 400);
  const lookup = useUserLookup({ query: debouncedQuery, checkCrewId: crewId });

  const { mutateAsync: inviteMember, isPending: submitting } = useInviteCrewMember(crewId);
  const agreementCapability = useCrewAgreements(crewId, open, "all", 1);
  const canRequestAgreement = agreementCapability.data?.capabilities.create === true;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQueryInput("");
      setPolicyKeys([]);
      setAgreementEnabled(false);
      setAgreementTitle("");
      setSignerName("");
      setSignerEmail("");
    }
    onOpenChange(next);
  };

  // Submit gate: the account must resolve to a user who is not already a member.
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (lookup.kind !== "found") return false;
    if (lookup.user.isCrewMember || lookup.user.isCrewOwner) return false;
    if (
      agreementEnabled &&
      (!canRequestAgreement || !agreementTitle.trim() || !signerName.trim() || !signerEmail.trim())
    ) {
      return false;
    }
    return true;
  }, [
    agreementEnabled,
    agreementTitle,
    canRequestAgreement,
    lookup,
    signerEmail,
    signerName,
    submitting,
  ]);

  const toggleAgreement = (checked: boolean) => {
    setAgreementEnabled(checked);
    if (!checked || lookup.kind !== "found") return;
    if (!signerName) {
      setSignerName(lookup.user.nickname || `User ${lookup.user.userId}`);
    }
    if (!signerEmail && debouncedQuery.includes("@")) {
      setSignerEmail(debouncedQuery.trim());
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || lookup.kind !== "found") return;
    try {
      await inviteMember({
        account: debouncedQuery.trim(),
        policyKeys: canGrantPolicies ? policyKeys : [],
        ...(agreementEnabled
          ? {
              agreement: {
                title: agreementTitle.trim(),
                signerName: signerName.trim(),
                signerEmail: signerEmail.trim(),
              },
            }
          : {}),
      });
      toast.success(agreementEnabled ? t("addMemberAgreementSuccess") : t("addMemberSuccess"));
      handleOpenChange(false);
    } catch (err) {
      if (err instanceof CrewApiError) {
        const detail =
          typeof err.body === "object" && err.body && "message" in err.body
            ? String((err.body as { message: unknown }).message)
            : err.message;
        toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
      } else {
        toast.error(err instanceof Error ? err.message : t("addMemberFailed"));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={ADD_MEMBER_HERO_URL}
          eyebrow={t("addMemberDialogEyebrow")}
          title={t("addMemberDialogTitle")}
          description={t("addMemberDialogSubtitle")}
        />

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("addMemberContactLabel")}</FieldLabel>
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder={t("addMemberContactPlaceholder")}
                maxLength={120}
                disabled={submitting}
                autoFocus
              />
              <LookupPreview state={lookup} contact={debouncedQuery} t={t} />
            </Field>

            {canGrantPolicies ? (
              <Field>
                <FieldLabel>{t("addMemberAccessLabel")}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <PolicyOption
                    checked={policyKeys.includes("admin")}
                    onCheckedChange={(checked) =>
                      setPolicyKeys((current) => togglePolicy(current, "admin", checked))
                    }
                    icon={<IconShield className="size-4" />}
                    title={t("memberAdminBadge")}
                    description={t("addMemberAdminPolicyHint")}
                    disabled={submitting}
                  />
                  <PolicyOption
                    checked={policyKeys.includes("finance")}
                    onCheckedChange={(checked) =>
                      setPolicyKeys((current) => togglePolicy(current, "finance", checked))
                    }
                    icon={<IconCoin className="size-4" />}
                    title={t("memberFinanceBadge")}
                    description={t("addMemberFinancePolicyHint")}
                    disabled={submitting}
                  />
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {t("addMemberAccessHint")}
                </p>
              </Field>
            ) : null}

            <div className="rounded-xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={agreementEnabled}
                  disabled={submitting || agreementCapability.isLoading || !canRequestAgreement}
                  onCheckedChange={(checked) => toggleAgreement(checked === true)}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <IconSignature className="size-4 text-primary" />
                    {t("addMemberAgreementLabel")}
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white/40">
                      {t("addMemberAgreementOptional")}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {t("addMemberAgreementHint")}
                  </span>
                </span>
              </label>

              {!agreementCapability.isLoading && !canRequestAgreement ? (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-5 text-amber-200/80">
                  <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  {t("addMemberAgreementUnavailable")}
                </p>
              ) : null}

              {agreementEnabled ? (
                <FieldGroup className="mt-4">
                  <Field>
                    <FieldLabel required>{t("addMemberAgreementTitle")}</FieldLabel>
                    <Input
                      value={agreementTitle}
                      onChange={(event) => setAgreementTitle(event.target.value)}
                      maxLength={180}
                      placeholder={t("addMemberAgreementTitlePlaceholder")}
                      disabled={submitting}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel required>{t("addMemberSignerName")}</FieldLabel>
                      <Input
                        value={signerName}
                        onChange={(event) => setSignerName(event.target.value)}
                        maxLength={128}
                        disabled={submitting}
                      />
                    </Field>
                    <Field>
                      <FieldLabel required>{t("addMemberSignerEmail")}</FieldLabel>
                      <Input
                        type="email"
                        value={signerEmail}
                        onChange={(event) => setSignerEmail(event.target.value)}
                        maxLength={320}
                        placeholder="name@example.com"
                        disabled={submitting}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {t("addMemberAgreementDisclosure")}
                  </p>
                </FieldGroup>
              ) : null}
            </div>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {submitting ? t("addMemberSubmitting") : t("addMemberSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Live preview card ─────────────────────────────────────

function LookupPreview({
  state,
  contact,
  t,
}: {
  state: ReturnType<typeof useUserLookup>;
  contact: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const trimmed = contact.trim();
  if (state.kind === "idle") {
    // Stay quiet while the user is clearly still typing — only flag
    // format problems once they have enough characters that something
    // SHOULD have matched.
    if (trimmed.length < 3) {
      return (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("addMemberContactHint")}</p>
      );
    }
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-400">
        <IconAlertCircle className="size-3" />
        {t("addMemberContactInvalid")}
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <PreviewBox tone="muted">
        <IconLoader2 className="size-3.5 animate-spin" />
        <span>{t("addMemberLookingUp")}</span>
      </PreviewBox>
    );
  }

  if (state.kind === "notFound") {
    return (
      <PreviewBox tone="error">
        <IconAlertCircle className="size-3.5" />
        <div className="flex flex-col">
          <span>{t("addMemberNotFound")}</span>
          <span className="text-[10px] text-muted-foreground">{t("addMemberNotFoundHint")}</span>
        </div>
      </PreviewBox>
    );
  }

  if (state.kind === "error") {
    return (
      <PreviewBox tone="error">
        <IconAlertCircle className="size-3.5" />
        <div className="flex flex-col">
          <span>{t("addMemberLookupError")}</span>
          <span className="text-[10px] text-muted-foreground">
            {state.message} {state.status ? `· HTTP ${state.status}` : ""}
          </span>
        </div>
      </PreviewBox>
    );
  }

  // Found — render person card with member-state badge.
  const { user } = state;
  let badge: { tone: "info" | "warn" | "ok"; text: string; icon: typeof IconCheck } | null = null;
  if (user.isCrewOwner) {
    badge = { tone: "warn", text: t("addMemberUserIsOwner"), icon: IconCrown };
  } else if (user.isCrewMember) {
    badge = { tone: "warn", text: t("addMemberUserIsMember"), icon: IconUserCheck };
  } else {
    badge = { tone: "ok", text: t("addMemberUserCanAdd"), icon: IconCheck };
  }

  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
      <UserAvatar
        src={user.avatar}
        name={user.nickname || `User ${user.userId}`}
        seed={user.userId}
        size={36}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {user.nickname || `User ${user.userId}`}
        </div>
        <div
          className={cn(
            "mt-0.5 inline-flex items-center gap-1 text-[11px]",
            badge.tone === "ok" && "text-green-400",
            badge.tone === "warn" && "text-amber-400",
            badge.tone === "info" && "text-muted-foreground"
          )}
        >
          <badge.icon className="size-3" />
          {badge.text}
        </div>
      </div>
    </div>
  );
}

function PreviewBox({
  tone,
  children,
}: {
  tone: "muted" | "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex items-start gap-2 rounded-lg p-2.5 text-xs",
        tone === "muted" && "bg-secondary/40 text-muted-foreground",
        tone === "error" && "bg-rose-400/10 text-rose-400",
        tone === "info" && "bg-primary/10 text-primary"
      )}
    >
      {children}
      {/* Silence unused IconInfoCircle (kept on the surface so the
          "tone='info'" branch is meaningful for future copy). */}
      <span className="hidden">
        <IconInfoCircle className="size-0" />
      </span>
    </div>
  );
}

function PolicyOption({
  checked,
  onCheckedChange,
  icon,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
        checked
          ? "border-primary/35 bg-primary/[0.08]"
          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {icon}
          {title}
        </span>
        <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

function togglePolicy(current: CrewPolicyKey[], policyKey: CrewPolicyKey, enabled: boolean) {
  if (enabled) return current.includes(policyKey) ? current : [...current, policyKey];
  return current.filter((key) => key !== policyKey);
}
