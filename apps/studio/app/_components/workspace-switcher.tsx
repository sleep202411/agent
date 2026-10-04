"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "./auth-provider";
import { ShareDialog } from "./share-dialog";
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
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
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
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  return (
    <WorkspaceSwitcherView
      key={JSON.stringify([user?.id, activeWorkspace?.id])}
      collapsed={collapsed}
    />
  );
}
function WorkspaceSwitcherView({ collapsed }: { collapsed: boolean }) {
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
  const { workspaces, activeWorkspace, setActiveWorkspaceId, createWorkspace } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [invitingWorkspace, setInvitingWorkspace] = useState<WorkspaceRef | null>(null);
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
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const pendingIcon = useRef<AbortController | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const pendingCreate = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingIcon.current?.abort();
      pendingIcon.current = null;
      pendingCreate.current?.abort();
      pendingCreate.current = null;
    };
  }, []);

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
    pendingIcon.current?.abort();
    pendingIcon.current = null;
    setUploadProgress(null);
    setCustomIcon(null);
    pendingCreate.current?.abort();
    pendingCreate.current = null;
    setBusy(false);
    setCreating(false);
    setTeamName("");
    setTeamDescription("");
    setTeamIcon("aurora");
  };

  const uploadIcon = async (file: File) => {
    if (busy || !creating) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      toast.error(t("iconFileInvalid"));
      return;
    }
    pendingIcon.current?.abort();
    const operation = new AbortController();
    pendingIcon.current = operation;
    const current = () => mounted.current && pendingIcon.current === operation;
    setUploadProgress(0);
    try {
      const result = await uploadFileViaSignedUrl(file, {
        kind: "workspace_icon",
        signal: operation.signal,
        onProgress: (percent) => {
          if (current()) setUploadProgress(percent);
        },
      });
      if (!current()) return;
      setCustomIcon(result.url);
      setTeamIcon(null);
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : t("iconUploadFailed"));
    } finally {
      if (current()) {
        pendingIcon.current = null;
        setUploadProgress(null);
      }
    }
  };

  const onCreateTeam = async () => {
    const name = teamName.trim();
    if (!name || !creating || !mounted.current || pendingCreate.current || pendingIcon.current)
      return;
    const operation = new AbortController();
    pendingCreate.current = operation;
    const current = () => mounted.current && pendingCreate.current === operation;
    setBusy(true);
    try {
      const avatarUrl =
        customIcon ??
        (teamIcon && typeof window !== "undefined"
          ? `${window.location.origin}${presetUrl(teamIcon)}`
          : undefined);
      await createWorkspace(name, teamDescription, avatarUrl, operation.signal);
      if (!current()) return;
      resetCreate();
      toast.success(t("teamCreated", { name }));
    } catch (error) {
      if (current())
        toast.error(error instanceof Error ? error.message : t("createWorkspaceFailed"));
    } finally {
      if (current()) {
        pendingCreate.current = null;
        setBusy(false);
      }
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
          aria-label={collapsed ? t("switchWorkspaces") : undefined}
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
            {t("switchWorkspaces")}
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
                  </span>
                </span>
                {
                  <span className="flex shrink-0 items-center gap-2">
                    <WorkspaceBalance workspaceId={ws.id} enabled={menuOpen} />
                    {canManage(ws) && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          setMenuOpen(false);
                          setInvitingWorkspace(ws);
                        }}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
                      >
                        <IconUserPlus className="size-3.5" />
                        {t("invite")}
                      </button>
                    )}
                  </span>
                }
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
            {t("createWorkspace")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {invitingWorkspace && (
        <ShareDialog
          scope={{ kind: "workspace", id: invitingWorkspace.id, name: invitingWorkspace.name }}
          canManage={canManage(invitingWorkspace)}
          open
          onOpenChange={(open) => !open && setInvitingWorkspace(null)}
        />
      )}
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
            <DialogTitle className="text-2xl">{t("createWorkspaceTitle")}</DialogTitle>
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
              <p className="text-sm text-muted-foreground">{t("createWorkspaceDescription")}</p>

              <Field label={t("teamName")} htmlFor="team-name">
                <Input
                  id="team-name"
                  autoFocus
                  placeholder={t("teamNamePlaceholder")}
                  disabled={busy}
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
                  disabled={busy}
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
                  <input
                    ref={iconInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label={t("uploadIcon")}
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadIcon(file);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    title={t("iconFileHint")}
                    aria-label={t("uploadIcon")}
                    onClick={() => iconInput.current?.click()}
                    className="flex size-11 items-center justify-center overflow-hidden rounded-full bg-input/30 text-muted-foreground"
                  >
                    {customIcon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- confirmed workspace icon
                      <img src={customIcon} alt="" className="size-full object-cover" />
                    ) : (
                      <IconUpload className="size-4" stroke={1.8} />
                    )}
                  </button>
                  {TEAM_ICON_PRESETS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={t("presetIconLabel", { name: id })}
                      aria-pressed={teamIcon === id}
                      disabled={busy}
                      onClick={() => {
                        pendingIcon.current?.abort();
                        pendingIcon.current = null;
                        setUploadProgress(null);
                        setCustomIcon(null);
                        setTeamIcon(id);
                      }}
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
                {uploadProgress !== null && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {t("iconUploading", { percent: Math.round(uploadProgress) })}
                  </p>
                )}
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
              disabled={!teamName.trim() || busy || uploadProgress !== null}
            >
              {t("createWorkspace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
