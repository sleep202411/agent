import { IconBell } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";

export function WorkspaceHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b border-border/50 px-4">
      <NotificationButton />
      <UserMenu />
    </header>
  );
}

function NotificationButton() {
  return (
    <Button variant="ghost" color="muted" size="icon-sm" className="relative text-muted-foreground">
      <IconBell className="size-4" />
      <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
        3
      </span>
    </Button>
  );
}
