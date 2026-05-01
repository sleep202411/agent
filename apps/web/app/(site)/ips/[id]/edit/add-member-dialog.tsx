"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconMail, IconUserSearch, IconAlertCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MEMBER_ROLE,
  useProjectRoles,
  useUserByEmail,
  userAvatarUrl,
  type UserLookupRow,
} from "@/app/(site)/ips/_hooks/use-ip";

// Team-specific banner artwork on the static CDN. Keep the URL even if
// the file isn't uploaded yet — DialogHero degrades gracefully.
const TEAM_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 team banner.png"
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewMember {
  email: string;
  userId: number;
  /** Snapshot for the optimistic toast — the persisted member row comes
   *  back from `useProjectMembers` after the mutation lands. */
  userName: string;
  avatar: string;
  role: number;
  remark: string;
}

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User ids already on the team — surfaced as an inline error so the
   *  caller can't add the same person twice. */
  existingUserIds: number[];
  busy?: boolean;
  onSubmit: (member: NewMember) => void | Promise<void>;
}

export function AddMemberDialog({
  open,
  onOpenChange,
  existingUserIds,
  busy,
  onSubmit,
}: AddMemberDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [email, setEmail] = useState("");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [remark, setRemark] = useState("");

  // Role catalog comes from the backend, so the select shows whatever
  // the project supports rather than a hard-coded list. Lazy-fetched
  // when the dialog opens; cached for 10min so reopening is instant.
  const rolesQuery = useProjectRoles(open);
  const roles = rolesQuery.data ?? [];

  // Default the role to whichever option exists. If the backend list
  // includes the legacy MEMBER value (0), prefer it; otherwise fall
  // back to the first role returned.
  useEffect(() => {
    if (!open) return;
    if (role) return;
    if (roles.length === 0) return;
    const member = roles.find((r) => r.id === MEMBER_ROLE.MEMBER);
    setRole(String((member ?? roles[0]).id));
  }, [open, role, roles]);

  // Debounce the email so we don't fire a lookup on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedEmail(email.trim()), 300);
    return () => clearTimeout(id);
  }, [email]);

  // Reset on open. State persists between opens so React Query's cache
  // stays warm, but a fresh open always starts blank.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setDebouncedEmail("");
    setRole("");
    setRemark("");
  }, [open]);

  const isWellFormedEmail = EMAIL_RE.test(debouncedEmail);
  const lookupEnabled = open && isWellFormedEmail;
  const lookup = useUserByEmail(debouncedEmail, lookupEnabled);
  const found: UserLookupRow | null = lookupEnabled ? (lookup.data ?? null) : null;
  const alreadyOnTeam = !!found && existingUserIds.includes(found.userId);

  const canSubmit = !!found && !alreadyOnTeam && !!role && !busy;

  const handleSubmit = async () => {
    if (!found || alreadyOnTeam) return;
    await onSubmit({
      email: found.email || debouncedEmail,
      userId: found.userId,
      userName: found.name,
      avatar: found.avatar,
      role: Number(role),
      remark: remark.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={TEAM_HERO_URL}
          eyebrow={t("teamHeroEyebrow")}
          title={t("addMemberTitle")}
          description={t("teamHeroSubtitle")}
        />

        <DialogBody className="py-4">
          <div className="space-y-4">
            <Field>
              <FieldLabel>{t("memberEmail")}</FieldLabel>
              <FieldDescription>{t("memberEmailDesc")}</FieldDescription>
              <div className="relative">
                <IconMail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="pl-9"
                  autoFocus
                />
              </div>

              <LookupResult
                email={debouncedEmail}
                wellFormed={isWellFormedEmail}
                isFetching={lookup.isFetching}
                isError={lookup.isError}
                found={found}
                alreadyOnTeam={alreadyOnTeam}
                labels={{
                  idle: t("memberLookupIdle"),
                  searching: t("memberLookupSearching"),
                  invalid: t("memberLookupInvalid"),
                  notFound: t("memberLookupNotFound"),
                  failed: t("memberLookupFailed"),
                  alreadyOnTeam: t("memberAlreadyOnTeam"),
                }}
              />
            </Field>

            <Field>
              <FieldLabel>{t("memberRole")}</FieldLabel>
              <FieldDescription>{t("memberRoleDesc")}</FieldDescription>
              <Select
                value={role}
                onValueChange={setRole}
                disabled={rolesQuery.isLoading || roles.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      rolesQuery.isLoading ? t("memberRoleLoading") : t("memberRolePlaceholder")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rolesQuery.isError && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-destructive">
                  <IconAlertCircle className="size-3.5" />
                  {t("memberRoleFailed")}
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel>{t("memberRemark")}</FieldLabel>
              <FieldDescription>{t("memberRemarkDesc")}</FieldDescription>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("memberRemarkPlaceholder")}
                rows={3}
              />
            </Field>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {t("addMemberConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LookupResult({
  email,
  wellFormed,
  isFetching,
  isError,
  found,
  alreadyOnTeam,
  labels,
}: {
  email: string;
  wellFormed: boolean;
  isFetching: boolean;
  isError: boolean;
  found: UserLookupRow | null;
  alreadyOnTeam: boolean;
  labels: {
    idle: string;
    searching: string;
    invalid: string;
    notFound: string;
    failed: string;
    alreadyOnTeam: string;
  };
}) {
  if (!email) {
    return (
      <Hint icon={<IconUserSearch className="size-4" />} tone="muted">
        {labels.idle}
      </Hint>
    );
  }
  if (!wellFormed) {
    return (
      <Hint icon={<IconAlertCircle className="size-4" />} tone="muted">
        {labels.invalid}
      </Hint>
    );
  }
  if (isFetching) {
    return (
      <Hint icon={<IconLoader2 className="size-4 animate-spin" />} tone="muted">
        {labels.searching}
      </Hint>
    );
  }
  if (isError) {
    return (
      <Hint icon={<IconAlertCircle className="size-4" />} tone="destructive">
        {labels.failed}
      </Hint>
    );
  }
  if (!found) {
    return (
      <Hint icon={<IconAlertCircle className="size-4" />} tone="destructive">
        {labels.notFound}
      </Hint>
    );
  }
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-3 rounded-xl border p-3",
        alreadyOnTeam
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-emerald-500/30 bg-emerald-500/5"
      )}
    >
      <UserAvatar src={found.avatar} name={found.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{found.name}</p>
        <p className="truncate text-xs text-muted-foreground">{found.email}</p>
      </div>
      {alreadyOnTeam ? (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/30">
          {labels.alreadyOnTeam}
        </span>
      ) : (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
          #{found.userId}
        </span>
      )}
    </div>
  );
}

function Hint({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "muted" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "mt-2 inline-flex items-center gap-1.5 text-xs",
        tone === "muted" ? "text-muted-foreground" : "text-destructive"
      )}
    >
      {icon}
      {children}
    </p>
  );
}

function UserAvatar({ src, name }: { src: string; name: string }) {
  const url = userAvatarUrl(src);
  const initial = name.charAt(0).toUpperCase() || "U";
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
        url
          ? "bg-muted"
          : "bg-gradient-to-br from-primary/25 to-secondary/40 text-sm font-semibold text-primary"
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="size-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}
