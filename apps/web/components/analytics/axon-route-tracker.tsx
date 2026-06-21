"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { axonPageView } from "@/src/lib/axon";

/**
 * Fires an AppLovin `page_view` on initial mount and on every App Router
 * navigation. App Router transitions are client-side, so without this only the
 * first hard load would register. No-op on the CN build / when the pixel key is
 * unset (see src/lib/axon.ts). Renders nothing.
 */
export function AxonRouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    axonPageView();
  }, [pathname]);
  return null;
}
