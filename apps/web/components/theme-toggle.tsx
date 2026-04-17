"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { IconSun, IconMoon } from "@tabler/icons-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
    >
      {theme === "dark" ? <IconSun className="size-5" /> : <IconMoon className="size-5" />}
    </button>
  );
}
