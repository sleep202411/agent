"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { openSettings } from "@/lib/settings-hash";
import {
  IconBolt,
  IconChevronDown,
  IconPlus,
  IconSearch,
  IconUpload,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FIELD_BUTTON, FIELD_CONTROL, FIELD_CONTROL_TEXTAREA } from "@/components/ui/field";
import type { WorkspaceRef } from "@/lib/collab/projects-api";
import { useWorkspace } from "./workspace-context";
import { useComputeWalletBalance } from "./credits-badge";

const canManage = (ws: WorkspaceRef) => ws.role === "owner" || ws.role === "admin";

/** Preset team icons shipped as static assets (no upload backend needed). */
const TEAM_ICON_PRESETS = ["aurora", "sunset", "ocean", "lime", "magenta", "slate"] as const;
const presetUrl = (id: string) => `/team-icons/${id}.svg`;

/** Workspace avatar — the team icon if set, else an initial-letter chip. */
function WsAvatar({
  ws,
  size,
  fallbackClassName,
}: {
  ws: WorkspaceRef;
  size: string;
  fallbackClassName?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (ws.avatarUrl && ws.avatarUrl !== failedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- icon URL (preset/uploaded)
      <img
        src={ws.avatarUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", size)}
        onError={() => setFailedUrl(ws.avatarUrl ?? null)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold",
        size,
        fallbackClassName
      )}
    >
      {ws.name[0]?.toUpperCase()}
    </span>
  );
}

/** Each row reads its own wallet, independently of the open project's payer. */
function WorkspaceBalance({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const { data, isError, error } = useComputeWalletBalance(enabled, workspaceId);
  const amount = data?.available.toLocaleString(locale);
  const label = isError
    ? error.message || t("balanceUnavailable")
    : amount != null
      ? t("availableCredits", { amount })
      : t("balanceLoading");
  return (
    <span
      className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground"
      title={label}
      aria-label={label}
    >
      <IconBolt className="size-3.5" stroke={1.8} aria-hidden />
      {isError
        ? t("balanceUnavailable")
        : (amount ?? <span className="h-3 w-10 animate-pulse rounded bg-white/10" />)}
    </span>
  );
}

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const roleLabel = (r: string) =>
    t(
      `roles.${r}` as
        | "roles.owner"
        | "roles.admin"
        | "roles.editor"
        | "roles.viewer"
        | "roles.member"
    );
  const { workspaces, activeWorkspace, setActiveWorkspaceId, createTeam } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const filteredWorkspaces = workspaces.filter((ws) => ws.name.toLocaleLowerCase().includes(query));
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamIcon, setTeamIcon] = useState<string | null>("aurora");
  const [busy, setBusy] = useState(false);

  if (!activeWorkspace) {
    return (
      <div
        className={cn(
          "animate-pulse rounded-[14px] bg-white/[0.08]",
          collapsed ? "size-10" : "h-10 w-full"
        )}
      />
    );
  }

  const resetCreate = () => {
    setCreating(false);
    setTeamName("");
    setTeamDescription("");
    setTeamIcon("aurora");
  };

  const onCreateTeam = async () => {
    const name = teamName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const avatarUrl =
        teamIcon && typeof window !== "undefined"
          ? `${window.location.origin}${presetUrl(teamIcon)}`
          : undefined;
      await createTeam(name, teamDescription, avatarUrl);
      resetCreate();
      toast.success(t("teamCreated", { name }));
    } catch {
      toast.error(t("createTeamFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setSearch("");
        }}
      >
        <DropdownMenuTrigger
          aria-label={collapsed ? t("switchTeams") : undefined}
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "relative min-w-0 rounded-[12px] bg-card/95 text-white backdrop-blur-xl hover:bg-accent aria-expanded:bg-accent",
            collapsed ? "size-10 justify-center" : "h-8 w-full gap-2 px-2.5 py-0"
          )}
        >
          <WsAvatar
            ws={activeWorkspace}
            size={collapsed ? "size-7" : "size-5"}
            fallbackClassName="bg-white/10 text-[11px] text-white/80"
          />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-[14px] leading-5 font-semibold">
                {activeWorkspace.name}
              </span>
              <IconChevronDown className="size-4 shrink-0 opacity-80" stroke={2} />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="flex max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden"
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <DropdownMenuLabel className="shrink-0 text-muted-foreground">
            {t("switchTeams")}
          </DropdownMenuLabel>

          <div className="relative mx-1 mb-2 shrink-0">
            <IconSearch
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="h-9 pl-9"
              onKeyDown={(event) => {
                if (event.key === "Escape") return;
                event.stopPropagation();
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                }
              }}
            />
          </div>
          <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain">
            {filteredWorkspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                className="gap-3 rounded-lg p-2"
                data-active={ws.id === activeWorkspace.id}
                onSelect={() => setActiveWorkspaceId(ws.id)}
              >
                <WsAvatar ws={ws} size="size-9" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {ws.name}
                    {ws.id === activeWorkspace.id && (
                      <span className="text-muted-foreground"> ·&nbsp;{t("current")}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{roleLabel(ws.role ?? "member")}</span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] leading-none font-semibold tracking-wide uppercase",
                        ws.type === "team"
                          ? "bg-[#5b9dff]/15 text-[#8fbcff]"
                          : "bg-[#e0a45c]/15 text-[#f2c98d]"
                      )}
                    >
                      {ws.type === "team" ? t("teamType") : t("personalType")}
                    </span>
                  </span>
                </span>
                {(ws.type === "team" || ws.role === "owner") && (
                  <span className="flex shrink-0 items-center gap-2">
                    <WorkspaceBalance workspaceId={ws.id} enabled={menuOpen} />
                    {ws.type === "team" && canManage(ws) && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          setActiveWorkspaceId(ws.id);
                          openSettings("members");
                        }}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
                      >
                        <IconUserPlus className="size-3.5" />
                        {t("invite")}
                      </button>
                    )}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {filteredWorkspaces.length === 0 && (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("noSearchResults")}
              </p>
            )}
          </div>

          <DropdownMenuSeparator className="shrink-0" />

          <DropdownMenuItem
            onSelect={() => setCreating(true)}
            className="shrink-0 gap-2 rounded-lg p-2 text-sm"
          >
            <IconPlus className="size-4" />
            {t("createTeam")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) resetCreate();
        }}
      >
        <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-3xl">
          <DialogClose asChild>
            <button
              type="button"
              aria-label={tc("close")}
              className="absolute top-5 right-5 flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <IconX className="size-5" stroke={2} />
            </button>
          </DialogClose>

          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-2xl">{t("createTeamTitle")}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 px-6 pb-2 sm:grid-cols-2">
            {/* Hero panel — on-brand (dark, monochrome chrome; gradient avatars
                are content). No stock photo / purple wash per DESIGN.md. */}
            <div className="relative hidden overflow-hidden rounded-2xl bg-secondary p-6 sm:flex sm:flex-col sm:justify-between">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(rgb(255 255 255 / 0.08) 1.2px, transparent 1.2px)",
                  backgroundSize: "16px 16px",
                }}
                aria-hidden
              />
              <h2 className="relative text-2xl font-semibold leading-tight">
                {t("collaborateRealtime")}
              </h2>
              <div className="relative flex items-center gap-2 self-start rounded-full bg-card/90 px-2.5 py-1.5 backdrop-blur-xl">
                <span className="text-xs font-medium">{t("myTeam")}</span>
                <div className="flex -space-x-1.5">
                  {["aurora", "ocean", "magenta"].map((id) => (
                    // eslint-disable-next-line @next/next/no-img-element -- bundled preset
                    <img key={id} src={presetUrl(id)} alt="" className="size-5 rounded-full" />
                  ))}
                </div>
                <span className="flex size-5 items-center justify-center rounded-full bg-white/10 text-white/80">
                  <IconUserPlus className="size-3" stroke={1.8} />
                </span>
              </div>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t("createTeamDescription")}</p>

              <Field label={t("teamName")} htmlFor="team-name">
                <Input
                  id="team-name"
                  autoFocus
                  placeholder={t("teamNamePlaceholder")}
                  value={teamName}
                  maxLength={120}
                  className={FIELD_CONTROL}
                  onChange={(event) => setTeamName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void onCreateTeam();
                  }}
                />
              </Field>

              <Field label={t("description")} htmlFor="team-description" hint={t("optional")}>
                <Textarea
                  id="team-description"
                  placeholder={t("teamDescriptionPlaceholder")}
                  value={teamDescription}
                  maxLength={500}
                  rows={3}
                  className={cn(FIELD_CONTROL_TEXTAREA, "resize-none")}
                  onChange={(event) => setTeamDescription(event.target.value)}
                />
              </Field>

              <div className="space-y-2">
                <span className="text-sm font-medium">{t("teamIcon")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Upload needs the storage backend (deferred) — honest disabled. */}
                  <button
                    type="button"
                    disabled
                    title={t("uploadComingSoon")}
                    aria-label={t("uploadIconComingSoon")}
                    className="flex size-11 cursor-not-allowed items-center justify-center rounded-full bg-input/30 text-muted-foreground opacity-50"
                  >
                    <IconUpload className="size-4" stroke={1.8} />
                  </button>
                  {TEAM_ICON_PRESETS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={t("presetIconLabel", { name: id })}
                      aria-pressed={teamIcon === id}
                      onClick={() => setTeamIcon(id)}
                      className={cn(
                        "size-11 overflow-hidden rounded-full transition",
                        teamIcon === id
                          ? "ring-2 ring-white ring-offset-2 ring-offset-popover"
                          : "opacity-90 hover:opacity-100"
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- bundled preset */}
                      <img src={presetUrl(id)} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 pt-2 pb-6">
            <Button variant="ghost" className={FIELD_BUTTON} onClick={resetCreate}>
              {tc("cancel")}
            </Button>
            <Button
              className={FIELD_BUTTON}
              onClick={() => void onCreateTeam()}
              disabled={!teamName.trim() || busy}
            >
              {t("createTeam")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
