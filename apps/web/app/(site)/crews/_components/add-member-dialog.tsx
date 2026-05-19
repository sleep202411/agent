"use client";

/**
 * Add-member dialog — email/phone → live lookup → add.
 *
 * UX flow:
 *   1. User types/pastes an email or phone
 *   2. Debounce 400ms → GET /aurora/users/lookup?{email|phone}=…
 *      (the hook detects which mode and picks the right query param)
 *   3. Server returns profile PLUS membership context (isCrewMember,
 *      isCrewFounder) so the dialog renders a live preview card in
 *      one roundtrip
 *   4. Submit enabled only when found + not member + not founder
 *   5. Submit → POST /aurora/crews/:crewId/members { account, roleType }
 *      and the server resolves the contact again before inserting.
 */

import { useMemo, useState } from "react";
import {
  IconAlertCircle,
  IconCheck,
  IconCrown,
  IconInfoCircle,
  IconLoader2,
  IconUserCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
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
import { env } from "@/src/env";
import { CrewApiError, useAddCrewMember } from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslatedPresetPositions } from "@/app/(site)/crews/_hooks/use-position-label";
import { useDebouncedValue, useUserLookup } from "@/app/(site)/crews/_hooks/use-users";

const ADD_MEMBER_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface AddCrewMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
}

export function AddCrewMemberDialog({ open, onOpenChange, crewId }: AddCrewMemberDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const [queryInput, setQueryInput] = useState("");
  const [roleType, setRoleType] = useState<string>("");
  const presetPositions = useTranslatedPresetPositions();

  const debouncedQuery = useDebouncedValue(queryInput, 400);
  const lookup = useUserLookup({ query: debouncedQuery, checkCrewId: crewId });

  const { mutateAsync: addMember, isPending: submitting } = useAddCrewMember(crewId);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQueryInput("");
      setRoleType("");
    }
    onOpenChange(next);
  };

  // Submit gate: must have a found-and-addable user + a role.
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (roleType.length === 0) return false;
    if (lookup.kind !== "found") return false;
    if (lookup.user.isCrewMember || lookup.user.isCrewFounder) return false;
    return true;
  }, [lookup, roleType, submitting]);

  const handleSubmit = async () => {
    if (!canSubmit || lookup.kind !== "found") return;
    try {
      await addMember({ account: debouncedQuery.trim(), roleType });
      toast.success(t("addMemberSuccess"));
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

            <Field>
              <FieldLabel required>{t("addMemberRoleLabel")}</FieldLabel>
              <Select value={roleType} onValueChange={setRoleType} disabled={submitting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("addMemberRolePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {presetPositions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
  const avatarUrl = user.avatar
    ? user.avatar.startsWith("http")
      ? user.avatar
      : `${env.USER_BASE_URL || env.OSS_BASE_URL}/${user.avatar.replace(/^\/+/, "")}`
    : "";
  const initial = (user.nickname || `U${user.userId}`).charAt(0).toUpperCase();

  let badge: { tone: "info" | "warn" | "ok"; text: string; icon: typeof IconCheck } | null = null;
  if (user.isCrewFounder) {
    badge = { tone: "warn", text: t("addMemberUserIsFounder"), icon: IconCrown };
  } else if (user.isCrewMember) {
    badge = { tone: "warn", text: t("addMemberUserIsMember"), icon: IconUserCheck };
  } else {
    badge = { tone: "ok", text: t("addMemberUserCanAdd"), icon: IconCheck };
  }

  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="size-9 rounded-full object-cover" />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
          {initial}
        </div>
      )}
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
