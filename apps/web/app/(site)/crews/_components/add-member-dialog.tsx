"use client";

/**
 * Add-member dialog — contact or user ID → live lookup → invitation.
 *
 * UX flow:
 *   1. User selects contact or user ID and enters the corresponding value
 *   2. Debounce 400ms → contact lookup or explicit by-id lookup
 *   3. Server returns profile PLUS membership context (isCrewMember,
 *      isCrewOwner) so the dialog renders a live preview card in
 *      one roundtrip
 *   4. Owners may grant additive access policies
 *   5. Submit → invitation. Membership is created only after acceptance.
 *      The server resolves the selected identifier again before inserting.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconCheck,
  IconCrown,
  IconInfoCircle,
  IconLoader2,
  IconSignature,
  IconUserCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CrewApiError,
  useCrewAgreements,
  useInviteCrewMember,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useDebouncedValue, useUserLookup } from "@/app/(site)/crews/_hooks/use-users";
import { InviteLinkPanel } from "@/app/(site)/crews/_components/invite-link-panel";
import {
  isCrewInviteAccessPreset,
  policyKeysForAccessPreset,
  type CrewInviteAccessPreset,
} from "@/app/(site)/crews/_lib/member-access-preset";

const ADD_MEMBER_HERO_URL = "/crews/invite-member-hero.jpg";

interface AddCrewMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  canGrantPolicies: boolean;
  positionCategory?: import("@repo/shared/crew").PresetPositionValue;
}

export function AddCrewMemberDialog(props: AddCrewMemberDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open) return null;
  return (
    <MemberInvitationForm
      key={JSON.stringify([user?.id, props.crewId, props.positionCategory])}
      {...props}
    />
  );
}

function MemberInvitationForm({
  open,
  onOpenChange,
  crewId,
  canGrantPolicies,
  positionCategory,
}: AddCrewMemberDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const roleT = useTranslations("crewRoles");
  const setupT = useTranslations("crewSetup");

  // Two ways in, one dialog: name an account, or mint a link. They share the
  // access vocabulary and nothing else, so they are siblings, not a wizard.
  const [mode, setMode] = useState<"account" | "link">("account");
  const [lookupBy, setLookupBy] = useState<"contact" | "userId">("contact");
  const [queryInput, setQueryInput] = useState("");
  const [accessPreset, setAccessPreset] = useState<CrewInviteAccessPreset>("standard");
  const [agreementEnabled, setAgreementEnabled] = useState(false);
  const [agreementTitle, setAgreementTitle] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const debouncedQuery = useDebouncedValue(queryInput, 400);
  const lookup = useUserLookup({ query: debouncedQuery, checkCrewId: crewId, lookupBy });

  const { mutateAsync: inviteMember } = useInviteCrewMember(crewId);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const lookupCurrent = queryInput.trim() === debouncedQuery.trim();
  const agreementCapability = useCrewAgreements(crewId, open, "all", 1);
  const canRequestAgreement = agreementCapability.data?.capabilities.create === true;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode("account");
      setQueryInput("");
      setAccessPreset("standard");
      setAgreementEnabled(false);
      setAgreementTitle("");
      setSignerName("");
      setSignerEmail("");
    }
    onOpenChange(next);
  };

  // Submit gate: the account must resolve to a user who is not already a member.
  const canSubmit = useMemo(() => {
    if (submitting || !lookupCurrent) return false;
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
    lookupCurrent,
    signerEmail,
    signerName,
    submitting,
  ]);

  const toggleAgreement = (checked: boolean) => {
    setAgreementEnabled(checked);
    if (!checked || !lookupCurrent || lookup.kind !== "found") return;
    if (!signerName) {
      setSignerName(lookup.user.nickname || `${t("unnamedUser")} ${lookup.user.userId}`);
    }
    if (!signerEmail && debouncedQuery.includes("@")) {
      setSignerEmail(debouncedQuery.trim());
    }
  };

  const handleSubmit = async () => {
    if (!alive.current || pending.current || !canSubmit || lookup.kind !== "found") return;
    pending.current = true;
    setSubmitting(true);
    try {
      await inviteMember({
        account: debouncedQuery.trim(),
        ...(lookupBy === "userId" ? { lookupBy } : {}),
        ...(positionCategory ? { positionCategory } : {}),
        policyKeys: canGrantPolicies ? policyKeysForAccessPreset(accessPreset) : [],
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
      if (!alive.current) return;
      toast.success(agreementEnabled ? t("addMemberAgreementSuccess") : t("addMemberSuccess"));
      handleOpenChange(false);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof CrewApiError) {
        const detail =
          typeof err.body === "object" && err.body && "message" in err.body
            ? String((err.body as { message: unknown }).message)
            : err.message;
        toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
      } else {
        toast.error(err instanceof Error ? err.message : t("addMemberFailed"));
      }
    } finally {
      if (alive.current) {
        pending.current = false;
        setSubmitting(false);
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
          {positionCategory && (
            <p className="mb-4 text-sm">
              {setupT("invitedRole", { role: roleT(positionCategory) })}
            </p>
          )}
          <div className="mb-5 flex gap-1 rounded-lg bg-white/[0.03] p-1 ring-1 ring-white/[0.06]">
            {(["account", "link"] as const)
              .filter((value) => !positionCategory || value === "account")
              .map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  disabled={submitting}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === value
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {value === "account" ? t("inviteLinkTabAccount") : t("inviteLinkTabLink")}
                </button>
              ))}
          </div>

          {mode === "link" ? (
            <InviteLinkPanel
              crewId={crewId}
              canGrantPolicies={canGrantPolicies}
              open={open && mode === "link"}
            />
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel required>
                  {t(lookupBy === "userId" ? "addMemberUserIdLabel" : "addMemberContactLabel")}
                </FieldLabel>
                <Select
                  value={lookupBy}
                  onValueChange={(value) => {
                    if (value === "contact" || value === "userId") {
                      setLookupBy(value);
                      setSignerName("");
                      setSignerEmail("");
                    }
                  }}
                  disabled={submitting}
                >
                  <SelectTrigger aria-label={t("addMemberLookupBy")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contact">{t("addMemberContactLabel")}</SelectItem>
                    <SelectItem value="userId">{t("addMemberUserIdLabel")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={queryInput}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next.trim() !== queryInput.trim()) {
                      setSignerName("");
                      setSignerEmail("");
                    }
                    setQueryInput(next);
                  }}
                  placeholder={t(
                    lookupBy === "userId" ? "addMemberUserIdHint" : "addMemberContactPlaceholder"
                  )}
                  maxLength={120}
                  disabled={submitting}
                  autoFocus
                />
                {lookupCurrent ? (
                  <LookupPreview
                    state={lookup}
                    contact={debouncedQuery}
                    lookupBy={lookupBy}
                    t={t}
                  />
                ) : null}
              </Field>

              {canGrantPolicies ? (
                <Field>
                  <FieldLabel>{t("addMemberAccessLabel")}</FieldLabel>
                  <Select
                    value={accessPreset}
                    onValueChange={(value) => {
                      if (isCrewInviteAccessPreset(value)) setAccessPreset(value);
                    }}
                    disabled={submitting}
                  >
                    <SelectTrigger className="h-10 w-full rounded-lg px-3 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="standard">{t("memberAccessPresetStandard")}</SelectItem>
                      <SelectItem value="finance">{t("memberAccessPresetFinance")}</SelectItem>
                      <SelectItem value="admin">{t("memberAccessPresetAdmin")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] leading-5 text-foreground/65">
                    {accessPreset === "admin"
                      ? t("addMemberAdminPolicyHint")
                      : accessPreset === "finance"
                        ? t("addMemberFinancePolicyHint")
                        : t("addMemberStandardPolicyHint")}
                  </p>
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
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {mode === "link" ? tc("close") : tc("cancel")}
          </Button>
          {/* Minting a link is its own action inside the panel; a second
              primary here would read as "and now submit". */}
          {mode === "account" ? (
            <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {submitting ? t("addMemberSubmitting") : t("addMemberSubmit")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Live preview card ─────────────────────────────────────

function LookupPreview({
  lookupBy,
  state,
  contact,
  t,
}: {
  lookupBy: "contact" | "userId";
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
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t(lookupBy === "userId" ? "addMemberUserIdHint" : "addMemberContactHint")}
        </p>
      );
    }
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-400">
        <IconAlertCircle className="size-3" />
        {t(lookupBy === "userId" ? "addMemberUserIdInvalid" : "addMemberContactInvalid")}
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
          {state.retry ? (
            <Button type="button" variant="outline" size="sm" onClick={state.retry}>
              {t("addMemberLookupRetry")}
            </Button>
          ) : null}
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
        name={user.nickname || `${t("unnamedUser")} ${user.userId}`}
        seed={user.userId}
        size={36}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {user.nickname || `${t("unnamedUser")} ${user.userId}`}
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
