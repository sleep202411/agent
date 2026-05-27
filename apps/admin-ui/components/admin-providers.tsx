"use client";

import { ThemeProvider } from "next-themes";
import { AdminSiteProvider } from "@/components/admin-site-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

type AdminProvidersProps = {
  children: React.ReactNode;
};

export function AdminProviders({ children }: AdminProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false}>
      <TooltipProvider delayDuration={250}>
        <AdminSiteProvider>{children}</AdminSiteProvider>
        <Toaster position="top-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
