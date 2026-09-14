"use client";

/**
 * Workspace switcher — the identity/context pill in the FizzStudio header.
 *
 * Responsibilities:
 *   - Display the active workspace (name + avatar)
 *   - Let the user switch between all their workspaces
 *   - Create a new workspace
 *
 * The active workspace is lifted to the parent via `onSwitch` so the
 * projects section can react immediately without a prop-drilling chain.
 */

import { useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateWorkspace, useWorkspaces } from "../../_hooks/use-workspace";
import type { FizzWorkspace } from "../../_lib/api";

// ─── Colour palette for workspace avatars ────────────────────────────────────
const AVATAR_GRADIENTS = [
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
  "from-cyan-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-rose-500 to-pink-600",
  "from-sky-500 to-indigo-600",
];

function workspaceGradient(id: string) {
  const sum = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length];
}

function workspaceInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WorkspaceAvatar({
  workspace,
  size = "md",
}: {
  workspace: FizzWorkspace;
  size?: "sm" | "md" | "lg";
}) {
  const gradient = workspaceGradient(workspace.id);
  const initials = workspaceInitials(workspace.name);
  const sizeClass =
    size === "sm" ? "size-8 text-sm" : size === "lg" ? "size-11 text-base" : "size-9 text-sm";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-bold text-white",
        sizeClass,
        gradient
      )}
    >
      {initials}
    </span>
  );
}

// ─── Create dialog ─────────────────────────────────────────────────────────────

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (ws: FizzWorkspace) => void;
}) {
  const t = useTranslations("fizzStudio");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateWorkspace();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || create.isPending) return;
    const ws = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    onCreated(ws);
    onOpenChange(false);
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("createWorkspaceTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("workspaceNameLabel")}
                <span className="ml-1 text-destructive">*</span>
              </label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspaceNamePlaceholder")}
                maxLength={120}
                size="lg"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("createProjectDescLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("createProjectDescPlaceholder")}
                maxLength={500}
                rows={2}
                className="w-full resize-none rounded-md border border-input bg-input/20 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
              {t("createWorkspace")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface WorkspaceSwitcherProps {
  activeWorkspaceId: string;
  onSwitch: (workspaceId: string) => void;
}

export function WorkspaceSwitcher({ activeWorkspaceId, onSwitch }: WorkspaceSwitcherProps) {
  const t = useTranslations("fizzStudio");
  const { data: workspaces = [] } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  const handleSwitch = (ws: FizzWorkspace) => {
    onSwitch(ws.id);
    setOpen(false);
  };

  const handleCreated = (ws: FizzWorkspace) => {
    onSwitch(ws.id);
  };

  if (!activeWs) {
    return <div className="h-10 w-52 animate-pulse rounded-full bg-white/[0.06]" />;
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-all duration-150",
              open
                ? "border-white bg-[#151516] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.18)]"
                : "border-white/12 bg-[#151516] text-white/78 hover:border-white/22 hover:bg-[#1f1f21] hover:text-white"
            )}
          >
            <WorkspaceAvatar workspace={activeWs} size="sm" />
            <span className="hidden max-w-[180px] truncate sm:block">{activeWs.name}</span>
            {open ? (
              <IconChevronUp className="size-4 shrink-0 text-white/70" />
            ) : (
              <IconChevronDown className="size-4 shrink-0 text-white/50" />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="center"
          sideOffset={10}
          collisionPadding={12}
          className="z-[90] w-[min(408px,calc(100vw-24px))] overflow-hidden rounded-[24px] border border-white/[0.11] bg-[#151516]/98 p-4 text-white shadow-[0_26px_80px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl"
        >
          <div className="text-sm font-semibold text-white/42">{t("workspace.switchTeams")}</div>

          <div className="mt-4 space-y-2">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWs.id;
              return (
                <div
                  key={ws.id}
                  onClick={() => handleSwitch(ws)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSwitch(ws);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18",
                    isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  )}
                >
                  <WorkspaceAvatar workspace={ws} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[17px] font-medium leading-tight text-white">
                      {ws.name}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-white/46">
                      <span>{t("workspace.owner")}</span>
                      <span aria-hidden>-</span>
                      <IconUsers className="size-4" />
                      <span>1</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    className="hidden h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/86 transition-colors hover:border-white/18 hover:bg-white/[0.04] sm:inline-flex"
                  >
                    <IconUserPlus className="size-4" />
                    {t("workspace.invite")}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="my-3 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-12 w-full items-center justify-between rounded-xl px-2 text-left text-white/56 transition-colors hover:bg-white/[0.04] hover:text-white/78"
          >
            <span className="inline-flex items-center gap-3">
              <IconUserPlus className="size-5" />
              <span className="text-base font-medium">{t("workspace.newJoiners")}</span>
            </span>
            <span className="text-base font-semibold text-[#d9b6ff]">0</span>
          </button>

          <div className="my-3 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
            className="flex h-12 w-full items-center justify-between rounded-xl px-2 text-left text-[#d8b7ff] transition-colors hover:bg-[#8b5cf6]/10 hover:text-[#eadcff]"
          >
            <span className="inline-flex items-center gap-3">
              <IconPlus className="size-5" />
              <span className="text-lg font-medium">{t("workspace.joinOrCreate")}</span>
            </span>
            <span className="rounded-xl bg-[#3d1b66] px-3 py-1 text-sm font-semibold text-[#d9c2ff]">
              {t("workspace.free")}
            </span>
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </>
  );
}
