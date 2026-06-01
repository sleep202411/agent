"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/src/i18n/config";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";

export default function CreateIPPage() {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(true);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      router.replace(localizePath("/ips", locale));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <NewIpCreateDialog open={open} onOpenChange={handleOpenChange} />
    </div>
  );
}
