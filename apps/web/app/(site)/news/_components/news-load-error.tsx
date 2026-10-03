"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";

export function NewsLoadError({ error }: { error: string }) {
  const router = useRouter();
  const common = useTranslations("common");
  const [busy, startTransition] = useTransition();
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 md:px-8">
      <Alert variant="destructive" className="max-w-xl border-border bg-card">
        <AlertDescription>
          <p className="break-words">{error}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => startTransition(() => router.refresh())}
          >
            {common("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
