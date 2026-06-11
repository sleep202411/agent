"use client";

import { IconChevronDown, IconPlus, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Placeholder workspace data until the workspace API is wired up
 * (port of the web app's `use-workspace` hooks).
 */
const WORKSPACES = [{ id: "personal", name: "Personal", role: "Owner", members: 1 }];

const comingSoon = (label: string) => toast.info(`${label} · Coming soon`);

export function WorkspaceSwitcher() {
  const active = WORKSPACES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] py-1 pr-3 pl-1.5 transition-colors outline-none hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-white/[0.1]">
        <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
          {active.name[0]}
        </span>
        <span className="text-sm font-medium">{active.name}</span>
        <IconChevronDown className="size-4 text-white/55" stroke={2} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuLabel className="text-muted-foreground">Switch Teams</DropdownMenuLabel>

        {WORKSPACES.map((ws) => (
          <DropdownMenuItem key={ws.id} className="gap-3 rounded-lg p-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
              {ws.name[0]}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{ws.name}</span>
              <span className="text-xs text-muted-foreground">
                {ws.role} · {ws.members} {ws.members === 1 ? "member" : "members"}
              </span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                comingSoon("Invite");
              }}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <IconUserPlus className="size-3.5" />
              Invite
            </button>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => comingSoon("Join or create team")}
          className="gap-2 rounded-lg p-2 text-sm"
        >
          <IconPlus className="size-4" />
          Join or create team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
