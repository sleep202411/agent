"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/src/i18n/config";
import { useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { NewIpCreateDialog } from "@/app/(site)/ip-studio/_components/new-ip-create-form";

export default function CreateIPPage() {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(true);
  const createdRef = useRef(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    // Successful create already routes to /ip-studio/:id — don't bounce
    // the user back to the plaza when the dialog closes afterward.
    if (!nextOpen && !createdRef.current) {
      router.replace(localizePath("/ips", locale));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <NewIpCreateDialog
        open={open}
        onOpenChange={handleOpenChange}
        onCreated={() => {
          createdRef.current = true;
        }}
      />
    </div>
  );
}
