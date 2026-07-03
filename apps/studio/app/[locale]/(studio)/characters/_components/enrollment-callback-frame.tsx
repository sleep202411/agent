"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconRosetteDiscountCheck } from "@tabler/icons-react";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { CharacterDetailView } from "./character-detail-view";
import { ENROLLMENT_CALLBACK_MESSAGE } from "./character-enrollment-wizard";

/**
 * The BytePlus H5 flow redirects the enrollment iframe to
 * `/characters/{id}?enrollment=callback` when the liveness check finishes.
 * Rendering the full character detail inside that 420px iframe would nest the
 * whole studio app — and recurse (detail → wizard → another H5 iframe).
 *
 * Instead, when this page is loaded INSIDE the enrollment iframe we render a
 * minimal "verification complete" stub and poke the parent tab to run its
 * authenticated completion pull (the callback NEVER mutates state itself —
 * completion always goes through `enrollment/complete` → server pull). Loaded
 * standalone (a user pasting the URL), we fall back to the normal detail view.
 */
export function EnrollmentCallbackFrame({ characterId }: { characterId: string }) {
  const t = useTranslations("characters");
  // Snapshot at mount — a stable branch avoids a hooks-order flip.
  const [inFrame] = useState(() => typeof window !== "undefined" && window.parent !== window);

  useEffect(() => {
    if (!inFrame) return;
    // Same-origin parent (studio serves both) → targetOrigin restricts delivery.
    try {
      window.parent.postMessage(
        { type: ENROLLMENT_CALLBACK_MESSAGE, characterId },
        window.location.origin
      );
    } catch {
      // Cross-origin parent — the wizard's status poll is the backstop.
    }
  }, [inFrame, characterId]);

  if (!inFrame) return <CharacterDetailView characterId={characterId} />;

  return (
    <FrostedPanel className="mx-auto mt-10 flex max-w-sm flex-col items-center px-6 py-10 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-white/[0.06]">
        <IconRosetteDiscountCheck className="size-7 text-white/70" stroke={1.6} />
      </div>
      <p className="mt-4 text-sm font-medium">{t("callbackCompleteTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("callbackCompleteBody")}</p>
    </FrostedPanel>
  );
}
