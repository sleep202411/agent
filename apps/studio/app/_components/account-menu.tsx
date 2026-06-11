"use client";

import Link from "next/link";
import {
  IconInfoCircle,
  IconLogout,
  IconReceipt,
  IconSettings,
  IconSparkles,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Placeholder identity/credits until auth and billing are wired up. */
const USER = { name: "Isaac", email: "isaac@fizzdragon.com", credits: 100 };

const comingSoon = (label: string) => toast.info(`${label} · Coming soon`);

function PillButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 flex-1 items-center justify-center rounded-full bg-white/[0.06] text-sm font-medium transition-colors hover:bg-white/[0.1]"
    >
      {label}
    </button>
  );
}

export function AccountMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex size-9 items-center justify-center rounded-full bg-secondary text-white/80 transition-colors outline-none hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-white"
      >
        <IconUser className="size-5" stroke={1.8} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-3">
        {/* Identity */}
        <div className="flex items-center gap-3 p-1">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
            {USER.name[0]}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{USER.name}</span>
            <span className="truncate text-xs text-muted-foreground">{USER.email}</span>
          </span>
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconSettings className="size-4.5" stroke={1.8} />
          </Link>
        </div>

        <button
          type="button"
          onClick={() => comingSoon("My Profile")}
          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white/[0.06] text-sm font-medium transition-colors hover:bg-white/[0.1]"
        >
          <IconUserCircle className="size-4.5" stroke={1.8} />
          My Profile
        </button>

        <DropdownMenuSeparator className="my-3" />

        {/* Credits */}
        <div className="flex items-center gap-2 p-1">
          <IconSparkles className="size-4.5" stroke={1.8} />
          <span className="text-lg font-semibold">{USER.credits}</span>
          <span className="text-sm text-muted-foreground">Credits Left</span>
          <IconInfoCircle className="size-4 text-muted-foreground" stroke={1.8} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <PillButton label="Upgrade" onClick={() => comingSoon("Upgrade")} />
          <PillButton label="Usage Analytics" onClick={() => comingSoon("Usage Analytics")} />
        </div>

        <DropdownMenuSeparator className="my-3" />

        {/* Menu — no Theme row: this app is dark-only by design. */}
        <DropdownMenuItem
          onSelect={() => comingSoon("Billing & Subscription")}
          className="gap-2.5 rounded-lg p-2 text-sm"
        >
          <IconReceipt className="size-4.5" stroke={1.8} />
          Billing &amp; Subscription
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5 rounded-lg p-2 text-sm">
          <Link href="/settings" className="flex flex-1 items-center gap-2.5">
            <IconSettings className="size-4.5" stroke={1.8} />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => comingSoon("Logout")}
          className="gap-2.5 rounded-lg p-2 text-sm"
        >
          <IconLogout className="size-4.5" stroke={1.8} />
          Logout
        </DropdownMenuItem>

        <DropdownMenuSeparator className="my-3" />

        {/* Footer links */}
        <div className="flex items-center justify-between px-1 pb-1">
          {["Terms", "Privacy", "Blogs"].map((label, i) => (
            <span key={label} className="flex flex-1 items-center justify-center">
              {i > 0 && <span className="mr-auto h-3.5 w-px bg-border" aria-hidden />}
              <button
                type="button"
                onClick={() => comingSoon(label)}
                className="mx-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </button>
            </span>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
